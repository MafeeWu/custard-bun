// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
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
  quotaBucket,
  quotaReservation,
  usageLedger,
  user,
  userChatQuotaOverride,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  admitGeneration,
  deleteUserWithGenerationSettlement,
  instancePeriod,
  reconcileExpiredLeases,
  resolveEffectiveLimits,
  settleGeneration,
  userPeriod,
} from "./quota-service";

const database = createDatabase(testDatabaseUrl());
const now = new Date("2026-10-09T12:00:00.000Z");

const characterContent = {
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
  await insertSettings();
});

afterAll(async () => {
  await database.$client.end();
});

async function insertSettings(
  overrides: Partial<typeof chatSettings.$inferInsert> = {},
) {
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
    ...overrides,
  });
}

async function replaceSettings(
  overrides: Partial<typeof chatSettings.$inferInsert>,
) {
  await database.delete(chatSettings);
  await insertSettings(overrides);
}

async function insertUser(options?: { banned?: boolean }) {
  const id = randomUUID();
  await database.insert(user).values({
    id,
    name: "Chat User",
    email: `${id}@example.com`,
    emailVerified: true,
    banned: options?.banned ?? false,
  });
  return id;
}

async function insertCharacterFixture(slug = randomUUID()) {
  const characterId = randomUUID();
  const versionId = randomUUID();
  await database.insert(character).values({
    id: characterId,
    slug,
    lifecycle: "active",
  });
  await database.insert(characterVersion).values({
    id: versionId,
    characterId,
    versionNumber: 1,
    ...characterContent,
    contentDigest: characterContentDigest(characterContent),
    publishedAt: now,
  });
  await database
    .update(character)
    .set({ defaultVersionId: versionId })
    .where(eq(character.id, characterId));
  return { characterId, versionId };
}

async function insertConversationFixture(userId: string) {
  const { characterId, versionId } = await insertCharacterFixture();
  const conversationId = randomUUID();
  await database.insert(conversation).values({
    id: conversationId,
    userId,
    characterId,
    characterVersionId: versionId,
  });
  await database.insert(conversationMessage).values({
    id: randomUUID(),
    conversationId,
    sequence: 1,
    role: "assistant",
    kind: "opening",
    content: characterContent.openingMessage,
  });
  return conversationId;
}

async function insertPendingAttempt(input: {
  userId: string;
  conversationId?: string;
  sequence?: number;
  modelId?: string;
}) {
  const conversationId =
    input.conversationId ?? (await insertConversationFixture(input.userId));
  const sequence = input.sequence ?? 2;
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const attemptId = randomUUID();
  await database.insert(conversationMessage).values([
    {
      id: userMessageId,
      conversationId,
      sequence,
      role: "user",
      kind: "user",
      content: "Continue",
      clientRequestId: randomUUID(),
    },
    {
      id: assistantMessageId,
      conversationId,
      sequence: sequence + 1,
      role: "assistant",
      kind: "generated",
      inReplyTo: userMessageId,
    },
  ]);
  await database.insert(generationAttempt).values({
    id: attemptId,
    assistantMessageId,
    attemptNumber: 1,
    status: "pending",
    modelId: input.modelId ?? "test-model",
  });
  return { conversationId, assistantMessageId, attemptId };
}

async function admit(
  executor: Database,
  input: {
    userId: string;
    conversationId: string;
    assistantMessageId: string;
    estimatedInputTokens?: number;
    maxOutputTokens?: number;
    at?: Date;
  },
) {
  return executor.transaction((transaction) =>
    admitGeneration(transaction, {
      userId: input.userId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      estimatedInputTokens: input.estimatedInputTokens ?? 100,
      maxOutputTokens: input.maxOutputTokens ?? 100,
      now: input.at ?? now,
    }),
  );
}

async function bucketRows() {
  return database
    .select()
    .from(quotaBucket)
    .orderBy(quotaBucket.scope);
}

async function waitForWaitingQuery(applicationName: string) {
  let query = "";
  await expect
    .poll(
      async () => {
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
        const waiting = result.rows.find(
          (row) => row.wait_event_type === "Lock",
        );
        query = waiting?.query ?? "";
        return query.length > 0;
      },
      { timeout: 2_000 },
    )
    .toBe(true);
  return query;
}

