// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionNow as now,
  resetExtractionDatabase,
  extractionCandidate,
  waitForExtractionLock,
} from "@/test/memory-extraction-fixture";
import { summaryFixture } from "@/test/memory-summary-fixture";
import { createBoss } from "@/server/jobs/boss";
import type { EmailQueueJob } from "@/server/email/email-job";
import { admitBackgroundModelWork } from "@/server/memory/background-usage-service";
import { disableOrdinaryUser } from "@/server/admin/user-service";
import {
  ensureQueues,
  ACCOUNT_PURGE_QUEUE,
  ACCOUNT_PURGE_DEAD_LETTER_QUEUE,
  AUTH_EMAIL_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
  RELATIONSHIP_SUMMARY_QUEUE,
  DATA_EXPORT_QUEUE,
} from "@/server/jobs/queues";
import {
  editRelationshipSummary,
  DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
} from "@/server/memory/relationship-summary-service";
import { requestDataExport, processDataExport } from "./data-export-service";
import {
  confirmAccountDeletion,
  enqueueAccountDeletionVerification,
  requestAccountDeletion,
} from "./account-deletion-service";
import {
  processAccountPurgeStage,
  enqueuePendingAccountPurges,
  retryAccountPurge,
  getAccountPurgeState,
  registerAccountPurgeWorker,
} from "./account-purge-job";

