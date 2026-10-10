// @vitest-environment node
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { characterContentDigest } from "@/server/characters/content-digest";
import { ChatDomainError } from "@/server/chat/chat-errors";
import { createDatabase, type Database } from "@/server/db/client";
import {
  character,
  characterVersion,
  chatSettings,
  conversation,
  conversationMessage,
  generationAttempt,
  generationLease,
  memorySettings,
  quotaBucket,
  usageLedger,
  user,
  memoryItem,
  memoryEvidence,
  memoryExtractionRun,
  memoryExtractionExecution,
  userCharacterMemorySetting,
  relationshipSummaryVersion,
} from "@/server/db/schema";
import {
  extractionFixture,
  extractionAttempt,
  extractionCandidate,
  extractionCounter,
  extractionGateway,
  extractionResult,
  extractionNow,
  waitForExtractionLock,
} from "@/test/memory-extraction-fixture";
import {
  createExtractionRunForCompletedAttempt,
  lockExtractionRelationship,
} from "@/server/memory/memory-extraction-service";
import { processMemoryExtractionRun } from "@/server/memory/memory-job";
import { forgetCharacter } from "@/server/memory/memory-service";
import { editRelationshipSummary } from "@/server/memory/relationship-summary-service";
import { getCharacterMemoryView } from "@/server/memory/memory-queries";
import { testDatabaseUrl } from "@/test/database-target";
import { lockUserChatMutation } from "./chat-locks";
import { createConversationService } from "./conversation-service";
import { getConversationForUser } from "./conversation-queries";

const database = createDatabase(testDatabaseUrl());
const service = createConversationService(database);

async function memoryDeletionFixture() {
  await database
    .update(memorySettings)
    .set({ createdAt: new Date(extractionNow.getTime() - 1000) });
  const fixture = await extractionFixture(database);
  const first = await extractionAttempt(database, fixture);
  const run = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, {
      ...fixture,
      ...first,
      now: extractionNow,
    }),
  );
  await processMemoryExtractionRun(
    database,
    extractionGateway(async () =>
      extractionResult([extractionCandidate(first.sourceMessageId)]),
    ),
    extractionCounter,
    run!.runId,
    new AbortController().signal,
  );
  await editRelationshipSummary(
    database,
    { ...fixture, expectedRevision: 0, content: "We discuss tea." },
    { maxSummaryCharacters: 4000, secretValues: [] },
  );
  const second = await extractionAttempt(
    database,
    fixture,
    3,
    "I enjoy hiking.",
  );
  const pending = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, {
      ...fixture,
      ...second,
      now: extractionNow,
    }),
  );
  await database
    .update(memoryExtractionRun)
    .set({ jobId: "queued-memory-job" })
    .where(eq(memoryExtractionRun.id, pending!.runId));
  return { ...fixture, ...second, runId: pending!.runId };
}

test("conversation deletion retains formed memory, nulls evidence, cancels jobs and does not advance epoch", async () => {
  const input = await memoryDeletionFixture();
  await service.delete(input);
  expect(await getConversationForUser(database, input)).toBeNull();
  expect(await database.select().from(conversationMessage)).toEqual([]);
  expect(await database.select().from(memoryItem)).toMatchObject([
    { content: "Likes green tea.", isActive: true },
  ]);
  expect(await database.select().from(memoryEvidence)).toMatchObject([
    {
      sourceMessageId: null,
      sourceAttemptId: null,
      sourceDeletedAt: expect.any(Date),
    },
  ]);
  const [run] = await database
    .select()
    .from(memoryExtractionRun)
    .where(eq(memoryExtractionRun.id, input.runId));
  expect(run).toMatchObject({
    status: "cancelled",
    conversationId: null,
    generationAttemptId: null,
    jobId: null,
    nextRetryAt: null,
    claimToken: null,
    leaseExpiresAt: null,
  });
  expect(
    (await database.select().from(userCharacterMemorySetting))[0].memoryEpoch,
  ).toBe(0);
  expect((await getCharacterMemoryView(database, input))?.items).toHaveLength(
    1,
  );
});