describe("quota periods and effective limits", () => {
  test("uses UTC calendar day and month boundaries", () => {
    expect(userPeriod(new Date("2026-10-09T23:59:59Z"))).toEqual({
      start: new Date("2026-10-09T00:00:00Z"),
      end: new Date("2026-10-10T00:00:00Z"),
    });
    expect(instancePeriod(new Date("2026-10-31T23:59:59Z")).end).toEqual(
      new Date("2026-11-01T00:00:00Z"),
    );
  });

  test("inherits each nullable user override independently", () => {
    const settings = {
      userDailyRequestLimit: 11,
      userDailyTokenLimit: 22,
      instanceMonthlyRequestLimit: 33,
      instanceMonthlyTokenBudget: 44,
      maxConcurrentGenerations: 5,
    };

    expect(
      resolveEffectiveLimits(settings, {
        dailyRequestLimit: 7,
        dailyTokenLimit: null,
      }),
    ).toEqual({
      userDailyRequests: 7,
      userDailyTokens: 22,
      instanceMonthlyRequests: 33,
      instanceMonthlyTokens: 44,
      maxConcurrentGenerations: 5,
    });
    expect(
      resolveEffectiveLimits(settings, {
        dailyRequestLimit: null,
        dailyTokenLimit: 8,
      }),
    ).toEqual({
      userDailyRequests: 11,
      userDailyTokens: 8,
      instanceMonthlyRequests: 33,
      instanceMonthlyTokens: 44,
      maxConcurrentGenerations: 5,
    });
  });
});