vi.mock("@/server/config/load-config", () => ({
  getRuntimeConfig: async () => ({
    secret: { betterAuthSecret: "deletion-test-signing-secret-at-least-32" },
  }),
}));
const database = createDatabase(testDatabaseUrl());
const boss = createBoss(testDatabaseUrl());
beforeAll(async () => {
  await boss.start();
  await ensureQueues(boss);
});
beforeEach(async () => {
  await resetExtractionDatabase(database);
  await database.execute(
    sql`TRUNCATE verification, rate_limit, admin_audit_events`,
  );
  await boss.deleteAllJobs(ACCOUNT_PURGE_QUEUE);
  await boss.deleteAllJobs(ACCOUNT_PURGE_DEAD_LETTER_QUEUE);
  for (const name of [
    AUTH_EMAIL_QUEUE,
    MEMORY_EXTRACTION_QUEUE,
    RELATIONSHIP_SUMMARY_QUEUE,
    DATA_EXPORT_QUEUE,
  ])
    await boss.deleteAllJobs(name);
});
afterAll(async () => {
  await boss.stop();
  await database.$client.end();
});
async function fixture() {
  const owner = await summaryFixture(database);
  const email = `${owner.userId}@example.com`;
  await editRelationshipSummary(
    database,
    {
      ...owner,
      content: "private-current-summary",
      expectedRevision: 0,
      expectedMemoryEpoch: 0,
      userExplicitlyAskedToRemember: true,
    },
    DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
  );
  await database
    .insert(schema.userChatQuotaOverride)
    .values({ userId: owner.userId, dailyRequestLimit: 100 });
  await database.insert(schema.session).values({
    id: randomUUID(),
    token: "private-session-token",
    userId: owner.userId,
    ipAddress: "198.51.100.10",
    userAgent: "private-agent",
    expiresAt: new Date(now.getTime() + 86_400_000),
    updatedAt: now,
  });
  await database.insert(schema.rateLimit).values({
    id: randomUUID(),
    key: "198.51.100.10|/update-user",
    count: 1,
    lastRequest: now.getTime(),
  });
  await database.insert(schema.account).values({
    id: randomUUID(),
    userId: owner.userId,
    accountId: owner.userId,
    providerId: "credential",
    password: "private-password",
    updatedAt: now,
  });
  await database.insert(schema.verification).values({
    id: randomUUID(),
    identifier: "reset-password:private-token",
    value: owner.userId,
    expiresAt: now,
  });
  await database.insert(schema.rateLimit).values({
    id: randomUUID(),
    key: `user:${owner.userId}`,
    count: 1,
    lastRequest: now.getTime(),
  });
  await database.insert(schema.adminAuditEvent).values({
    id: randomUUID(),
    actorUserId: owner.userId,
    actorLabel: email,
    action: "memory.character_forget",
    targetType: "user",
    targetId: owner.userId,
    metadata: { email },
    operationId: "private-operation",
  });
  await database.insert(schema.usageLedger).values({
    id: randomUUID(),
    userId: owner.userId,
    conversationId: owner.conversationId,
    attemptId: owner.attemptId,
    periodStart: now,
    periodEnd: new Date(now.getTime() + 86_400_000),
    providerCallNumber: 1,
    inputTokens: 13,
    outputTokens: 7,
    usageIsEstimated: false,
    modelId: "test-model",
    outcome: "complete",
  });
  const requested = await requestAccountDeletion(database, {
    userId: owner.userId,
    email,
    now,
  });
  const executionId = randomUUID();
  const exported = await requestDataExport(database, {
    userId: owner.userId,
    now,
  });
  await processDataExport(database, exported.exportId, now);
  await boss.send(DATA_EXPORT_QUEUE, { exportId: exported.exportId });
  await boss.send(AUTH_EMAIL_QUEUE, {
    kind: "delete-account",
    to: email,
    actionUrl: `http://localhost/account/delete/confirm#token=${requested.verificationToken}`,
    deletionRequestId: requested.requestId,
  });
  await database.insert(schema.relationshipSummaryExecution).values({
    id: executionId,
    runId: owner.operationId!,
    executionNumber: 1,
    modelId: "test-model",
    estimatedInputTokens: 10,
    estimatedOutputTokens: 10,
    inputTokens: 13,
    outputTokens: 7,
    responseAt: now,
    summary: "private-staged-summary",
    providerIdentity: ["private-summary-provider"],
  });
  await database.transaction((tx) =>
    admitBackgroundModelWork(tx, {
      userId: owner.userId,
      operationId: executionId,
      workloadType: "summary_refresh",
      estimatedTokens: 20,
      now,
    }),
  );
  const [extraction] = await database
    .select()
    .from(schema.memoryExtractionRun)
    .where(eq(schema.memoryExtractionRun.userId, owner.userId));
  const extractionExecutionId = randomUUID();
  await database.insert(schema.memoryExtractionExecution).values({
    id: extractionExecutionId,
    runId: extraction.id,
    executionNumber: 1,
    modelId: "test-model",
    estimatedInputTokens: 10,
    estimatedOutputTokens: 10,
    inputTokens: 13,
    outputTokens: 7,
    responseAt: now,
    candidates: [
      extractionCandidate(owner.sourceMessageId, {
        content: "private-staged-memory",
      }),
    ],
    providerIdentity: ["private-extraction-provider"],
  });
  await database.transaction((tx) =>
    admitBackgroundModelWork(tx, {
      userId: owner.userId,
      operationId: extractionExecutionId,
      workloadType: "memory_extraction",
      estimatedTokens: 20,
      now,
    }),
  );
  await boss.send(MEMORY_EXTRACTION_QUEUE, { runId: extraction.id });
  await boss.send(RELATIONSHIP_SUMMARY_QUEUE, {
    operationId: owner.operationId,
  });
  await confirmAccountDeletion(database, {
    token: requested.verificationToken,
    now,
  });
  return { ...owner, ...requested };
}
const row = async (id: string) =>
  (
    await database
      .select()
      .from(schema.accountDeletionRequest)
      .where(eq(schema.accountDeletionRequest.id, id))
  )[0];
const stages = [
  "settle",
  "exports",
  "memory",
  "conversations",
  "audit",
  "auth",
];