test.each(["delete", "forget"] as const)(
  "named PostgreSQL %s service fences a ready provider response and replay cannot resurrect content",
  async (kind) => {
    const input = await memoryDeletionFixture();
    const writerName = `task8-${kind}-receipt`;
    const writer = createDatabase(testDatabaseUrl(), {
      application_name: writerName,
      max: 1,
    });
    const mutator = createDatabase(testDatabaseUrl(), {
      application_name: `task8-${kind}-service`,
      max: 1,
    });
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = processMemoryExtractionRun(
      writer,
      extractionGateway(async () => {
        enter();
        await ready;
        return extractionResult([
          extractionCandidate(input.sourceMessageId, {
            content: "Enjoys hiking.",
          }),
        ]);
      }),
      extractionCounter,
      input.runId,
      new AbortController().signal,
    );
    try {
      await entered;
      await mutator.transaction(async (tx) => {
        await lockExtractionRelationship(tx, input);
        release();
        expect(await waitForExtractionLock(database, writerName)).toMatch(
          /chat_settings/,
        );
        if (kind === "delete")
          await createConversationService(tx as unknown as Database).delete(
            input,
          );
        else
          await forgetCharacter(tx as unknown as Database, {
            ...input,
            expectedRevision: 1,
          });
      });

      await work;
      await processMemoryExtractionRun(
        writer,
        extractionGateway(async () => {
          throw new Error("No provider replay");
        }),
        extractionCounter,
        input.runId,
        new AbortController().signal,
      );
      const view = await getCharacterMemoryView(database, input);
      expect(view?.items.map((item) => item.content)).toEqual(
        kind === "delete" ? ["Likes green tea."] : [],
      );
      expect(view?.settings.memoryEpoch).toBe(kind === "delete" ? 0 : 1);
      expect(
        (
          await database
            .select()
            .from(memoryExtractionExecution)
            .where(eq(memoryExtractionExecution.runId, input.runId))
        )[0].candidates,
      ).toBeNull();
      if (kind === "forget") {
        expect(await getConversationForUser(database, input)).not.toBeNull();
        expect(await database.select().from(memoryEvidence)).toEqual([]);
        expect(
          await database.select().from(relationshipSummaryVersion),
        ).toEqual([]);
      }
    } finally {
      release();
      await Promise.allSettled([work]);
      await writer.$client.end();
      await mutator.$client.end();
    }
  },
);

test.each(["delete", "forget"] as const)(
  "named PostgreSQL %s service cancels an already-staged durable receipt before application",
  async (kind) => {
    const input = await memoryDeletionFixture();
    const writerName = `task8-${kind}-staged-apply`;
    const writer = createDatabase(testDatabaseUrl(), {
      application_name: writerName,
      max: 1,
    });
    const mutator = createDatabase(testDatabaseUrl(), {
      application_name: `task8-${kind}-staged-mutation`,
      max: 1,
    });
    let work: Promise<void> | undefined;
    try {
      await database.execute(
        sql.raw(`
      CREATE FUNCTION task8_pause_apply() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'pause application'; END $$;
      CREATE TRIGGER task8_pause_apply BEFORE INSERT ON usage_ledger
      FOR EACH ROW EXECUTE FUNCTION task8_pause_apply()
    `),
      );
      try {
        await expect(
          processMemoryExtractionRun(
            writer,
            extractionGateway(async () =>
              extractionResult([
                extractionCandidate(input.sourceMessageId, {
                  content: "Enjoys hiking.",
                }),
              ]),
            ),
            extractionCounter,
            input.runId,
            new AbortController().signal,
          ),
        ).rejects.toBeDefined();
      } finally {
        await database.execute(
          sql.raw(
            "DROP TRIGGER task8_pause_apply ON usage_ledger; DROP FUNCTION task8_pause_apply()",
          ),
        );
      }
      expect(
        (
          await database
            .select()
            .from(memoryExtractionExecution)
            .where(eq(memoryExtractionExecution.runId, input.runId))
        )[0],
      ).toMatchObject({
        responseAt: expect.any(Date),
        settledAt: null,
        candidates: [{ content: "Enjoys hiking." }],
      });
      await mutator.transaction(async (tx) => {
        await lockExtractionRelationship(tx, input);
        work = processMemoryExtractionRun(
          writer,
          extractionGateway(async () => {
            throw new Error("Replay cannot call provider");
          }),
          extractionCounter,
          input.runId,
          new AbortController().signal,
        );
        expect(await waitForExtractionLock(database, writerName)).toMatch(
          /chat_settings/,
        );
        if (kind === "delete")
          await createConversationService(tx as unknown as Database).delete(
            input,
          );
        else
          await forgetCharacter(tx as unknown as Database, {
            ...input,
            expectedRevision: 1,
          });
      });
      await work;
      expect(
        (await getCharacterMemoryView(database, input))?.items.map(
          (item) => item.content,
        ),
      ).toEqual(kind === "delete" ? ["Likes green tea."] : []);
      expect(
        (
          await database
            .select()
            .from(memoryExtractionExecution)
            .where(eq(memoryExtractionExecution.runId, input.runId))
        )[0].candidates,
      ).toBeNull();
    } finally {
      await Promise.allSettled([work]);
      await writer.$client.end();
      await mutator.$client.end();
    }
  },
);

