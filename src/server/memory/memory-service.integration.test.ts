// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { characterContentDigest } from "@/server/characters/content-digest";
import { lockUserCharacterChatMutation } from "@/server/chat/chat-locks";
import { createDatabase } from "@/server/db/client";
import {
  adminAuditEvent,
  character,
  characterVersion,
  chatSettings,
  conversation,
  conversationMessage,
  generationAttempt,
  memoryEvidence,
  memoryExtractionRun,
  memoryItem,
  memorySettings,
  relationshipSummary,
  relationshipSummaryRun,
  relationshipSummaryVersion,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import { MemoryDomainError } from "./memory-errors";
import { lockUserMemoryMutation } from "./memory-locks";
import {
  deleteMemoryItem,
  editMemoryItem,
  forgetCharacter,
  updateMemoryControls,
} from "./memory-service";

const database = createDatabase(testDatabaseUrl());

const baseContent = {
  displayName: "Mira",
  avatarPath: "/characters/mira.svg",
  shortDescription: "A calm companion.",
  longDescription: "A calm companion who listens carefully.",
  personalityPrinciples: ["Listen first."],
  speakingStyle: "Warm and direct.",
  responseRhythm: "Short paragraphs.",
  relationshipBoundaries: ["Do not encourage dependency."],
  openingMessage: "What would you like to talk about?",
  exampleConversations: [
    { user: "Hello", assistant: "Hello. How are you feeling?" },
  ],
  generationParameters: {
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: 800,
  },
  safetyAdditions: ["Use grounding language."],
};

beforeEach(async () => {
  await database.execute(sql`
    TRUNCATE TABLE chat_settings, memory_settings, characters, "user"
    RESTART IDENTITY CASCADE
  `);
  await database.insert(chatSettings).values({
    id: "global",
    userDailyRequestLimit: 10,
    userDailyTokenLimit: 10_000,
    instanceMonthlyRequestLimit: 100,
    instanceMonthlyTokenBudget: 100_000,
    maxConcurrentGenerations: 2,
    deploymentDefaultUserDailyRequestLimit: 10,
    deploymentDefaultUserDailyTokenLimit: 10_000,
    deploymentDefaultInstanceMonthlyRequestLimit: 100,
    deploymentDefaultInstanceMonthlyTokenBudget: 100_000,
    deploymentDefaultMaxConcurrentGenerations: 2,
  });
  await database.insert(memorySettings).values({
    id: "global",
    enabled: true,
    deploymentDefaultEnabled: true,
  });
});

afterAll(async () => {
  await database.$client.end();
});

async function insertFixture(options: { secondUser?: boolean } = {}) {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const characterId = randomUUID();
  const characterVersionId = randomUUID();
  await database.insert(user).values([
    {
      id: userId,
      name: "Memory User",
      email: `${userId}@example.com`,
      emailVerified: true,
    },
    ...(options.secondUser
      ? [
          {
            id: otherUserId,
            name: "Other User",
            email: `${otherUserId}@example.com`,
            emailVerified: true,
          },
        ]
      : []),
  ]);
  await database.insert(character).values({
    id: characterId,
    slug: `memory-${characterId}`,
  });
  await database.insert(characterVersion).values({
    id: characterVersionId,
    characterId,
    versionNumber: 1,
    ...baseContent,
    contentDigest: characterContentDigest(baseContent),
    publishedAt: new Date("2026-10-01T00:00:00.000Z"),
  });
  await database
    .update(character)
    .set({ defaultVersionId: characterVersionId })
    .where(eq(character.id, characterId));
  return { userId, otherUserId, characterId, characterVersionId };
}

async function insertMemory(input: {
  userId: string;
  characterId: string;
  sensitivity?: "ordinary" | "personal_explicit";
  content?: string;
  revision?: number;
}) {
  const id = randomUUID();
  const now = new Date("2026-10-10T00:00:00.000Z");
  await database
    .insert(userCharacterMemorySetting)
    .values({
      userId: input.userId,
      characterId: input.characterId,
    })
    .onConflictDoNothing({
      target: [
        userCharacterMemorySetting.userId,
        userCharacterMemorySetting.characterId,
      ],
    });
  await database.insert(memoryItem).values({
    id,
    userId: input.userId,
    characterId: input.characterId,
    memoryEpoch: 0,
    type:
      input.sensitivity === "personal_explicit"
        ? "personal_fact"
        : "preference",
    content: input.content ?? "Likes green tea.",
    normalizedContent: input.content ?? "Likes green tea.",
    normalizedDigest: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    origin: "automatic",
    sensitivity: input.sensitivity ?? "ordinary",
    explicitness: "direct",
    confidence: 80,
    importance: 70,
    firstObservedAt: now,
    lastConfirmedAt: now,
    revision: input.revision ?? 1,
  });
  return id;
}

describe("memory controls", () => {
  test("creates a missing settings row once and rejects the racing stale revision", async () => {
    const fixture = await insertFixture();
    const blockerDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "memory-settings-race-blocker",
      max: 1,
    });
    const firstDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "memory-settings-race-first",
      max: 1,
    });
    const secondDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "memory-settings-race-second",
      max: 1,
    });

    try {
      await blockerDatabase.$client.query("BEGIN");
      await blockerDatabase.$client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`chat-user-character:${fixture.userId}:${fixture.characterId}`],
      );

      const firstOperation = updateMemoryControls(firstDatabase, {
        userId: fixture.userId,
        characterId: fixture.characterId,
        expectedRevision: 1,
        recordingEnabled: false,
        usageEnabled: true,
      });
      void firstOperation.catch(() => undefined);
      await expect
        .poll(async () => {
          const result = await database.$client.query<{
            blocker_name: string;
            query: string;
            waiter_granted: boolean;
          }>(
            `
              SELECT
                blocker.application_name AS blocker_name,
                waiter.query,
                waiter_lock.granted AS waiter_granted
              FROM pg_stat_activity waiter
              JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) blocker_pid
                ON true
              JOIN pg_stat_activity blocker ON blocker.pid = blocker_pid
              JOIN pg_locks waiter_lock
                ON waiter_lock.pid = waiter.pid
               AND waiter_lock.locktype = 'advisory'
               AND NOT waiter_lock.granted
              WHERE waiter.application_name = 'memory-settings-race-first'
            `,
          );
          return result.rows[0] ?? null;
        })
        .toMatchObject({
          blocker_name: "memory-settings-race-blocker",
          query: expect.stringContaining("pg_advisory_xact_lock"),
          waiter_granted: false,
        });

      const secondOperation = updateMemoryControls(secondDatabase, {
        userId: fixture.userId,
        characterId: fixture.characterId,
        expectedRevision: 1,
        recordingEnabled: true,
        usageEnabled: false,
      });
      void secondOperation.catch(() => undefined);
      await expect
        .poll(async () => {
          const result = await database.$client.query<{
            blocker_name: string;
            query: string;
          }>(
            `
              SELECT blocker.application_name AS blocker_name, waiter.query
              FROM pg_stat_activity waiter
              JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) blocker_pid
                ON true
              JOIN pg_stat_activity blocker ON blocker.pid = blocker_pid
              WHERE waiter.application_name = 'memory-settings-race-second'
            `,
          );
          return result.rows[0] ?? null;
        })
        .toMatchObject({
          blocker_name: "memory-settings-race-first",
          query: expect.stringContaining('"chat_settings"'),
        });

      expect(
        await database
          .select()
          .from(userCharacterMemorySetting)
          .where(
            and(
              eq(userCharacterMemorySetting.userId, fixture.userId),
              eq(userCharacterMemorySetting.characterId, fixture.characterId),
            ),
          ),
      ).toHaveLength(0);

      await blockerDatabase.$client.query("COMMIT");
      const results = await Promise.allSettled([
        firstOperation,
        secondOperation,
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(
        rejected?.status === "rejected" ? rejected.reason : null,
      ).toMatchObject({
        code: "MEMORY_REVISION_CONFLICT",
      });
      const rows = await database
        .select()
        .from(userCharacterMemorySetting)
        .where(
          and(
            eq(userCharacterMemorySetting.userId, fixture.userId),
            eq(userCharacterMemorySetting.characterId, fixture.characterId),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revision).toBe(2);
      expect(rows[0]?.memoryRevision).toBe(0);
    } finally {
      await blockerDatabase.$client.query("ROLLBACK").catch(() => undefined);
      await blockerDatabase.$client.end();
      await firstDatabase.$client.end();
      await secondDatabase.$client.end();
    }
  });
});