describe("transactional admission", () => {
  test("waits for a racing final user request slot and returns the user quota code", async () => {
    await replaceSettings({ userDailyRequestLimit: 1 });
    const userId = await insertUser();
    const attempt = await insertPendingAttempt({ userId });
    const period = userPeriod(now);
    const userBucketId = `user:${userId}:${period.start.toISOString()}`;
    await database.insert(quotaBucket).values({
      id: userBucketId,
      scope: "user",
      userId,
      periodStart: period.start,
      periodEnd: period.end,
    });
    const blockerDatabase = createDatabase(testDatabaseUrl(), {
      application_name: `user-slot-winner-${randomUUID()}`,
      max: 1,
    });
    const admissionName = `user-slot-loser-${randomUUID()}`;
    const admissionDatabase = createDatabase(testDatabaseUrl(), {
      application_name: admissionName,
      max: 1,
    });
    const blocker = await blockerDatabase.$client.connect();
    let admission: ReturnType<typeof admit> | undefined;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `UPDATE quota_buckets
         SET consumed_requests = 1
         WHERE id = $1`,
        [userBucketId],
      );

      admission = admit(admissionDatabase, { userId, ...attempt });
      void admission.catch(() => undefined);
      expect(await waitForWaitingQuery(admissionName)).toMatch(
        /quota_buckets/i,
      );
      await blocker.query("COMMIT");

      await expect(admission).rejects.toMatchObject({
        code: "CHAT_USER_REQUEST_QUOTA",
      });
      expect(await database.select().from(generationLease)).toHaveLength(0);
      expect(await database.select().from(quotaReservation)).toHaveLength(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled(admission ? [admission] : []);
      await blockerDatabase.$client.end();
      await admissionDatabase.$client.end();
    }
  }, 10_000);

  test("waits for racing instance tokens and returns the instance token code", async () => {
    await replaceSettings({ instanceMonthlyTokenBudget: 200 });
    const userId = await insertUser();
    const attempt = await insertPendingAttempt({ userId });
    const period = instancePeriod(now);
    const instanceBucketId = `instance:global:${period.start.toISOString()}`;
    await database.insert(quotaBucket).values({
      id: instanceBucketId,
      scope: "instance",
      periodStart: period.start,
      periodEnd: period.end,
    });
    const blockerDatabase = createDatabase(testDatabaseUrl(), {
      application_name: `instance-token-winner-${randomUUID()}`,
      max: 1,
    });
    const admissionName = `instance-token-loser-${randomUUID()}`;
    const admissionDatabase = createDatabase(testDatabaseUrl(), {
      application_name: admissionName,
      max: 1,
    });
    const blocker = await blockerDatabase.$client.connect();
    let admission: ReturnType<typeof admit> | undefined;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `UPDATE quota_buckets
         SET consumed_tokens = 1
         WHERE id = $1`,
        [instanceBucketId],
      );

      admission = admit(admissionDatabase, { userId, ...attempt });
      void admission.catch(() => undefined);
      expect(await waitForWaitingQuery(admissionName)).toMatch(
        /quota_buckets/i,
      );
      await blocker.query("COMMIT");

      await expect(admission).rejects.toMatchObject({
        code: "CHAT_INSTANCE_TOKEN_BUDGET",
      });
      expect(await database.select().from(generationLease)).toHaveLength(0);
      expect(await database.select().from(quotaReservation)).toHaveLength(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled(admission ? [admission] : []);
      await blockerDatabase.$client.end();
      await admissionDatabase.$client.end();
    }
  }, 10_000);

  test("uses quota released by expiry reconciliation for the new admission", async () => {
    await replaceSettings({
      userDailyTokenLimit: 300,
      instanceMonthlyTokenBudget: 300,
    });
    const userId = await insertUser();
    const expired = await insertPendingAttempt({ userId });
    await admit(database, {
      userId,
      ...expired,
      estimatedInputTokens: 100,
      maxOutputTokens: 100,
    });
    await database
      .update(generationLease)
      .set({ expiresAt: new Date(now.getTime() - 1) })
      .where(eq(generationLease.attemptId, expired.attemptId));
    const next = await insertPendingAttempt({ userId });

    await expect(
      admit(database, {
        userId,
        ...next,
        estimatedInputTokens: 100,
        maxOutputTokens: 100,
      }),
    ).resolves.toMatchObject({ attemptId: next.attemptId });

    for (const bucket of await bucketRows()) {
      expect(bucket).toMatchObject({
        consumedRequests: 1,
        reservedRequests: 1,
        consumedTokens: 100,
        reservedTokens: 200,
      });
    }
    expect(await database.select().from(usageLedger)).toHaveLength(1);
  });

  test("waits for an in-flight disable and rejects the newly disabled user", async () => {
    const userId = await insertUser();
    const attempt = await insertPendingAttempt({ userId });
    const disableDatabase = createDatabase(testDatabaseUrl(), {
      application_name: `disable-winner-${randomUUID()}`,
      max: 1,
    });
    const admissionName = `disabled-admission-loser-${randomUUID()}`;
    const admissionDatabase = createDatabase(testDatabaseUrl(), {
      application_name: admissionName,
      max: 1,
    });
    const disabling = await disableDatabase.$client.connect();
    let admission: ReturnType<typeof admit> | undefined;

    try {
      await disabling.query("BEGIN");
      await disabling.query(
        `UPDATE "user"
         SET banned = TRUE, ban_reason = 'Disabled during admission'
         WHERE id = $1`,
        [userId],
      );

      admission = admit(admissionDatabase, { userId, ...attempt });
      void admission.catch(() => undefined);
      expect(await waitForWaitingQuery(admissionName)).toMatch(/"user"/i);
      await disabling.query("COMMIT");

      await expect(admission).rejects.toMatchObject({
        code: "CHAT_READ_ONLY",
      });
      expect(await database.select().from(generationLease)).toHaveLength(0);
      expect(await database.select().from(quotaReservation)).toHaveLength(0);
    } finally {
      await disabling.query("ROLLBACK");
      disabling.release();
      await Promise.allSettled(admission ? [admission] : []);
      await disableDatabase.$client.end();
      await admissionDatabase.$client.end();
    }
  }, 10_000);

  test("permits only one user lease across different characters", async () => {
    const userId = await insertUser();
    const first = await insertPendingAttempt({ userId });
    const second = await insertPendingAttempt({ userId });
    await admit(database, { userId, ...first });

    await expect(admit(database, { userId, ...second })).rejects.toMatchObject({
      code: "CHAT_GENERATION_IN_PROGRESS",
    });
    expect(await database.select().from(generationLease)).toHaveLength(1);
  });

  test("enforces the instance-wide concurrent generation limit", async () => {
    await replaceSettings({ maxConcurrentGenerations: 1 });
    const firstUserId = await insertUser();
    const secondUserId = await insertUser();
    const first = await insertPendingAttempt({ userId: firstUserId });
    const second = await insertPendingAttempt({ userId: secondUserId });
    await admit(database, { userId: firstUserId, ...first });

    await expect(
      admit(database, { userId: secondUserId, ...second }),
    ).rejects.toMatchObject({
      code: "CHAT_INSTANCE_CONCURRENCY",
    });
  });

  test("waits in settings, instance bucket, user bucket, user lease, conversation order", async () => {
    const userId = await insertUser();
    const expired = await insertPendingAttempt({ userId });
    await admit(database, { userId, ...expired, at: now });
    await database
      .update(generationLease)
      .set({ expiresAt: new Date(now.getTime() - 1) })
      .where(eq(generationLease.attemptId, expired.attemptId));
    const next = await insertPendingAttempt({ userId });
    const [instanceBucket] = (await bucketRows()).filter(
      (bucket) => bucket.scope === "instance",
    );
    const [userBucket] = (await bucketRows()).filter(
      (bucket) => bucket.scope === "user",
    );
    const blockers = await Promise.all(
      Array.from({ length: 5 }, () => database.$client.connect()),
    );
    const applicationName = `quota-lock-order-${randomUUID()}`;
    const admissionDatabase = createDatabase(testDatabaseUrl(), {
      application_name: applicationName,
      max: 1,
    });
    let admission: ReturnType<typeof admit> | undefined;

    try {
      await Promise.all(blockers.map((blocker) => blocker.query("BEGIN")));
      await blockers[0].query(
        "SELECT id FROM chat_settings WHERE id = 'global' FOR UPDATE",
      );
      await blockers[1].query(
        "SELECT id FROM quota_buckets WHERE id = $1 FOR UPDATE",
        [instanceBucket?.id],
      );
      await blockers[2].query(
        "SELECT id FROM quota_buckets WHERE id = $1 FOR UPDATE",
        [userBucket?.id],
      );
      await blockers[3].query(
        "SELECT attempt_id FROM generation_leases WHERE attempt_id = $1 FOR UPDATE",
        [expired.attemptId],
      );
      await blockers[4].query(
        "SELECT id FROM conversations WHERE id = $1 FOR UPDATE",
        [next.conversationId],
      );

      admission = admit(admissionDatabase, { userId, ...next });
      void admission.catch(() => undefined);

      expect(await waitForWaitingQuery(applicationName)).toMatch(/chat_settings/i);
      await blockers[0].query("COMMIT");
      expect(await waitForWaitingQuery(applicationName)).toMatch(/quota_buckets/i);
      await blockers[1].query("COMMIT");
      expect(await waitForWaitingQuery(applicationName)).toMatch(/quota_buckets/i);
      await blockers[2].query("COMMIT");
      expect(await waitForWaitingQuery(applicationName)).toMatch(
        /generation_leases/i,
      );
      await blockers[3].query("COMMIT");
      expect(await waitForWaitingQuery(applicationName)).toMatch(/conversations/i);
      await blockers[4].query("COMMIT");

      await expect(admission).resolves.toMatchObject({
        attemptId: next.attemptId,
      });
    } finally {
      await Promise.all(
        blockers.map((blocker) => blocker.query("ROLLBACK").catch(() => undefined)),
      );
      blockers.forEach((blocker) => blocker.release());
      await Promise.allSettled(admission ? [admission] : []);
      await admissionDatabase.$client.end();
    }
  }, 10_000);

  test("rolls back message-side writes when admission fails", async () => {
    await replaceSettings({ userDailyRequestLimit: 1 });
    const userId = await insertUser();
    const conversationId = await insertConversationFixture(userId);
    const period = userPeriod(now);
    await database.insert(quotaBucket).values({
      id: randomUUID(),
      scope: "user",
      userId,
      periodStart: period.start,
      periodEnd: period.end,
      consumedRequests: 1,
    });
    const clientRequestId = randomUUID();

    await expect(
      database.transaction(async (transaction) => {
        const userMessageId = randomUUID();
        const assistantMessageId = randomUUID();
        await transaction.insert(conversationMessage).values([
          {
            id: userMessageId,
            conversationId,
            sequence: 2,
            role: "user",
            kind: "user",
            content: "Rejected",
            clientRequestId,
          },
          {
            id: assistantMessageId,
            conversationId,
            sequence: 3,
            role: "assistant",
            kind: "generated",
            inReplyTo: userMessageId,
          },
        ]);
        await transaction.insert(generationAttempt).values({
          id: randomUUID(),
          assistantMessageId,
          attemptNumber: 1,
          modelId: "test-model",
        });
        await admitGeneration(transaction, {
          userId,
          conversationId,
          assistantMessageId,
          estimatedInputTokens: 10,
          maxOutputTokens: 10,
          now,
        });
      }),
    ).rejects.toMatchObject({ code: "CHAT_USER_REQUEST_QUOTA" });

    expect(
      await database
        .select()
        .from(conversationMessage)
        .where(eq(conversationMessage.clientRequestId, clientRequestId)),
    ).toHaveLength(0);
    expect(await database.select().from(quotaReservation)).toHaveLength(0);
  });

  test("does not create leases for banned users", async () => {
    const bannedUserId = await insertUser({ banned: true });
    const bannedAttempt = await insertPendingAttempt({ userId: bannedUserId });
    await expect(
      admit(database, { userId: bannedUserId, ...bannedAttempt }),
    ).rejects.toBeInstanceOf(ChatDomainError);
    expect(await database.select().from(generationLease)).toHaveLength(0);
  });

  test("settles an active generation before atomically deleting its user", async () => {
    const deletedUserId = await insertUser();
    const deletedAttempt = await insertPendingAttempt({
      userId: deletedUserId,
    });
    await admit(database, { userId: deletedUserId, ...deletedAttempt });

    await deleteUserWithGenerationSettlement(database, deletedUserId, now);

    const [instanceBucket] = (await bucketRows()).filter(
      (bucket) => bucket.scope === "instance",
    );
    expect(instanceBucket).toMatchObject({
      reservedRequests: 0,
      reservedTokens: 0,
      consumedRequests: 1,
      consumedTokens: 100,
    });
    expect(
      (await bucketRows()).filter((bucket) => bucket.scope === "user"),
    ).toHaveLength(0);
    expect(await database.select().from(generationLease)).toHaveLength(0);
    expect(await database.select().from(quotaReservation)).toHaveLength(0);
    expect(await database.select().from(user)).toHaveLength(0);
    const ledgerRows = await database.select().from(usageLedger);
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]).toMatchObject({
      userId: null,
      conversationId: null,
      attemptId: null,
      userRequestUnits: 1,
      inputTokens: 100,
      outputTokens: 0,
      usageIsEstimated: true,
      outcome: "interrupted",
    });
  });
});