test("deletion waits for the canonical named relationship lock before transcript cascade", async () => {
  const input = await memoryDeletionFixture();
  const blocker = createDatabase(testDatabaseUrl(), {
    application_name: "task8-relationship-blocker",
    max: 1,
  });
  const deleter = createDatabase(testDatabaseUrl(), {
    application_name: "task8-relationship-deleter",
    max: 1,
  });
  let deletion: Promise<void> | undefined;
  try {
    await blocker.$client.query("BEGIN");
    await blocker.$client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`chat-user-character:${input.userId}:${input.characterId}`],
    );
    deletion = createConversationService(deleter).delete(input);
    expect(
      await waitForExtractionLock(database, "task8-relationship-deleter"),
    ).toMatch(/pg_advisory_xact_lock/);
    expect(await getConversationForUser(database, input)).not.toBeNull();
    await blocker.$client.query("COMMIT");
    await deletion;
    expect(await getConversationForUser(database, input)).toBeNull();
  } finally {
    await blocker.$client.query("ROLLBACK");
    await Promise.allSettled([deletion]);
    await blocker.$client.end();
    await deleter.$client.end();
  }
});

test("named concurrent delete and forget serialize without resurrecting memory or transcript", async () => {
  const input = await memoryDeletionFixture();
  const deleter = createDatabase(testDatabaseUrl(), {
    application_name: "task8-delete-forget-delete",
    max: 1,
  });
  const forgetter = createDatabase(testDatabaseUrl(), {
    application_name: "task8-delete-forget-forget",
    max: 1,
  });
  try {
    await Promise.all([
      createConversationService(deleter).delete(input),
      forgetCharacter(forgetter, { ...input, expectedRevision: 1 }),
    ]);
    expect(await getConversationForUser(database, input)).toBeNull();
    expect(await database.select().from(memoryItem)).toEqual([]);
    expect(await database.select().from(memoryEvidence)).toEqual([]);
    expect(await database.select().from(relationshipSummaryVersion)).toEqual(
      [],
    );
    expect(
      (await database.select().from(userCharacterMemorySetting))[0].memoryEpoch,
    ).toBe(1);
  } finally {
    await deleter.$client.end();
    await forgetter.$client.end();
  }
});

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
  await database.execute(
    sql.raw(`
      TRUNCATE TABLE
        usage_ledger,
        generation_leases,
        quota_reservations,
        quota_buckets,
        user_chat_quota_overrides,
        memory_settings,
        chat_settings,
        generation_attempts,
        conversation_messages,
        conversations,
        character_drafts,
        character_versions,
        characters,
        "user"
      RESTART IDENTITY CASCADE
    `),
  );
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

async function insertUser(name = "Chat User"): Promise<string> {
  const id = randomUUID();
  await database.insert(user).values({
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
  });
  return id;
}