describe("memory item mutations", () => {
  test("sensitive manual edit without explicit intent cannot cross the service boundary", async () => {
    const fixture = await insertFixture();
    const memoryId = await insertMemory(fixture);
    await expect(
      editMemoryItem(database, {
        ...fixture,
        memoryId,
        expectedRevision: 1,
        content: "Has diabetes.",
        userExplicitlyAskedToRemember: false,
      }),
    ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
    expect((await database.select().from(memoryItem))[0].content).toBe(
      "Likes green tea.",
    );
  });
  test("omitting explicit manual intent cannot save sensitive content", async () => {
    const fixture = await insertFixture();
    const memoryId = await insertMemory(fixture);
    await expect(
      editMemoryItem(database, {
        ...fixture,
        memoryId,
        expectedRevision: 1,
        content: "Has diabetes.",
      }),
    ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
  });
  test("stale delete revision preserves the current user-edited memory", async () => {
    const fixture = await insertFixture();
    const memoryId = await insertMemory({ ...fixture, revision: 3 });
    await expect(
      deleteMemoryItem(database, { ...fixture, memoryId, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "MEMORY_REVISION_CONFLICT" });
    expect((await database.select().from(memoryItem))[0].revision).toBe(3);
  });
  test("makes a user edit authoritative, normalizes it, and increments only content revisions", async () => {
    const fixture = await insertFixture();
    await database.insert(userCharacterMemorySetting).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryRevision: 4,
      revision: 7,
    });
    const memoryId = await insertMemory(fixture);

    const result = await editMemoryItem(database, {
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryId,
      expectedRevision: 1,
      content: "  Likes   jasmine tea. ",
    });

    expect(result).toEqual({ revision: 2 });
    const [edited] = await database
      .select()
      .from(memoryItem)
      .where(eq(memoryItem.id, memoryId));
    expect(edited).toMatchObject({
      content: "Likes jasmine tea.",
      normalizedContent: "Likes jasmine tea.",
      normalizedDigest:
        "c2eddd7be71912eed1454a28458981c5146396a622781ad5121452d6e48ef0c9",
      origin: "user_edited",
      explicitness: "direct",
      revision: 2,
    });
    expect(edited?.userEditedAt).toBeInstanceOf(Date);
    const [settings] = await database.select().from(userCharacterMemorySetting);
    expect(settings).toMatchObject({ memoryRevision: 5, revision: 7 });
  });

  test("rejects credential-class text without persisting it or exposing it publicly", async () => {
    const fixture = await insertFixture();
    const memoryId = await insertMemory(fixture);
    const credentialText = "My password is swordfish-123.";

    const error = await editMemoryItem(database, {
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryId,
      expectedRevision: 1,
      content: credentialText,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MemoryDomainError);
    expect(error).toMatchObject({ code: "MEMORY_VALIDATION" });
    expect(
      JSON.stringify((error as MemoryDomainError).toPublicError()),
    ).not.toContain(credentialText);
    const [unchanged] = await database
      .select({ content: memoryItem.content, revision: memoryItem.revision })
      .from(memoryItem)
      .where(eq(memoryItem.id, memoryId));
    expect(unchanged).toEqual({ content: "Likes green tea.", revision: 1 });
  });

  test("allows an explicit manual edit of personal-sensitive content", async () => {
    const fixture = await insertFixture();
    const memoryId = await insertMemory({
      ...fixture,
      sensitivity: "personal_explicit",
      content: "Lives nearby.",
    });

    await expect(
      editMemoryItem(database, {
        userId: fixture.userId,
        characterId: fixture.characterId,
        memoryId,
        expectedRevision: 1,
        content: "Lives at 123 Maple Street.",
        userExplicitlyAskedToRemember: true,
      }),
    ).resolves.toEqual({ revision: 2 });

    const [edited] = await database
      .select({
        content: memoryItem.content,
        sensitivity: memoryItem.sensitivity,
        digest: memoryItem.normalizedDigest,
      })
      .from(memoryItem)
      .where(eq(memoryItem.id, memoryId));
    expect(edited).toEqual({
      content: "Lives at 123 Maple Street.",
      sensitivity: "personal_explicit",
      digest:
        "80e57d33b636140361c9f16a68a18d26a88bacc8d1c934083501fc0a09b94eea",
    });
  });

  test("uses not-found behavior for another user's item identifier", async () => {
    const fixture = await insertFixture({ secondUser: true });
    const memoryId = await insertMemory(fixture);

    await expect(
      editMemoryItem(database, {
        userId: fixture.otherUserId,
        characterId: fixture.characterId,
        memoryId,
        expectedRevision: 1,
        content: "Attempted overwrite.",
      }),
    ).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
    await expect(
      deleteMemoryItem(database, {
        userId: fixture.otherUserId,
        characterId: fixture.characterId,
        memoryId,
      }),
    ).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });

    const [unchanged] = await database
      .select({ content: memoryItem.content })
      .from(memoryItem)
      .where(eq(memoryItem.id, memoryId));
    expect(unchanged?.content).toBe("Likes green tea.");
  });

  test("physically deletes an item and all evidence while advancing memory revision", async () => {
    const fixture = await insertFixture();
    await database.insert(userCharacterMemorySetting).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryRevision: 2,
    });
    const memoryId = await insertMemory(fixture);
    await database.insert(memoryEvidence).values({
      id: randomUUID(),
      memoryId,
      sourceDeletedAt: new Date(),
      observedAt: new Date(),
      evidenceKind: "direct",
    });

    await deleteMemoryItem(database, {
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryId,
    });

    expect(
      await database
        .select()
        .from(memoryItem)
        .where(eq(memoryItem.id, memoryId)),
    ).toHaveLength(0);
    expect(
      await database
        .select()
        .from(memoryEvidence)
        .where(eq(memoryEvidence.memoryId, memoryId)),
    ).toHaveLength(0);
    const [settings] = await database
      .select({ memoryRevision: userCharacterMemorySetting.memoryRevision })
      .from(userCharacterMemorySetting);
    expect(settings?.memoryRevision).toBe(3);
  });

  test("changes nothing when the item revision is stale", async () => {
    const fixture = await insertFixture();
    const memoryId = await insertMemory({ ...fixture, revision: 3 });

    await expect(
      editMemoryItem(database, {
        userId: fixture.userId,
        characterId: fixture.characterId,
        memoryId,
        expectedRevision: 2,
        content: "Stale edit.",
      }),
    ).rejects.toMatchObject({
      code: "MEMORY_REVISION_CONFLICT",
      metadata: {
        memoryId,
        expectedRevision: 2,
        actualRevision: 3,
      },
    });
    const [unchanged] = await database
      .select({ content: memoryItem.content, revision: memoryItem.revision })
      .from(memoryItem)
      .where(eq(memoryItem.id, memoryId));
    expect(unchanged).toEqual({ content: "Likes green tea.", revision: 3 });
  });
});