test.each(stages)(
  "purge restarts after %s and preserves only de-identified accounting plus a content-free tombstone",
  async (stage) => {
    const owner = await fixture();
    while ((await row(owner.requestId)).currentStage !== stage)
      await processAccountPurgeStage(database, owner.requestId, now);
    // A fresh pool models a worker process restart with no in-memory state.
    const restarted = createDatabase(testDatabaseUrl());
    try {
      let result: string;
      do {
        result = await processAccountPurgeStage(
          restarted,
          owner.requestId,
          now,
        );
      } while (result === "continue");
      expect(
        await processAccountPurgeStage(restarted, owner.requestId, now),
      ).toBe("complete");
    } finally {
      await restarted.$client.end();
    }
    for (const table of [
      schema.user,
      schema.account,
      schema.session,
      schema.verification,
      schema.rateLimit,
      schema.conversation,
      schema.conversationMessage,
      schema.generationAttempt,
      schema.generationLease,
      schema.quotaReservation,
      schema.userChatQuotaOverride,
      schema.memoryItem,
      schema.memoryEvidence,
      schema.userCharacterMemorySetting,
      schema.memoryExtractionRun,
      schema.memoryExtractionExecution,
      schema.relationshipSummary,
      schema.relationshipSummaryVersion,
      schema.relationshipSummaryRun,
      schema.relationshipSummaryExecution,
      schema.backgroundModelReservation,
      schema.dataExportJob,
    ]) {
      expect(await database.select().from(table)).toHaveLength(0);
    }
    const usages = await database.select().from(schema.usageLedger);
    expect(usages).toHaveLength(3);
    for (const usage of usages)
      expect(usage).toMatchObject({
        userId: null,
        conversationId: null,
        attemptId: null,
        backgroundOperationId: null,
        memoryExtractionRunId: null,
        relationshipSummaryVersionId: null,
        inputTokens: 13,
        outputTokens: 7,
      });
    expect(
      (await database.select().from(schema.adminAuditEvent))[0],
    ).toMatchObject({
      actorUserId: null,
      actorLabel: "deleted",
      targetId: "deleted",
      metadata: {},
      operationId: "deleted",
    });
    const buckets = await database.select().from(schema.quotaBucket);
    expect(buckets.filter((bucket) => bucket.scope === "user")).toHaveLength(0);
    expect(buckets[0]).toMatchObject({ reservedTokens: 0, consumedTokens: 40 });
    for (const name of [
      AUTH_EMAIL_QUEUE,
      MEMORY_EXTRACTION_QUEUE,
      RELATIONSHIP_SUMMARY_QUEUE,
    ])
      expect(await boss.findJobs(name, {})).toHaveLength(0);
    expect(await row(owner.requestId)).toMatchObject({
      userId: null,
      status: "complete",
      currentStage: "complete",
      jobId: null,
      verificationTokenHash: null,
    });
    expect(
      JSON.stringify(await getAccountPurgeState(database, owner.requestId)),
    ).not.toMatch(/private|example|token|hash|userId/);
    expect(
      await confirmAccountDeletion(database, {
        token: owner.verificationToken,
        now,
      }),
    ).toEqual({ requestId: owner.requestId });
  },
);

test("duplicate staged delivery advances serially; final auth transaction rolls back before tombstone/user commit", async () => {
  const owner = await fixture();
  await Promise.all([
    processAccountPurgeStage(database, owner.requestId, now),
    processAccountPurgeStage(database, owner.requestId, now),
  ]);
  expect((await row(owner.requestId)).currentStage).toBe("memory");
  while ((await row(owner.requestId)).currentStage !== "auth")
    await processAccountPurgeStage(database, owner.requestId, now);
  await database.execute(
    sql`CREATE FUNCTION task10_fail_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private SQL provider content'; END $$`,
  );
  await database.execute(
    sql`CREATE TRIGGER task10_fail_user_delete BEFORE DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION task10_fail_user_delete()`,
  );
  try {
    await expect(
      processAccountPurgeStage(database, owner.requestId, now),
    ).rejects.toThrow("PURGE_STAGE_FAILED");
    expect((await row(owner.requestId)).currentStage).toBe("auth");
    expect((await row(owner.requestId)).status).toBe("purging");
    expect((await row(owner.requestId)).errorCategory).toBe(
      "PURGE_STAGE_FAILED",
    );
    expect(await database.select().from(schema.user)).toHaveLength(1);
    expect(await database.select().from(schema.account)).toHaveLength(1);
  } finally {
    await database.execute(
      sql`DROP TRIGGER task10_fail_user_delete ON "user"; DROP FUNCTION task10_fail_user_delete()`,
    );
  }
  expect(await processAccountPurgeStage(database, owner.requestId, now)).toBe(
    "complete",
  );
});