async function insertCharacterFixture(options?: {
  lifecycle?: "active" | "archived";
  slug?: string;
}) {
  const characterId = randomUUID();
  const versionOneId = randomUUID();
  const versionTwoId = randomUUID();
  const versionOne = {
    ...baseContent,
    displayName: "Mira v1",
    openingMessage: "Opening from version one.",
  };
  const versionTwo = {
    ...baseContent,
    displayName: "Mira v2",
    openingMessage: "Opening from version two.",
  };
  const lifecycle = options?.lifecycle ?? "active";

  await database.insert(character).values({
    id: characterId,
    slug: options?.slug ?? `mira-${characterId}`,
    lifecycle,
    archivedAt: lifecycle === "archived" ? new Date() : null,
  });
  await database.insert(characterVersion).values([
    {
      id: versionOneId,
      characterId,
      versionNumber: 1,
      ...versionOne,
      contentDigest: characterContentDigest(versionOne),
      publishedAt: new Date("2026-10-01T00:00:00.000Z"),
    },
    {
      id: versionTwoId,
      characterId,
      versionNumber: 2,
      ...versionTwo,
      contentDigest: characterContentDigest(versionTwo),
      publishedAt: new Date("2026-10-02T00:00:00.000Z"),
    },
  ]);
  await database
    .update(character)
    .set({ defaultVersionId: versionOneId })
    .where(eq(character.id, characterId));

  return { characterId, versionOneId, versionTwoId, versionOne, versionTwo };
}

async function selectDefaultVersion(
  characterId: string,
  versionId: string | null,
) {
  await database
    .update(character)
    .set({ defaultVersionId: versionId })
    .where(eq(character.id, characterId));
}

async function setCharacterLifecycle(
  characterId: string,
  lifecycle: "active" | "archived",
) {
  await database
    .update(character)
    .set({
      lifecycle,
      archivedAt: lifecycle === "archived" ? new Date() : null,
    })
    .where(eq(character.id, characterId));
}

async function getConversationVersion(conversationId: string) {
  const [row] = await database
    .select({ versionId: conversation.characterVersionId })
    .from(conversation)
    .where(eq(conversation.id, conversationId));
  return row?.versionId;
}

async function getConversationRows(userId: string, characterId: string) {
  return database
    .select({
      id: conversation.id,
      lifecycle: conversation.lifecycle,
      archivedAt: conversation.archivedAt,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.userId, userId),
        eq(conversation.characterId, characterId),
      ),
    );
}

async function insertGenerationWithLease(input: {
  conversationId: string;
  userId: string;
  executor?: Pick<Database, "insert">;
}) {
  const executor = input.executor ?? database;
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const attemptId = randomUUID();
  await executor.insert(conversationMessage).values([
    {
      id: userMessageId,
      conversationId: input.conversationId,
      sequence: 2,
      role: "user",
      kind: "user",
      content: "Continue",
      clientRequestId: randomUUID(),
    },
    {
      id: assistantMessageId,
      conversationId: input.conversationId,
      sequence: 3,
      role: "assistant",
      kind: "generated",
      inReplyTo: userMessageId,
    },
  ]);
  await executor.insert(generationAttempt).values({
    id: attemptId,
    userId: input.userId,
    assistantMessageId,
    attemptNumber: 1,
    status: "streaming",
    content: "Partial",
    modelId: "test-model",
  });
  await executor.insert(generationLease).values({
    attemptId,
    userId: input.userId,
    ownerToken: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  return attemptId;
}

function expectChatError(
  promise: Promise<unknown>,
  code: ChatDomainError["code"],
) {
  return expect(promise).rejects.toMatchObject({
    code,
  });
}

async function waitForApplicationLockWait(
  applicationName: string,
): Promise<string> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const result = await database.$client.query<{
      query: string;
      wait_event_type: string | null;
    }>(
      `
        SELECT query, wait_event_type
        FROM pg_stat_activity
        WHERE application_name = $1
          AND state = 'active'
      `,
      [applicationName],
    );
    const waiting = result.rows.find((row) => row.wait_event_type === "Lock");
    if (waiting) {
      return waiting.query;
    }
    await delay(10);
  }

  throw new Error(`${applicationName} did not wait on a PostgreSQL lock`);
}