describe("settlement and reconciliation", () => {
  test("consumes one request, charges actual tokens, and releases unused reservation", async () => {
    const userId = await insertUser();
    const attempt = await insertPendingAttempt({ userId });
    const admission = await admit(database, {
      userId,
      ...attempt,
      estimatedInputTokens: 100,
      maxOutputTokens: 100,
    });

    await settleGeneration(database, {
      attemptId: attempt.attemptId,
      leaseOwner: admission.leaseOwner,
      outcome: "complete",
      now,
      providerCalls: [
        {
          callNumber: 1,
          modelId: "test-model",
          inputTokens: 30,
          outputTokens: 5,
          estimatedInputTokens: 36,
          estimatedOutputTokens: 6,
        },
        {
          callNumber: 2,
          modelId: "test-model",
          inputTokens: 10,
          outputTokens: 5,
          estimatedInputTokens: 12,
          estimatedOutputTokens: 6,
          automaticRetryCount: 1,
        },
      ],
    });

    for (const bucket of await bucketRows()) {
      expect(bucket).toMatchObject({
        consumedRequests: 1,
        reservedRequests: 0,
        consumedTokens: 50,
        reservedTokens: 0,
      });
    }
    const [reservation] = await database.select().from(quotaReservation);
    expect(reservation).toMatchObject({
      status: "settled",
      settledInputTokens: 40,
      settledOutputTokens: 10,
      usageIsEstimated: false,
    });
    const [attemptRow] = await database
      .select()
      .from(generationAttempt)
      .where(eq(generationAttempt.id, attempt.attemptId));
    expect(attemptRow).toMatchObject({
      status: "complete",
      inputTokens: 40,
      outputTokens: 10,
      usageIsEstimated: false,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(await database.select().from(generationLease)).toHaveLength(0);
    const ledgerRows = await database
      .select()
      .from(usageLedger)
      .orderBy(usageLedger.providerCallNumber);
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows.map((row) => row.userRequestUnits)).toEqual([1, 0]);
  });

  test("uses safety-margin estimates when provider usage is missing", async () => {
    const userId = await insertUser();
    const attempt = await insertPendingAttempt({ userId });
    const admission = await admit(database, { userId, ...attempt });

    await settleGeneration(database, {
      attemptId: attempt.attemptId,
      leaseOwner: admission.leaseOwner,
      outcome: "failed",
      errorCategory: "CHAT_PROVIDER_TIMEOUT",
      now,
      providerCalls: [
        {
          callNumber: 1,
          modelId: "test-model",
          estimatedInputTokens: 120,
          estimatedOutputTokens: 24,
          errorCategory: "CHAT_PROVIDER_TIMEOUT",
          latencyMs: 900,
        },
      ],
    });

    const [reservation] = await database.select().from(quotaReservation);
    expect(reservation).toMatchObject({
      settledInputTokens: 120,
      settledOutputTokens: 24,
      usageIsEstimated: true,
    });
    const [ledger] = await database.select().from(usageLedger);
    expect(ledger).toMatchObject({
      inputTokens: 120,
      outputTokens: 24,
      usageIsEstimated: true,
      outcome: "failed",
      errorCategory: "CHAT_PROVIDER_TIMEOUT",
      latencyMs: 900,
    });
  });

  test("is idempotent when settlement repeats", async () => {
    const userId = await insertUser();
    const attempt = await insertPendingAttempt({ userId });
    const admission = await admit(database, { userId, ...attempt });
    const settlement = {
      attemptId: attempt.attemptId,
      leaseOwner: admission.leaseOwner,
      outcome: "complete" as const,
      now,
      providerCalls: [
        {
          callNumber: 1,
          modelId: "test-model",
          inputTokens: 30,
          outputTokens: 5,
          estimatedInputTokens: 36,
          estimatedOutputTokens: 6,
        },
      ],
    };

    await settleGeneration(database, settlement);
    await settleGeneration(database, settlement);

    expect(await database.select().from(usageLedger)).toHaveLength(1);
    for (const bucket of await bucketRows()) {
      expect(bucket).toMatchObject({
        consumedRequests: 1,
        consumedTokens: 35,
        reservedRequests: 0,
        reservedTokens: 0,
      });
    }
  });

  test("reconciles an expired lease once without changing checkpointed content", async () => {
    const userId = await insertUser();
    const attempt = await insertPendingAttempt({ userId });
    const admission = await admit(database, { userId, ...attempt });
    await database
      .update(generationAttempt)
      .set({ status: "streaming", content: "Persisted partial reply" })
      .where(eq(generationAttempt.id, attempt.attemptId));
    await database
      .update(generationLease)
      .set({ expiresAt: new Date(now.getTime() - 1) })
      .where(eq(generationLease.attemptId, attempt.attemptId));

    await expect(reconcileExpiredLeases(database, now)).resolves.toBe(1);
    await expect(reconcileExpiredLeases(database, now)).resolves.toBe(0);

    const [attemptRow] = await database
      .select()
      .from(generationAttempt)
      .where(eq(generationAttempt.id, attempt.attemptId));
    expect(attemptRow).toMatchObject({
      status: "interrupted",
      content: "Persisted partial reply",
      usageIsEstimated: true,
    });
    expect(await database.select().from(usageLedger)).toHaveLength(1);
    for (const bucket of await bucketRows()) {
      expect(bucket.consumedRequests).toBe(1);
      expect(bucket.consumedTokens).toBe(100);
      expect(bucket.reservedRequests).toBe(0);
      expect(bucket.reservedTokens).toBe(0);
    }
    expect(admission.leaseOwner).toBeTruthy();
  });

  test("does not reconcile a lease refreshed after the expiry scan", async () => {
    const userId = await insertUser();
    const attempt = await insertPendingAttempt({ userId });
    await admit(database, { userId, ...attempt });
    await database
      .update(generationLease)
      .set({ expiresAt: new Date(now.getTime() - 1) })
      .where(eq(generationLease.attemptId, attempt.attemptId));
    const blockerDatabase = createDatabase(testDatabaseUrl(), {
      application_name: `reconcile-scan-blocker-${randomUUID()}`,
      max: 1,
    });
    const reconcileName = `reconcile-after-scan-${randomUUID()}`;
    const reconcileDatabase = createDatabase(testDatabaseUrl(), {
      application_name: reconcileName,
      max: 1,
    });
    const refreshDatabase = createDatabase(testDatabaseUrl(), {
      application_name: `lease-refresher-${randomUUID()}`,
      max: 1,
    });
    const blocker = await blockerDatabase.$client.connect();
    const refreshedExpiry = new Date(now.getTime() + 60_000);
    let reconciliation: ReturnType<typeof reconcileExpiredLeases> | undefined;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM chat_settings WHERE id = 'global' FOR UPDATE",
      );
      reconciliation = reconcileExpiredLeases(reconcileDatabase, now);
      void reconciliation.catch(() => undefined);
      expect(await waitForWaitingQuery(reconcileName)).toMatch(/chat_settings/i);

      await refreshDatabase.transaction(async (transaction) => {
        await transaction
          .update(generationLease)
          .set({ expiresAt: refreshedExpiry, updatedAt: now })
          .where(eq(generationLease.attemptId, attempt.attemptId));
        await transaction
          .update(generationAttempt)
          .set({ leaseExpiresAt: refreshedExpiry, updatedAt: now })
          .where(eq(generationAttempt.id, attempt.attemptId));
      });
      await blocker.query("COMMIT");

      await expect(reconciliation).resolves.toBe(0);
      expect(await database.select().from(generationLease)).toMatchObject([
        { attemptId: attempt.attemptId, expiresAt: refreshedExpiry },
      ]);
      expect(await database.select().from(quotaReservation)).toMatchObject([
        { attemptId: attempt.attemptId, status: "active" },
      ]);
      expect(await database.select().from(usageLedger)).toHaveLength(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled(reconciliation ? [reconciliation] : []);
      await blockerDatabase.$client.end();
      await reconcileDatabase.$client.end();
      await refreshDatabase.$client.end();
    }
  }, 10_000);

  test("conversation deletion preserves consumed bucket accounting and numeric ledger usage", async () => {
    const userId = await insertUser();
    const attempt = await insertPendingAttempt({ userId });
    const admission = await admit(database, { userId, ...attempt });
    await settleGeneration(database, {
      attemptId: attempt.attemptId,
      leaseOwner: admission.leaseOwner,
      outcome: "complete",
      now,
      providerCalls: [
        {
          callNumber: 1,
          modelId: "test-model",
          inputTokens: 20,
          outputTokens: 5,
          estimatedInputTokens: 24,
          estimatedOutputTokens: 6,
        },
      ],
    });

    await database
      .delete(conversation)
      .where(eq(conversation.id, attempt.conversationId));

    for (const bucket of await bucketRows()) {
      expect(bucket).toMatchObject({
        consumedRequests: 1,
        consumedTokens: 25,
      });
    }
    const [ledger] = await database.select().from(usageLedger);
    expect(ledger).toMatchObject({
      conversationId: null,
      attemptId: null,
      inputTokens: 20,
      outputTokens: 5,
    });
  });

  test("applies nullable overrides loaded from PostgreSQL", async () => {
    const userId = await insertUser();
    await database.insert(userChatQuotaOverride).values({
      userId,
      dailyRequestLimit: 3,
      dailyTokenLimit: null,
    });
    const attempt = await insertPendingAttempt({ userId });

    await expect(admit(database, { userId, ...attempt })).resolves.toMatchObject({
      effectiveLimits: {
        userDailyRequests: 3,
        userDailyTokens: 10_000,
      },
    });
  });
});