test.each(stages)(
  "failure after %s work rolls back its stage marker and restarts safely",
  async (stage) => {
    const owner = await fixture();
    while ((await row(owner.requestId)).currentStage !== stage)
      await processAccountPurgeStage(database, owner.requestId, now);
    await database.execute(sql`CREATE FUNCTION task10_fail_stage_marker() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.current_stage IS DISTINCT FROM OLD.current_stage THEN RAISE EXCEPTION 'private SQL/email/archive'; END IF; RETURN NEW; END $$`);
    await database.execute(
      sql`CREATE TRIGGER task10_fail_stage_marker BEFORE UPDATE ON account_deletion_requests FOR EACH ROW EXECUTE FUNCTION task10_fail_stage_marker()`,
    );
    try {
      await expect(
        processAccountPurgeStage(database, owner.requestId, now),
      ).rejects.toThrow(/^PURGE_STAGE_FAILED$/);
      expect(await row(owner.requestId)).toMatchObject({
        currentStage: stage,
        attemptCount: 1,
        errorCategory: "PURGE_STAGE_FAILED",
      });
      expect(await database.select().from(schema.user)).toHaveLength(1);
    } finally {
      await database.execute(
        sql`DROP TRIGGER task10_fail_stage_marker ON account_deletion_requests; DROP FUNCTION task10_fail_stage_marker()`,
      );
    }
    const restarted = createDatabase(testDatabaseUrl());
    try {
      while (
        (await processAccountPurgeStage(restarted, owner.requestId, now)) ===
        "continue"
      ) {}
    } finally {
      await restarted.$client.end();
    }
    expect(await row(owner.requestId)).toMatchObject({
      userId: null,
      status: "complete",
    });
  },
);

test("five real failures exhaust the same stage, publish a safe dead letter, and retry without private admin metadata", async () => {
  const owner = await fixture();
  await database.execute(sql`CREATE FUNCTION task10_exhaust_stage() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.current_stage IS DISTINCT FROM OLD.current_stage THEN RAISE EXCEPTION 'private-token@example.com'; END IF; RETURN NEW; END $$`);
  await database.execute(
    sql`CREATE TRIGGER task10_exhaust_stage BEFORE UPDATE ON account_deletion_requests FOR EACH ROW EXECUTE FUNCTION task10_exhaust_stage()`,
  );
  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(
        processAccountPurgeStage(database, owner.requestId, now),
      ).rejects.toThrow(/^PURGE_STAGE_FAILED$/);
      expect((await row(owner.requestId)).attemptCount).toBe(attempt);
    }
    expect(await getAccountPurgeState(database, owner.requestId)).toMatchObject(
      {
        status: "dead_letter" as const,
        stage: "settle",
        errorCategory: "PURGE_STAGE_FAILED",
      },
    );
    await enqueuePendingAccountPurges(database, boss, now);
    expect(
      (await boss.findJobs(ACCOUNT_PURGE_DEAD_LETTER_QUEUE, {}))[0].data,
    ).toEqual({ requestId: owner.requestId });
  } finally {
    await database.execute(
      sql`DROP TRIGGER task10_exhaust_stage ON account_deletion_requests; DROP FUNCTION task10_exhaust_stage()`,
    );
  }
  await retryAccountPurge(database, owner.requestId, now);
  while (
    (await processAccountPurgeStage(database, owner.requestId, now)) ===
    "continue"
  ) {}
  expect((await getAccountPurgeState(database, owner.requestId))?.status).toBe(
    "complete",
  );
});

test("database outbox and exhausted purge dead letters contain request IDs only; retry is owner-service and works after completion", async () => {
  const owner = await fixture();
  expect(await enqueuePendingAccountPurges(database, boss, now)).toBe(1);
  const jobs = await boss.findJobs(ACCOUNT_PURGE_QUEUE, {});
  expect(jobs[0].data).toEqual({ requestId: owner.requestId });
  await database
    .update(schema.accountDeletionRequest)
    .set({
      status: "dead_letter",
      attemptCount: 5,
      errorCategory: "PURGE_STAGE_FAILED",
    })
    .where(eq(schema.accountDeletionRequest.id, owner.requestId));
  await enqueuePendingAccountPurges(database, boss, now);
  expect(
    (await boss.findJobs(ACCOUNT_PURGE_DEAD_LETTER_QUEUE, {}))[0].data,
  ).toEqual({ requestId: owner.requestId });
  await retryAccountPurge(database, owner.requestId, now);
  expect((await getAccountPurgeState(database, owner.requestId))?.status).toBe(
    "purging",
  );
  while (
    (await processAccountPurgeStage(database, owner.requestId, now)) ===
    "continue"
  ) {}
  await retryAccountPurge(database, owner.requestId, now);
  expect((await getAccountPurgeState(database, owner.requestId))?.status).toBe(
    "complete",
  );
});