describe("forgetCharacter", () => {
  test("locks owned summary versions before memory items and evidence", async () => {
    const fixture = await insertFixture();
    await database.insert(userCharacterMemorySetting).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
    });
    const memoryId = await insertMemory(fixture);
    await database.insert(memoryEvidence).values({
      id: randomUUID(),
      memoryId,
      sourceDeletedAt: new Date(),
      observedAt: new Date(),
      evidenceKind: "direct",
    });
    const summaryVersionId = randomUUID();
    await database.insert(relationshipSummaryVersion).values({
      id: summaryVersionId,
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryEpoch: 0,
      content: "Summary awaiting deletion.",
      origin: "automatic",
      basedOnMemoryRevision: 0,
    });
    await database.insert(relationshipSummary).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryEpoch: 0,
      currentVersionId: summaryVersionId,
    });
    const blockerDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "forget-summary-version-blocker",
      max: 1,
    });
    const forgetDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "forget-summary-version-waiter",
      max: 1,
    });
    let forgetOperation:
      Promise<{ memoryEpoch: number; revision: number }> | undefined;

    try {
      await blockerDatabase.$client.query("BEGIN");
      await blockerDatabase.$client.query(
        "SELECT id FROM relationship_summary_versions WHERE id = $1 FOR UPDATE",
        [summaryVersionId],
      );

      forgetOperation = forgetCharacter(forgetDatabase, {
        userId: fixture.userId,
        characterId: fixture.characterId,
        expectedRevision: 1,
      });
      void forgetOperation.catch(() => undefined);

      await expect
        .poll(async () => {
          const result = await database.$client.query<{
            blocker_name: string;
            query: string;
          }>(
            `
              SELECT blocker.application_name AS blocker_name, waiter.query
              FROM pg_stat_activity waiter
              JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) blocker_pid
                ON true
              JOIN pg_stat_activity blocker ON blocker.pid = blocker_pid
              WHERE waiter.application_name = 'forget-summary-version-waiter'
                AND waiter.wait_event_type = 'Lock'
            `,
          );
          return result.rows[0] ?? null;
        })
        .toMatchObject({
          blocker_name: "forget-summary-version-blocker",
          query: expect.stringMatching(
            /^\s*select[\s\S]*"relationship_summary_versions"/i,
          ),
        });

      const itemProbe = await database.$client.connect();
      try {
        await itemProbe.query("BEGIN");
        await expect(
          itemProbe.query(
            "SELECT id FROM memory_items WHERE id = $1 FOR UPDATE NOWAIT",
            [memoryId],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await itemProbe.query("ROLLBACK").catch(() => undefined);
        itemProbe.release();
      }

      await blockerDatabase.$client.query("COMMIT");
      await expect(forgetOperation).resolves.toEqual({
        memoryEpoch: 1,
        revision: 2,
      });
    } finally {
      await blockerDatabase.$client.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled(forgetOperation ? [forgetOperation] : []);
      await blockerDatabase.$client.end();
      await forgetDatabase.$client.end();
    }
  });

  test("advances epoch, deletes memory and summaries, cancels old work, preserves transcripts, and audits IDs only", async () => {
    const fixture = await insertFixture();
    const now = new Date("2026-10-10T00:00:00.000Z");
    await database.insert(userCharacterMemorySetting).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryEpoch: 2,
      memoryRevision: 4,
      revision: 3,
    });
    const memoryId = randomUUID();
    await database.insert(memoryItem).values({
      id: memoryId,
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryEpoch: 2,
      type: "other",
      content: "Private memory content.",
      normalizedContent: "Private memory content.",
      normalizedDigest:
        "00f5da329e3d903af9f0841b39515e6e402fa6a9e784d28ba137f0f4ebbb3417",
      origin: "automatic",
      sensitivity: "ordinary",
      explicitness: "direct",
      confidence: 80,
      importance: 80,
      firstObservedAt: now,
      lastConfirmedAt: now,
    });
    await database.insert(memoryEvidence).values({
      id: randomUUID(),
      memoryId,
      sourceDeletedAt: now,
      observedAt: now,
      evidenceKind: "direct",
    });
    const summaryVersionId = randomUUID();
    await database.insert(relationshipSummaryVersion).values({
      id: summaryVersionId,
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryEpoch: 2,
      content: "Private summary content.",
      origin: "automatic",
      basedOnMemoryRevision: 4,
    });
    await database.insert(relationshipSummary).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryEpoch: 2,
      currentVersionId: summaryVersionId,
      revision: 2,
    });
    const extractionRunId = randomUUID();
    const completeRunId = randomUUID();
    const summaryRunId = randomUUID();
    const conversationId = randomUUID();
    const firstUserMessageId = randomUUID();
    const firstAssistantMessageId = randomUUID();
    const secondUserMessageId = randomUUID();
    const secondAssistantMessageId = randomUUID();
    const firstAttemptId = randomUUID();
    const secondAttemptId = randomUUID();
    await database.insert(conversation).values({
      id: conversationId,
      userId: fixture.userId,
      characterId: fixture.characterId,
      characterVersionId: fixture.characterVersionId,
      lastMessageAt: now,
    });
    await database.insert(conversationMessage).values([
      {
        id: firstUserMessageId,
        conversationId,
        sequence: 1,
        role: "user",
        kind: "user",
        content: "Transcript must remain.",
        clientRequestId: randomUUID(),
      },
      {
        id: firstAssistantMessageId,
        conversationId,
        sequence: 2,
        role: "assistant",
        kind: "generated",
        inReplyTo: firstUserMessageId,
      },
      {
        id: secondUserMessageId,
        conversationId,
        sequence: 3,
        role: "user",
        kind: "user",
        content: "A second message.",
        clientRequestId: randomUUID(),
      },
      {
        id: secondAssistantMessageId,
        conversationId,
        sequence: 4,
        role: "assistant",
        kind: "generated",
        inReplyTo: secondUserMessageId,
      },
    ]);
    await database.insert(generationAttempt).values([
      {
        id: firstAttemptId,
        userId: fixture.userId,
        assistantMessageId: firstAssistantMessageId,
        clientRequestId: randomUUID(),
        attemptNumber: 1,
        status: "complete",
        content: "First complete response.",
        extractionMemoryEpoch: 2,
        modelId: "test-model",
        completedAt: now,
      },
      {
        id: secondAttemptId,
        userId: fixture.userId,
        assistantMessageId: secondAssistantMessageId,
        clientRequestId: randomUUID(),
        attemptNumber: 1,
        status: "complete",
        content: "Second complete response.",
        extractionMemoryEpoch: 2,
        modelId: "test-model",
        completedAt: now,
      },
    ]);
    await database.insert(memoryExtractionRun).values([
      {
        id: extractionRunId,
        userId: fixture.userId,
        characterId: fixture.characterId,
        conversationId,
        generationAttemptId: firstAttemptId,
        memoryEpoch: 2,
        status: "running",
        startedAt: now,
      },
      {
        id: completeRunId,
        userId: fixture.userId,
        characterId: fixture.characterId,
        conversationId,
        generationAttemptId: secondAttemptId,
        memoryEpoch: 2,
        status: "complete",
        finishedAt: now,
      },
    ]);
    await database.insert(relationshipSummaryRun).values({
      id: summaryRunId,
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryEpoch: 2,
      expectedSummaryRevision: 2,
      basedOnMemoryRevision: 4,
      status: "retrying",
      nextRetryAt: new Date("2026-10-10T00:01:00.000Z"),
    });
    const result = await forgetCharacter(database, {
      userId: fixture.userId,
      characterId: fixture.characterId,
      expectedRevision: 3,
    });

    expect(result).toEqual({ memoryEpoch: 3, revision: 4 });
    const [settings] = await database.select().from(userCharacterMemorySetting);
    expect(settings).toMatchObject({
      memoryEpoch: 3,
      memoryRevision: 5,
      revision: 4,
    });
    expect(await database.select().from(memoryItem)).toHaveLength(0);
    expect(await database.select().from(memoryEvidence)).toHaveLength(0);
    expect(await database.select().from(relationshipSummary)).toHaveLength(0);
    expect(
      await database.select().from(relationshipSummaryVersion),
    ).toHaveLength(0);
    const runs = await database
      .select({
        id: memoryExtractionRun.id,
        status: memoryExtractionRun.status,
        finishedAt: memoryExtractionRun.finishedAt,
      })
      .from(memoryExtractionRun);
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: extractionRunId,
          status: "cancelled",
          finishedAt: expect.any(Date),
        }),
        expect.objectContaining({
          id: completeRunId,
          status: "complete",
          finishedAt: now,
        }),
      ]),
    );
    const [summaryRun] = await database.select().from(relationshipSummaryRun);
    expect(summaryRun).toMatchObject({
      id: summaryRunId,
      status: "cancelled",
      finishedAt: expect.any(Date),
    });
    expect(
      await database
        .select()
        .from(conversationMessage)
        .where(eq(conversationMessage.id, firstUserMessageId)),
    ).toHaveLength(1);
    const [audit] = await database.select().from(adminAuditEvent);
    expect(audit).toMatchObject({
      actorUserId: fixture.userId,
      actorLabel: "user",
      action: "memory.character_forget",
      targetType: "character",
      targetId: fixture.characterId,
      metadata: { memoryEpoch: 3, revision: 4 },
    });
    expect(JSON.stringify(audit)).not.toContain("Private");
    expect(JSON.stringify(audit)).not.toContain("Transcript must remain.");
  });

  test("cancels every nonterminal operation from an older relationship epoch", async () => {
    const fixture = await insertFixture();
    const olderRunId = randomUUID();
    const currentRunId = randomUUID();
    await database.insert(userCharacterMemorySetting).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryEpoch: 1,
      memoryRevision: 1,
      revision: 3,
    });
    await database.insert(relationshipSummaryRun).values({
      id: olderRunId,
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryEpoch: 1,
      expectedSummaryRevision: 0,
      basedOnMemoryRevision: 1,
      status: "running",
      startedAt: new Date(),
    });
    await database
      .update(userCharacterMemorySetting)
      .set({ memoryEpoch: 2, memoryRevision: 2 })
      .where(
        and(
          eq(userCharacterMemorySetting.userId, fixture.userId),
          eq(userCharacterMemorySetting.characterId, fixture.characterId),
        ),
      );
    await database.insert(relationshipSummaryRun).values({
      id: currentRunId,
      userId: fixture.userId,
      characterId: fixture.characterId,
      memoryEpoch: 2,
      expectedSummaryRevision: 0,
      basedOnMemoryRevision: 2,
      status: "queued",
    });

    await forgetCharacter(database, {
      userId: fixture.userId,
      characterId: fixture.characterId,
      expectedRevision: 3,
    });

    const runs = await database
      .select({
        id: relationshipSummaryRun.id,
        status: relationshipSummaryRun.status,
      })
      .from(relationshipSummaryRun);
    expect(runs).toEqual(
      expect.arrayContaining([
        { id: olderRunId, status: "cancelled" },
        { id: currentRunId, status: "cancelled" },
      ]),
    );
  });
});