describe("conversation lifecycle service", () => {
  test("first open pins the current default with one opening and later opens reuse it", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();

    const first = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });
    expect(first.created).toBe(true);
    expect(await getConversationVersion(first.conversationId)).toBe(
      fixture.versionOneId,
    );

    const second = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });
    expect(second).toEqual({
      conversationId: first.conversationId,
      created: false,
    });

    const openings = await database
      .select({
        content: conversationMessage.content,
      })
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, first.conversationId));
    expect(openings).toEqual([{ content: fixture.versionOne.openingMessage }]);
  });

  test("two concurrent opens return one active conversation ID", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();
    const firstDatabase = createDatabase(testDatabaseUrl(), { max: 1 });
    const secondDatabase = createDatabase(testDatabaseUrl(), { max: 1 });

    try {
      const [first, second] = await Promise.all([
        createConversationService(firstDatabase).openOrCreate({
          userId,
          characterId: fixture.characterId,
        }),
        createConversationService(secondDatabase).openOrCreate({
          userId,
          characterId: fixture.characterId,
        }),
      ]);

      expect(first.conversationId).toBe(second.conversationId);
      expect([first.created, second.created].sort()).toEqual([false, true]);
      expect(
        await getConversationRows(userId, fixture.characterId),
      ).toHaveLength(1);
    } finally {
      await firstDatabase.$client.end();
      await secondDatabase.$client.end();
    }
  });

  test("changing the default keeps the old pin and restart uses the new default", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();
    const opened = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });

    expect(await getConversationVersion(opened.conversationId)).toBe(
      fixture.versionOneId,
    );
    await selectDefaultVersion(fixture.characterId, fixture.versionTwoId);
    expect(await getConversationVersion(opened.conversationId)).toBe(
      fixture.versionOneId,
    );

    const restarted = await service.restart({
      userId,
      conversationId: opened.conversationId,
    });
    expect(await getConversationVersion(restarted.conversationId)).toBe(
      fixture.versionTwoId,
    );

    const rows = await getConversationRows(userId, fixture.characterId);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: opened.conversationId,
          lifecycle: "archived",
          archivedAt: expect.any(Date),
        }),
        expect.objectContaining({
          id: restarted.conversationId,
          lifecycle: "active",
          archivedAt: null,
        }),
      ]),
    );
    const opening = await database
      .select({ content: conversationMessage.content })
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, restarted.conversationId));
    expect(opening).toEqual([{ content: fixture.versionTwo.openingMessage }]);
  });

  test.each(["open", "restart"] as const)(
    "%s waits for an in-flight default change and pins the committed default",
    async (operation) => {
      const userId = await insertUser();
      const fixture = await insertCharacterFixture();
      const original =
        operation === "restart"
          ? await service.openOrCreate({
              userId,
              characterId: fixture.characterId,
            })
          : null;
      const applicationName = `conversation-${operation}-default-race`;
      const operationDatabase = createDatabase(testDatabaseUrl(), {
        application_name: applicationName,
        max: 1,
      });
      const blocker = await database.$client.connect();
      let blockerCommitted = false;
      let lifecycleOperation:
        | Promise<
            | { conversationId: string; created: boolean }
            | { conversationId: string }
          >
        | undefined;

      try {
        await blocker.query("BEGIN");
        await blocker.query(
          `
            UPDATE characters
            SET default_version_id = $2
            WHERE id = $1
          `,
          [fixture.characterId, fixture.versionTwoId],
        );

        const operationService = createConversationService(operationDatabase);
        lifecycleOperation =
          operation === "open"
            ? operationService.openOrCreate({
                userId,
                characterId: fixture.characterId,
              })
            : operationService.restart({
                userId,
                conversationId: original!.conversationId,
              });
        void lifecycleOperation.catch(() => undefined);

        const waitingQuery = await waitForApplicationLockWait(applicationName);
        expect(waitingQuery).toMatch(/characters/i);

        await blocker.query("COMMIT");
        blockerCommitted = true;

        const result = await lifecycleOperation;
        expect(await getConversationVersion(result.conversationId)).toBe(
          fixture.versionTwoId,
        );
      } finally {
        if (!blockerCommitted) {
          await blocker.query("ROLLBACK").catch(() => undefined);
        }
        blocker.release();
        await Promise.allSettled(
          lifecycleOperation ? [lifecycleOperation] : [],
        );
        await operationDatabase.$client.end();
      }
    },
  );

  test.each(["open", "restart"] as const)(
    "%s waits for an in-flight archive and observes the committed lifecycle",
    async (operation) => {
      const userId = await insertUser();
      const fixture = await insertCharacterFixture();
      const original =
        operation === "restart"
          ? await service.openOrCreate({
              userId,
              characterId: fixture.characterId,
            })
          : null;
      const applicationName = `conversation-${operation}-archive-race`;
      const operationDatabase = createDatabase(testDatabaseUrl(), {
        application_name: applicationName,
        max: 1,
      });
      const blocker = await database.$client.connect();
      let blockerCommitted = false;
      let lifecycleOperation:
        | Promise<
            | { conversationId: string; created: boolean }
            | { conversationId: string }
          >
        | undefined;

      try {
        await blocker.query("BEGIN");
        await blocker.query(
          `
            UPDATE characters
            SET lifecycle = 'archived',
                archived_at = NOW()
            WHERE id = $1
          `,
          [fixture.characterId],
        );

        const operationService = createConversationService(operationDatabase);
        lifecycleOperation =
          operation === "open"
            ? operationService.openOrCreate({
                userId,
                characterId: fixture.characterId,
              })
            : operationService.restart({
                userId,
                conversationId: original!.conversationId,
              });
        void lifecycleOperation.catch(() => undefined);

        const waitingQuery = await waitForApplicationLockWait(applicationName);
        expect(waitingQuery).toMatch(/characters/i);

        await blocker.query("COMMIT");
        blockerCommitted = true;

        await expect(lifecycleOperation).rejects.toMatchObject({
          code: "CHAT_READ_ONLY",
        });
        if (original) {
          await expect(
            getConversationRows(userId, fixture.characterId),
          ).resolves.toEqual([
            expect.objectContaining({
              id: original.conversationId,
              lifecycle: "active",
            }),
          ]);
        } else {
          await expect(
            getConversationRows(userId, fixture.characterId),
          ).resolves.toEqual([]);
        }
      } finally {
        if (!blockerCommitted) {
          await blocker.query("ROLLBACK").catch(() => undefined);
        }
        blocker.release();
        await Promise.allSettled(
          lifecycleOperation ? [lifecycleOperation] : [],
        );
        await operationDatabase.$client.end();
      }
    },
  );

  test("an archived character keeps its existing active conversation readable and reusable", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();
    const opened = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });
    await setCharacterLifecycle(fixture.characterId, "archived");

    await expect(
      service.openOrCreate({
        userId,
        characterId: fixture.characterId,
      }),
    ).resolves.toEqual({
      conversationId: opened.conversationId,
      created: false,
    });
    await expect(
      getConversationForUser(database, {
        userId,
        conversationId: opened.conversationId,
      }),
    ).resolves.toMatchObject({
      id: opened.conversationId,
      lifecycle: "active",
    });
    await expectChatError(
      service.restart({
        userId,
        conversationId: opened.conversationId,
      }),
      "CHAT_READ_ONLY",
    );

    const anotherUserId = await insertUser("Another user");
    await expectChatError(
      service.openOrCreate({
        userId: anotherUserId,
        characterId: fixture.characterId,
      }),
      "CHAT_READ_ONLY",
    );
  });

  test("restart failure leaves the original conversation active", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();
    const opened = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });
    await selectDefaultVersion(fixture.characterId, null);

    await expectChatError(
      service.restart({
        userId,
        conversationId: opened.conversationId,
      }),
      "CHAT_READ_ONLY",
    );
    await expect(
      getConversationRows(userId, fixture.characterId),
    ).resolves.toEqual([
      expect.objectContaining({
        id: opened.conversationId,
        lifecycle: "active",
        archivedAt: null,
      }),
    ]);
  });

  test("archived rows are never restored and cannot be restarted", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();
    const first = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });
    const second = await service.restart({
      userId,
      conversationId: first.conversationId,
    });

    await expectChatError(
      service.restart({ userId, conversationId: first.conversationId }),
      "CHAT_READ_ONLY",
    );
    await expect(
      service.openOrCreate({
        userId,
        characterId: fixture.characterId,
      }),
    ).resolves.toEqual({
      conversationId: second.conversationId,
      created: false,
    });

    const [archived] = await database
      .select({
        lifecycle: conversation.lifecycle,
        archivedAt: conversation.archivedAt,
      })
      .from(conversation)
      .where(eq(conversation.id, first.conversationId));
    expect(archived).toEqual({
      lifecycle: "archived",
      archivedAt: expect.any(Date),
    });
  });

  test.each(["active", "archived"] as const)(
    "deleting an %s conversation removes content without reducing consumed quota",
    async (lifecycle) => {
      const userId = await insertUser();
      const fixture = await insertCharacterFixture();
      const opened = await service.openOrCreate({
        userId,
        characterId: fixture.characterId,
      });
      if (lifecycle === "archived") {
        await service.restart({
          userId,
          conversationId: opened.conversationId,
        });
      }

      const bucketId = randomUUID();
      const ledgerId = randomUUID();
      const periodStart = new Date("2026-10-09T00:00:00.000Z");
      const periodEnd = new Date("2026-10-10T00:00:00.000Z");
      await database.insert(quotaBucket).values({
        id: bucketId,
        scope: "user",
        userId,
        periodStart,
        periodEnd,
        consumedRequests: 3,
        consumedTokens: 150,
      });
      await database.insert(usageLedger).values({
        id: ledgerId,
        userId,
        conversationId: opened.conversationId,
        periodStart,
        periodEnd,
        userRequestUnits: 1,
        providerCallNumber: 1,
        inputTokens: 50,
        outputTokens: 100,
        usageIsEstimated: false,
        modelId: "test-model",
        outcome: "complete",
      });

      await service.delete({
        userId,
        conversationId: opened.conversationId,
      });

      await expect(
        database
          .select({ id: conversation.id })
          .from(conversation)
          .where(eq(conversation.id, opened.conversationId)),
      ).resolves.toEqual([]);
      await expect(
        database
          .select({
            consumedRequests: quotaBucket.consumedRequests,
            consumedTokens: quotaBucket.consumedTokens,
          })
          .from(quotaBucket)
          .where(eq(quotaBucket.id, bucketId)),
      ).resolves.toEqual([{ consumedRequests: 3, consumedTokens: 150 }]);
      await expect(
        database
          .select({
            id: usageLedger.id,
            conversationId: usageLedger.conversationId,
          })
          .from(usageLedger)
          .where(eq(usageLedger.id, ledgerId)),
      ).resolves.toEqual([{ id: ledgerId, conversationId: null }]);
    },
  );

  test.each(["restart", "delete"] as const)(
    "%s rejects a conversation with an active generation lease",
    async (operation) => {
      const userId = await insertUser();
      const fixture = await insertCharacterFixture();
      const opened = await service.openOrCreate({
        userId,
        characterId: fixture.characterId,
      });
      await insertGenerationWithLease({
        conversationId: opened.conversationId,
        userId,
      });

      const mutation =
        operation === "restart"
          ? service.restart({
              userId,
              conversationId: opened.conversationId,
            })
          : service.delete({
              userId,
              conversationId: opened.conversationId,
            });
      await expect(mutation).rejects.toEqual(
        new ChatDomainError(
          "CHAT_GENERATION_IN_PROGRESS",
          "Stop the current reply before changing this conversation.",
          { retryable: true },
        ),
      );
      await expect(
        getConversationForUser(database, {
          userId,
          conversationId: opened.conversationId,
        }),
      ).resolves.not.toBeNull();
    },
  );

  test.each(["restart", "delete"] as const)(
    "%s waits behind admission's user lock and completes without reversed-lock deadlock",
    async (operation) => {
      const userId = await insertUser();
      const fixture = await insertCharacterFixture();
      const opened = await service.openOrCreate({
        userId,
        characterId: fixture.characterId,
      });
      const admissionDatabase = createDatabase(testDatabaseUrl(), {
        application_name: `conversation-${operation}-admission`,
        max: 1,
      });
      const mutationApplicationName = `conversation-${operation}-mutation`;
      const mutationDatabase = createDatabase(testDatabaseUrl(), {
        application_name: mutationApplicationName,
        max: 1,
      });
      let admissionHasUserLock!: () => void;
      const admissionUserLocked = new Promise<void>((resolve) => {
        admissionHasUserLock = resolve;
      });
      let allowAdmissionConversationLock!: () => void;
      const admissionMayLockConversation = new Promise<void>((resolve) => {
        allowAdmissionConversationLock = resolve;
      });
      let admissionHasLease!: () => void;
      const admissionLeaseInserted = new Promise<void>((resolve) => {
        admissionHasLease = resolve;
      });
      let releaseAdmission!: () => void;
      const admissionRelease = new Promise<void>((resolve) => {
        releaseAdmission = resolve;
      });
      let admission: Promise<void> | undefined;
      let mutation: Promise<{ conversationId: string } | void> | undefined;

      try {
        admission = admissionDatabase.transaction(async (transaction) => {
          await lockUserChatMutation(transaction, userId);
          admissionHasUserLock();
          await admissionMayLockConversation;
          await transaction
            .select({ id: conversation.id })
            .from(conversation)
            .where(
              and(
                eq(conversation.id, opened.conversationId),
                eq(conversation.userId, userId),
              ),
            )
            .for("update");
          await insertGenerationWithLease({
            conversationId: opened.conversationId,
            userId,
            executor: transaction,
          });
          admissionHasLease();
          await admissionRelease;
        });
        void admission.catch(() => undefined);

        await admissionUserLocked;
        const mutationService = createConversationService(mutationDatabase);
        mutation =
          operation === "restart"
            ? mutationService.restart({
                userId,
                conversationId: opened.conversationId,
              })
            : mutationService.delete({
                userId,
                conversationId: opened.conversationId,
              });
        void mutation.catch(() => undefined);

        const waitingQuery = await waitForApplicationLockWait(
          mutationApplicationName,
        );
        expect(waitingQuery).toMatch(/chat_settings/i);

        allowAdmissionConversationLock();
        await admissionLeaseInserted;
        releaseAdmission();

        await admission;
        await expect(mutation).rejects.toMatchObject({
          code: "CHAT_GENERATION_IN_PROGRESS",
          retryable: true,
        });
      } finally {
        allowAdmissionConversationLock();
        releaseAdmission();
        await Promise.allSettled([
          ...(admission ? [admission] : []),
          ...(mutation ? [mutation] : []),
        ]);
        await admissionDatabase.$client.end();
        await mutationDatabase.$client.end();
      }
    },
    5_000,
  );

  test("restart and delete hide other users' conversations as not found", async () => {
    const ownerId = await insertUser("Owner");
    const otherUserId = await insertUser("Other");
    const fixture = await insertCharacterFixture();
    const opened = await service.openOrCreate({
      userId: ownerId,
      characterId: fixture.characterId,
    });

    await expectChatError(
      service.restart({
        userId: otherUserId,
        conversationId: opened.conversationId,
      }),
      "CHAT_NOT_FOUND",
    );
    await expectChatError(
      service.delete({
        userId: otherUserId,
        conversationId: opened.conversationId,
      }),
      "CHAT_NOT_FOUND",
    );
    await expect(
      getConversationForUser(database, {
        userId: otherUserId,
        conversationId: opened.conversationId,
      }),
    ).resolves.toBeNull();
  });
});