test("named PostgreSQL verification publication holds confirmation out and late publication after final purge leaves no private queue bytes", async () => {
  const owner = await summaryFixture(database);
  const requested = await requestAccountDeletion(database, {
    userId: owner.userId,
    email: `${owner.userId}@example.com`,
    now,
  });
  const confirming = createDatabase(testDatabaseUrl(), {
    application_name: "deletion-email-confirm",
  });
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const queue = {
    enqueue: async (job: EmailQueueJob) => {
      const id = await boss.send(AUTH_EMAIL_QUEUE, job);
      entered();
      await gate;
      return id!;
    },
  };
  const input = {
    userId: owner.userId,
    ...requested,
    actionUrl: `http://localhost/account/delete/confirm#token=${requested.verificationToken}`,
    now,
  };
  let publishing!: Promise<void>;
  let confirmation!: ReturnType<typeof confirmAccountDeletion>;
  try {
    publishing = enqueueAccountDeletionVerification(database, queue, input);
    await started;
    confirmation = confirmAccountDeletion(confirming, {
      token: requested.verificationToken,
      now,
    });
    expect(
      await waitForExtractionLock(database, "deletion-email-confirm"),
    ).toContain("chat_settings");
    release();
    await publishing;
    await confirmation;
    expect(
      (
        await database.execute(
          sql`SELECT data FROM job.job WHERE name = 'auth-email'`,
        )
      ).rows,
    ).toEqual([]);
    while (
      (await processAccountPurgeStage(database, requested.requestId, now)) !==
      "complete"
    ) {}
    await expect(
      enqueueAccountDeletionVerification(database, queue, input),
    ).rejects.toThrow(/^DELETION_UNAVAILABLE$/);
    expect(
      (
        await database.execute(
          sql`SELECT data FROM job.job WHERE name = 'auth-email'`,
        )
      ).rows,
    ).toEqual([]);
  } finally {
    release();
    await Promise.allSettled([publishing, confirmation].filter(Boolean));
    await confirming.$client.end();
  }
});