describe("user-edit authority under concurrency", () => {
  test("a queued automatic merge observes user_edited and cannot overwrite the edit", async () => {
    const fixture = await insertFixture();
    await database.insert(userCharacterMemorySetting).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
    });
    const memoryId = await insertMemory(fixture);
    const blockerDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "memory-user-lock-blocker",
      max: 1,
    });
    const editDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "memory-user-edit-race",
      max: 1,
    });
    const mergeDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "memory-automatic-merge-race",
      max: 1,
    });
    let editOperation: Promise<{ revision: number }> | undefined;
    let mergeOperation: Promise<number> | undefined;

    try {
      await blockerDatabase.$client.query("BEGIN");
      await blockerDatabase.$client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`chat-user:${fixture.userId}`],
      );

      editOperation = editMemoryItem(editDatabase, {
        userId: fixture.userId,
        characterId: fixture.characterId,
        memoryId,
        expectedRevision: 1,
        content: "User-authored text.",
      });
      void editOperation.catch(() => undefined);
      await expect
        .poll(async () => {
          const result = await database.$client.query<{
            blocker_name: string;
            query: string;
            waiter_granted: boolean;
          }>(
            `
              SELECT
                blocker.application_name AS blocker_name,
                waiter.query,
                waiter_lock.granted AS waiter_granted
              FROM pg_stat_activity waiter
              JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) blocker_pid
                ON true
              JOIN pg_stat_activity blocker ON blocker.pid = blocker_pid
              JOIN pg_locks waiter_lock
                ON waiter_lock.pid = waiter.pid
               AND waiter_lock.locktype = 'advisory'
               AND NOT waiter_lock.granted
              WHERE waiter.application_name = 'memory-user-edit-race'
            `,
          );
          return result.rows[0] ?? null;
        })
        .toMatchObject({
          blocker_name: "memory-user-lock-blocker",
          query: expect.stringContaining("pg_advisory_xact_lock"),
          waiter_granted: false,
        });

      mergeOperation = mergeDatabase.transaction(async (transaction) => {
        await lockUserMemoryMutation(transaction, fixture.userId);
        await lockUserCharacterChatMutation(
          transaction,
          fixture.userId,
          fixture.characterId,
        );
        const updated = await transaction
          .update(memoryItem)
          .set({
            content: "Automatic overwrite.",
            normalizedContent: "Automatic overwrite.",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(memoryItem.id, memoryId),
              eq(memoryItem.userId, fixture.userId),
              eq(memoryItem.characterId, fixture.characterId),
              eq(memoryItem.origin, "automatic"),
            ),
          )
          .returning({ id: memoryItem.id });
        return updated.length;
      });
      void mergeOperation.catch(() => undefined);
      await expect
        .poll(async () => {
          const result = await database.$client.query<{
            advisory_count: string;
            blocker_name: string;
            query: string;
          }>(
            `
              SELECT
                COUNT(advisory_locks.*)::text AS advisory_count,
                blocker.application_name AS blocker_name,
                waiter.query
              FROM pg_stat_activity waiter
              JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) blocker_pid
                ON true
              JOIN pg_stat_activity blocker ON blocker.pid = blocker_pid
              LEFT JOIN pg_locks advisory_locks
                ON advisory_locks.pid = waiter.pid
               AND advisory_locks.locktype = 'advisory'
              WHERE waiter.application_name = 'memory-automatic-merge-race'
              GROUP BY blocker.application_name, waiter.query
            `,
          );
          return result.rows[0] ?? null;
        })
        .toMatchObject({
          advisory_count: "0",
          blocker_name: "memory-user-edit-race",
          query: expect.stringContaining('"chat_settings"'),
        });

      await blockerDatabase.$client.query("COMMIT");
      await expect(editOperation).resolves.toEqual({ revision: 2 });
      await expect(mergeOperation).resolves.toBe(0);

      const [finalItem] = await database
        .select({ content: memoryItem.content, origin: memoryItem.origin })
        .from(memoryItem)
        .where(eq(memoryItem.id, memoryId));
      expect(finalItem).toEqual({
        content: "User-authored text.",
        origin: "user_edited",
      });
    } finally {
      await blockerDatabase.$client.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([
        editOperation ?? Promise.resolve({ revision: 0 }),
        mergeOperation ?? Promise.resolve(0),
      ]);
      await blockerDatabase.$client.end();
      await editDatabase.$client.end();
      await mergeDatabase.$client.end();
    }
  });
});