test("named PostgreSQL duplicate delivery cannot charge a rolled-back stage failure to a stage another worker already completed", async () => {
  const owner = await fixture();
  const failing = createDatabase(testDatabaseUrl(), {
    application_name: "purge-failed-stage",
  });
  const succeeding = createDatabase(testDatabaseUrl(), {
    application_name: "purge-success-stage",
  });
  let failed!: Promise<boolean>;
  let succeeded!: ReturnType<typeof processAccountPurgeStage>;
  await database.execute(sql`CREATE FUNCTION task10_pause_failed_stage() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('application_name') = 'purge-failed-stage' AND NEW.current_stage IS DISTINCT FROM OLD.current_stage THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('task10-failure-marker', 0));
        RAISE EXCEPTION 'private original failure';
      END IF;
      RETURN NEW;
    END $$`);
  await database.execute(
    sql`CREATE TRIGGER task10_pause_failed_stage BEFORE UPDATE ON account_deletion_requests FOR EACH ROW EXECUTE FUNCTION task10_pause_failed_stage()`,
  );
  try {
    await database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended('task10-failure-marker', 0))`,
      );
      failed = processAccountPurgeStage(failing, owner.requestId, now).then(
        () => false,
        () => true,
      );
      await waitForExtractionLock(database, "purge-failed-stage");
      succeeded = processAccountPurgeStage(succeeding, owner.requestId, now);
      expect(
        await waitForExtractionLock(database, "purge-success-stage"),
      ).toContain("chat_settings");
    });
    expect(await failed).toBe(true);
    expect(await succeeded).toBe("continue");
    expect(await row(owner.requestId)).toMatchObject({
      currentStage: "exports",
      attemptCount: 0,
      errorCategory: null,
    });
  } finally {
    await Promise.allSettled([failed, succeeded].filter(Boolean));
    await database.execute(
      sql`DROP TRIGGER task10_pause_failed_stage ON account_deletion_requests; DROP FUNCTION task10_pause_failed_stage()`,
    );
    await failing.$client.end();
    await succeeding.$client.end();
  }
});

test("registered PostgreSQL purge worker consumes the durable outbox through final auth removal with ID-only retained jobs", async () => {
  const owner = await fixture();
  const stop = await registerAccountPurgeWorker(database, boss, console);
  try {
    await expect
      .poll(async () => (await row(owner.requestId)).status, {
        timeout: 10_000,
      })
      .toBe("complete");
    expect(await database.select().from(schema.user)).toHaveLength(0);
    const jobs = await boss.findJobs(ACCOUNT_PURGE_QUEUE, {});
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toEqual({ requestId: owner.requestId });
    expect(JSON.stringify(jobs[0].output ?? null)).not.toMatch(
      /private|email|token|archive|provider/,
    );
    expect(
      (await getAccountPurgeState(database, owner.requestId))?.status,
    ).toBe("complete");
  } finally {
    await stop();
    await boss.offWork(ACCOUNT_PURGE_QUEUE);
  }
}, 15_000);

test("state projections and unavailable-database errors cannot disclose arbitrary stage/category or SQL", async () => {
  const owner = await fixture();
  await database
    .update(schema.accountDeletionRequest)
    .set({
      currentStage: "private-email@example.com",
      errorCategory: "private-provider-token",
    })
    .where(eq(schema.accountDeletionRequest.id, owner.requestId));
  const state = await getAccountPurgeState(database, owner.requestId);
  expect(state?.stage).toBe("unknown");
  expect(state?.errorCategory).toBe("PURGE_STAGE_FAILED");
  expect(JSON.stringify(state)).not.toMatch(/private|example|provider/);
  const unavailable = createDatabase(testDatabaseUrl());
  await unavailable.$client.end();
  await expect(
    processAccountPurgeStage(unavailable, owner.requestId, now),
  ).rejects.toThrow(/^PURGE_STATE_UNAVAILABLE$/);
  await expect(
    retryAccountPurge(unavailable, owner.requestId, now),
  ).rejects.toThrow(/^PURGE_STATE_UNAVAILABLE$/);
  await expect(
    getAccountPurgeState(unavailable, owner.requestId),
  ).rejects.toThrow(/^PURGE_STATE_UNAVAILABLE$/);
});

test("fifty published exhausted requests cannot starve a newly confirmed deletion", async () => {
  const exhausted = Array.from({ length: 50 }, () => ({
    id: randomUUID(),
    userId: randomUUID(),
  }));
  await database.insert(schema.user).values(
    exhausted.map((request) => ({
      id: request.userId,
      name: "Exhausted",
      email: `${request.userId}@example.com`,
      deletionPendingAt: now,
    })),
  );
  await database.insert(schema.accountDeletionRequest).values(
    exhausted.map((request) => ({
      ...request,
      status: "dead_letter" as const,
      currentStage: "settle",
      attemptCount: 5,
      verificationConsumedAt: now,
      confirmedAt: now,
      lockedAt: new Date(now.getTime() - 86_400_000),
      errorCategory: "PURGE_STAGE_FAILED",
    })),
  );
  await enqueuePendingAccountPurges(database, boss, now);
  expect(await boss.findJobs(ACCOUNT_PURGE_DEAD_LETTER_QUEUE, {})).toHaveLength(
    50,
  );
  const owner = await fixture();
  expect(await enqueuePendingAccountPurges(database, boss, now)).toBe(1);
  const stop = await registerAccountPurgeWorker(database, boss, console);
  try {
    await expect
      .poll(async () => (await row(owner.requestId)).status, {
        timeout: 10_000,
      })
      .toBe("complete");
    expect(
      await database
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, owner.userId)),
    ).toHaveLength(0);
    expect(
      await boss.findJobs(ACCOUNT_PURGE_DEAD_LETTER_QUEUE, {}),
    ).toHaveLength(50);
  } finally {
    await stop();
    await boss.offWork(ACCOUNT_PURGE_QUEUE);
  }
}, 15_000);

test("confirmation and final purge revoke both owned and impersonated sessions", async () => {
  const owner = await summaryFixture(database);
  const email = `${owner.userId}@example.com`;
  await database.insert(schema.user).values({
    id: "unrelated-session-owner",
    name: "Unrelated",
    email: "unrelated@example.com",
  });
  await database.insert(schema.session).values({
    id: randomUUID(),
    token: "impersonated-private-token",
    userId: "unrelated-session-owner",
    impersonatedBy: owner.userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const requested = await requestAccountDeletion(database, {
    userId: owner.userId,
    email,
    now,
  });
  await confirmAccountDeletion(database, {
    token: requested.verificationToken,
    now,
  });
  expect(await database.select().from(schema.session)).toHaveLength(0);
  while ((await row(requested.requestId)).currentStage !== "auth")
    await processAccountPurgeStage(database, requested.requestId, now);
  // Model a legacy retained session bypassing the current insertion guard.
  await database.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE session DISABLE TRIGGER session_enforce_user_eligibility`,
    );
    await tx.insert(schema.session).values({
      id: randomUUID(),
      token: "legacy-impersonated-private-token",
      userId: "unrelated-session-owner",
      impersonatedBy: owner.userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await tx.execute(
      sql`ALTER TABLE session ENABLE TRIGGER session_enforce_user_eligibility`,
    );
  });
  expect(
    await processAccountPurgeStage(database, requested.requestId, now),
  ).toBe("complete");
  expect(await database.select().from(schema.session)).toHaveLength(0);
  expect(
    await database
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, "unrelated-session-owner")),
  ).toHaveLength(1);
});

test("admin write ordered after audit stage is rejected and final fence re-cleans audit inventory", async () => {
  const owner = await fixture();
  while ((await row(owner.requestId)).currentStage !== "auth")
    await processAccountPurgeStage(database, owner.requestId, now);
  const actor = {
    userId: "audit-race-admin",
    label: "audit-admin@example.com",
    operationId: "audit-race",
  };
  await database.insert(schema.user).values({
    id: actor.userId,
    name: "Admin",
    email: actor.label,
    role: "admin",
  });

  await database.insert(schema.adminAuditEvent).values({
    id: randomUUID(),
    actorUserId: null,
    actorLabel: `${owner.userId}@example.com`,
    action: "user.disable",
    targetType: "user",
    targetId: owner.userId,
    metadata: { email: `${owner.userId}@example.com` },
    operationId: "private-late-audit",
  });
  const writing = createDatabase(testDatabaseUrl(), {
    application_name: "admin-write-after-audit",
  });
  const purging = createDatabase(testDatabaseUrl(), {
    application_name: "final-purge-after-admin",
  });
  let write: Promise<boolean> | undefined;
  let purge: ReturnType<typeof processAccountPurgeStage> | undefined;
  try {
    await database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM chat_settings WHERE id = 'global' FOR UPDATE`,
      );
      write = disableOrdinaryUser(writing, actor, {
        userId: owner.userId,
        reason: "private-late-reason",
      }).then(
        () => true,
        () => false,
      );
      expect(
        await waitForExtractionLock(database, "admin-write-after-audit"),
      ).toContain("chat_settings");
      purge = processAccountPurgeStage(purging, owner.requestId, now);
      expect(
        await waitForExtractionLock(database, "final-purge-after-admin"),
      ).toContain("chat_settings");
    });
    expect(await write).toBe(false);
    expect(await purge).toBe("complete");
    const events = await database.select().from(schema.adminAuditEvent);
    expect(events).toHaveLength(2);
    for (const event of events)
      expect(event).toMatchObject({
        actorUserId: null,
        actorLabel: "deleted",
        targetId: "deleted",
        metadata: {},
        operationId: "deleted",
      });
    expect(JSON.stringify(events)).not.toContain(owner.userId);
    expect(await row(owner.requestId)).toMatchObject({
      status: "complete",
      userId: null,
    });
  } finally {
    await Promise.allSettled([write, purge].filter(Boolean));
    await writing.$client.end();
    await purging.$client.end();
  }
});

test("final auth stage de-identifies audit rows arriving after the audit stage", async () => {
  const owner = await fixture();
  while ((await row(owner.requestId)).currentStage !== "auth")
    await processAccountPurgeStage(database, owner.requestId, now);
  await database.insert(schema.adminAuditEvent).values({
    id: randomUUID(),
    actorUserId: null,
    actorLabel: `${owner.userId}@example.com`,
    action: "user.disable",
    targetType: "user",
    targetId: owner.userId,
    metadata: { email: `${owner.userId}@example.com` },
    operationId: "private-after-audit",
  });
  expect(await processAccountPurgeStage(database, owner.requestId, now)).toBe(
    "complete",
  );
  const events = await database.select().from(schema.adminAuditEvent);
  expect(events).toHaveLength(2);
  for (const event of events)
    expect(event).toMatchObject({
      actorUserId: null,
      actorLabel: "deleted",
      targetId: "deleted",
      metadata: {},
      operationId: "deleted",
    });
  expect(JSON.stringify(events)).not.toContain(owner.userId);
});
