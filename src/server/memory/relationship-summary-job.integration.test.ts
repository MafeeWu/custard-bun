// @vitest-environment node
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  backgroundModelReservation,
  chatSettings,
  memoryItem,
  memorySettings,
  quotaBucket,
  relationshipSummaryExecution,
  relationshipSummaryRun,
  relationshipSummaryVersion,
  usageLedger,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import { ModelGatewayError } from "@/server/model-gateway/model-error";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionCounter,
  extractionGateway,
  resetExtractionDatabase,
  waitForExtractionLock,
} from "@/test/memory-extraction-fixture";
import { summaryFixture, summaryResult } from "@/test/memory-summary-fixture";
import {
  DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
  editRelationshipSummary as editRelationshipSummaryWithRuntimeConfig,
  getRelationshipSummary,
  ensureAutomaticSummaryRefresh,
  relationshipSummaryPolicyFromConfig,
  requestSummaryRegeneration,
} from "./relationship-summary-service";
import {
  enqueuePendingSummaryRuns,
  processRelationshipSummaryRefresh,
  registerRelationshipSummaryWorker,
} from "./relationship-summary-job";
import { forgetCharacter, updateMemoryControls } from "./memory-service";
import { lockExtractionRelationship } from "./memory-extraction-service";
import { admitBackgroundModelWork } from "./background-usage-service";
import { deleteUserWithGenerationSettlement } from "@/server/chat/quota-service";
import { createBoss } from "@/server/jobs/boss";
import {
  AUTH_EMAIL_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
  RELATIONSHIP_SUMMARY_QUEUE,
  RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE,
  ensureQueues,
} from "@/server/jobs/queues";

const database = createDatabase(testDatabaseUrl());
const signal = new AbortController().signal;
const configuredSummaryPolicy = (
  maxSummaryCharacters: number,
  modelApiKey = "mQ7vN2pR8sT4wX6z",
) =>
  relationshipSummaryPolicyFromConfig({
    public: { memory: { maxSummaryCharacters } },
    secret: {
      databaseUrl: "postgresql://app:dB4fH7jK2mN5pQ8s@127.0.0.1:5432/app",
      betterAuthSecret: "aB3dE5fG7hJ9kL2mN4pQ6rS8tV1xZ3cD",
      smtp: { password: "sM9nP2qR5tV8xZ1b" },
      model: { apiKey: modelApiKey },
    },
  });
const editRelationshipSummary = (
  database: Parameters<typeof editRelationshipSummaryWithRuntimeConfig>[0],
  input: Parameters<typeof editRelationshipSummaryWithRuntimeConfig>[1],
) =>
  editRelationshipSummaryWithRuntimeConfig(
    database,
    input,
    DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
  );
const processWithPolicy =
  processRelationshipSummaryRefresh as unknown as (
    database: Parameters<typeof processRelationshipSummaryRefresh>[0],
    gateway: Parameters<typeof processRelationshipSummaryRefresh>[1],
    tokenCounter: Parameters<typeof processRelationshipSummaryRefresh>[2],
    operationId: Parameters<typeof processRelationshipSummaryRefresh>[3],
    signal: Parameters<typeof processRelationshipSummaryRefresh>[4],
    policy: ReturnType<typeof configuredSummaryPolicy>,
  ) => ReturnType<typeof processRelationshipSummaryRefresh>;
const registerWithPolicy =
  registerRelationshipSummaryWorker as unknown as (
    database: Parameters<typeof registerRelationshipSummaryWorker>[0],
    boss: Parameters<typeof registerRelationshipSummaryWorker>[1],
    gateway: Parameters<typeof registerRelationshipSummaryWorker>[2],
    tokenCounter: Parameters<typeof registerRelationshipSummaryWorker>[3],
    logger: Parameters<typeof registerRelationshipSummaryWorker>[4],
    policy: ReturnType<typeof configuredSummaryPolicy>,
  ) => ReturnType<typeof registerRelationshipSummaryWorker>;
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());
const process = (
  id: string,
  gateway = extractionGateway(async () => summaryResult()),
) =>
  processRelationshipSummaryRefresh(
    database,
    gateway,
    extractionCounter,
    id,
    signal,
  );

test.each(["pending", "automatic", "user-edited"] as const)(
  "hard deletion removes relationships with %s summary work",
  async (kind) => {
    const input = await summaryFixture(database);
    if (kind === "automatic") await process(input.operationId!);
    if (kind === "user-edited")
      await editRelationshipSummary(database, {
        ...input,
        expectedRevision: 0,
        content: "My summary.",
      });
    await deleteUserWithGenerationSettlement(
      database,
      input.userId,
      new Date(),
    );
    expect(await database.select().from(user)).toHaveLength(0);
    expect(
      await database.select().from(relationshipSummaryVersion),
    ).toHaveLength(0);
  },
);

test("duplicate delivery creates one immutable version pointer and exactly one instance-only usage row", async () => {
  const input = await summaryFixture(database);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const ready = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  const gateway = extractionGateway(async (request) => {
    calls++;
    expect(request.jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["summary"],
    });
    expect(request.messages[1].content).toContain("Likes green tea.");
    expect(request.messages[1].content).not.toContain("I'll remember");
    expect(request.messages[1].content).not.toContain(input.userId);
    entered();
    await ready;
    return summaryResult("  Ｅｎｊｏｙｓ\tgreen\n tea. ");
  });
  const work = process(input.operationId!, gateway);
  await started;
  await process(input.operationId!, gateway);
  release();
  await work;
  await process(input.operationId!, gateway);
  expect(calls).toBe(1);
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    revision: 1,
    origin: "automatic",
    content: "Enjoys green tea.",
    basedOnMemoryRevision: 1,
  });
  expect(await database.select().from(relationshipSummaryVersion)).toHaveLength(
    1,
  );
  expect(await database.select().from(usageLedger)).toMatchObject([
    {
      workloadType: "summary_refresh",
      userRequestUnits: 0,
      inputTokens: 13,
      outputTokens: 7,
    },
  ]);
  expect(await database.select().from(usageLedger)).toHaveLength(1);
  expect(await database.select().from(quotaBucket)).toMatchObject([
    {
      scope: "instance",
      reservedTokens: 0,
      consumedTokens: 20,
      consumedRequests: 0,
    },
  ]);
  expect(
    JSON.stringify(await database.select().from(relationshipSummaryRun)),
  ).not.toContain("private-summary-provider-id");
});

test.each([
  "revision",
  "forget",
  "pending-deletion",
  "recording-disable",
  "global-disable-reenable",
  "account-delete",
  "edit",
  "banned-restore",
] as const)(
  "%s during a provider call applies no stale summary and settles once",
  async (kind) => {
    const input = await summaryFixture(database);
    await process(
      input.operationId!,
      extractionGateway(async () => {
        if (kind === "revision")
          await database
            .update(userCharacterMemorySetting)
            .set({ memoryRevision: 2 });
        if (kind === "forget")
          await forgetCharacter(database, { ...input, expectedRevision: 1 });
        if (kind === "pending-deletion")
          await database.update(user).set({ deletionPendingAt: new Date() });
        if (kind === "recording-disable") {
          await updateMemoryControls(database, {
            ...input,
            expectedRevision: 1,
            recordingEnabled: false,
            usageEnabled: true,
          });
          await updateMemoryControls(database, {
            ...input,
            expectedRevision: 2,
            recordingEnabled: true,
            usageEnabled: true,
          });
        }
        if (kind === "global-disable-reenable") {
          await database.update(memorySettings).set({ enabled: false });
          await database.update(memorySettings).set({ enabled: true });
        }
        if (kind === "account-delete")
          await deleteUserWithGenerationSettlement(
            database,
            input.userId,
            new Date(),
          );
        if (kind === "edit")
          await editRelationshipSummary(database, {
            ...input,
            expectedRevision: 0,
            content: "Authoritative.",
          });
        if (kind === "banned-restore") {
          await database.update(user).set({ banned: true });
          await database.update(user).set({ banned: false });
        }
        return summaryResult();
      }),
    );
    expect(await getRelationshipSummary(database, input)).toEqual(
      kind === "edit"
        ? expect.objectContaining({ content: "Authoritative.", revision: 1 })
        : null,
    );
    expect(
      await database.select().from(relationshipSummaryVersion),
    ).toHaveLength(kind === "edit" ? 1 : 0);
    expect(await database.select().from(usageLedger)).toMatchObject([
      { outcome: "cancelled" },
    ]);
    expect(await database.select().from(usageLedger)).toHaveLength(1);
    expect((await database.select().from(quotaBucket))[0].reservedTokens).toBe(
      0,
    );
  },
);

test.each([
  { summary: "x".repeat(4001) },
  { summary: "ﬃ".repeat(1334) },
  { summary: 42 },
  { summary: "fine", extra: "secret" },
  { summary: "My password is hunter2" },
  [],
] as unknown[])(
  "strict untrusted structured validation rejects malformed or unsafe output: %#",
  async (value) => {
    const input = await summaryFixture(database);
    await expect(
      process(
        input.operationId!,
        extractionGateway(async () => ({
          ...summaryResult(),
          content: JSON.stringify(value),
        })),
      ),
    ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
    expect(
      await database.select().from(relationshipSummaryVersion),
    ).toHaveLength(0);
    expect(await database.select().from(usageLedger)).toHaveLength(1);
    expect(
      (await database.select().from(relationshipSummaryRun))[0].status,
    ).toBe("failed");
    expect(
      (await database.select().from(relationshipSummaryExecution))[0].summary,
    ).toBeNull();
  },
);

test("exact 4000-character limit accepts normalized output without truncation", async () => {
  const input = await summaryFixture(database);
  await process(
    input.operationId!,
    extractionGateway(async () => summaryResult("x".repeat(4000))),
  );
  expect((await getRelationshipSummary(database, input))?.content).toHaveLength(
    4000,
  );
});

test("configured 100-character provider limit shapes schema and prompt, allows 100, and rejects 101", async () => {
  const policy = configuredSummaryPolicy(100);
  const accepted = await summaryFixture(database);
  await processWithPolicy(
    database,
    extractionGateway(async (request) => {
      expect(request.jsonSchema).toMatchObject({
        properties: { summary: { type: "string", maxLength: 100 } },
      });
      expect(request.messages[0].content).toContain(
        "at most 100 characters",
      );
      return summaryResult("x".repeat(100));
    }),
    extractionCounter,
    accepted.operationId!,
    signal,
    policy,
  );
  expect((await getRelationshipSummary(database, accepted))?.content).toBe(
    "x".repeat(100),
  );

  await resetExtractionDatabase(database);
  const rejected = await summaryFixture(database);
  await expect(
    processWithPolicy(
      database,
      extractionGateway(async () => summaryResult("x".repeat(101))),
      extractionCounter,
      rejected.operationId!,
      signal,
      policy,
    ),
  ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
  expect(await database.select().from(relationshipSummaryVersion)).toHaveLength(
    0,
  );
  expect(
    (await database.select().from(relationshipSummaryExecution))[0].summary,
  ).toBeNull();
});

test("reflected configured API key reaches no receipt, version, current summary, error, or log", async () => {
  const reflectedSecret = "mQ7vN2pR8sT4wX6z";
  const input = await summaryFixture(database);
  const logger = { error: vi.fn() };
  let worker:
    | ((jobs: Array<{ data: { operationId: string } }>) => Promise<void>)
    | undefined;
  const boss = {
    send: vi.fn(async () => randomUUID()),
    work: vi.fn(async (_queue, handler) => {
      worker = handler;
      return randomUUID();
    }),
  };
  const stop = await registerWithPolicy(
    database,
    boss as never,
    extractionGateway(async () => summaryResult(reflectedSecret)),
    extractionCounter,
    logger,
    configuredSummaryPolicy(4000, reflectedSecret),
  );
  let thrown: unknown;
  try {
    await worker!([{ data: { operationId: input.operationId! } }]).catch(
      (error: unknown) => {
        thrown = error;
      },
    );
  } finally {
    await stop();
  }
  const durable = {
    executions: await database.select().from(relationshipSummaryExecution),
    versions: await database.select().from(relationshipSummaryVersion),
    current: await getRelationshipSummary(database, input),
  };
  expect(durable.executions[0]?.summary).toBeNull();
  expect(durable.versions).toHaveLength(0);
  expect(durable.current).toBeNull();
  expect(JSON.stringify(durable)).not.toContain(reflectedSecret);
  expect(
    thrown instanceof Error
      ? `${thrown.name}\n${thrown.message}\n${thrown.stack ?? ""}`
      : String(thrown),
  ).not.toContain(reflectedSecret);
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
    reflectedSecret,
  );
});

test("receipt replay after atomic apply failure never calls or charges the provider twice", async () => {
  const input = await summaryFixture(database);
  let calls = 0;
  const gateway = extractionGateway(async () => {
    calls++;
    return summaryResult();
  });
  await database.execute(
    sql.raw(`
    CREATE FUNCTION task6_fail_apply() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'private fixture body'; END $$;
    CREATE TRIGGER task6_fail_apply BEFORE INSERT ON relationship_summary_versions
    FOR EACH ROW EXECUTE FUNCTION task6_fail_apply()
  `),
  );
  try {
    await expect(process(input.operationId!, gateway)).rejects.toBeDefined();
    expect(await database.select().from(usageLedger)).toHaveLength(0);
    expect(
      (await database.select().from(relationshipSummaryExecution))[0],
    ).toMatchObject({
      responseAt: expect.any(Date),
      settledAt: null,
      summary: "Enjoys green tea.",
    });
  } finally {
    await database.execute(
      sql.raw(
        "DROP TRIGGER task6_fail_apply ON relationship_summary_versions; DROP FUNCTION task6_fail_apply()",
      ),
    );
  }
  await process(input.operationId!, gateway);
  await process(input.operationId!, gateway);
  expect(calls).toBe(1);
  expect(await database.select().from(relationshipSummaryVersion)).toHaveLength(
    1,
  );
  expect(await database.select().from(usageLedger)).toHaveLength(1);
  expect(
    (await database.select().from(relationshipSummaryExecution))[0],
  ).toMatchObject({ summary: null, settledAt: expect.any(Date) });
});

test("five database executions persist exponential retries and failed regeneration preserves user authority", async () => {
  const input = await summaryFixture(database);
  await editRelationshipSummary(database, {
    ...input,
    expectedRevision: 0,
    content: "Keep me.",
  });
  const run = await requestSummaryRegeneration(database, {
    ...input,
    expectedRevision: 1,
  });
  let calls = 0;
  const gateway = extractionGateway(async () => {
    calls++;
    throw new ModelGatewayError("server", { retryable: true });
  });
  for (let count = 1; count <= 5; count++) {
    if (count > 1)
      await database
        .update(relationshipSummaryRun)
        .set({ nextRetryAt: new Date(0) })
        .where(eq(relationshipSummaryRun.id, run.operationId));
    await expect(process(run.operationId, gateway)).rejects.toMatchObject({
      category: "server",
    });
    const [row] = await database
      .select()
      .from(relationshipSummaryRun)
      .where(eq(relationshipSummaryRun.id, run.operationId));
    expect(row).toMatchObject({
      attemptCount: count,
      status: count < 5 ? "retrying" : "dead_letter",
    });
    if (count < 5)
      expect(row.nextRetryAt!.getTime() - row.updatedAt.getTime()).toBe(
        60_000 * 2 ** (count - 1),
      );
  }
  await process(run.operationId, gateway);
  expect(calls).toBe(5);
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    content: "Keep me.",
    revision: 1,
  });
  expect(await database.select().from(usageLedger)).toHaveLength(5);
});

test("expired abandoned claim is fenced conservatively settled and reconciled even after forget", async () => {
  const input = await summaryFixture(database);
  await database.transaction(async (tx) => {
    await admitBackgroundModelWork(tx, {
      userId: input.userId,
      operationId: "crashed-summary",
      workloadType: "summary_refresh",
      estimatedTokens: 4196,
      now: new Date(),
    });
    await tx.insert(relationshipSummaryExecution).values({
      id: "crashed-summary",
      runId: input.operationId!,
      executionNumber: 1,
      modelId: "test-model",
      estimatedInputTokens: 100,
    });
    await tx.update(relationshipSummaryRun).set({
      status: "running",
      attemptCount: 1,
      claimToken: "lost-worker",
      leaseExpiresAt: new Date(0),
    });
  });
  await forgetCharacter(database, { ...input, expectedRevision: 1 });
  const send = vi.fn(async () => "recovery-job");
  expect(await enqueuePendingSummaryRuns(database, { send }, new Date())).toBe(
    1,
  );
  await process(
    input.operationId!,
    extractionGateway(async () => {
      throw new Error("No provider on replay.");
    }),
  );
  expect(await database.select().from(usageLedger)).toMatchObject([
    {
      outcome: "cancelled",
      usageIsEstimated: true,
      inputTokens: 100,
      outputTokens: 4096,
    },
  ]);
  expect((await database.select().from(quotaBucket))[0].reservedTokens).toBe(0);
});

test.each([
  "revision",
  "epoch",
  "user-edit",
  "pending-deletion",
  "recording-disable",
] as const)(
  "named separate PostgreSQL %s race fences provider application behind canonical locks",
  async (kind) => {
    const input = await summaryFixture(database);
    const name = `task6-${kind}-apply`;
    const writer = createDatabase(testDatabaseUrl(), {
      application_name: name,
      max: 1,
    });
    const mutator = createDatabase(testDatabaseUrl(), {
      application_name: `task6-${kind}-mutation`,
      max: 1,
    });
    let entered!: () => void,
      release!: () => void,
      locked!: () => void,
      unlock!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const ready = new Promise<void>((r) => {
      release = r;
    });
    const lockReady = new Promise<void>((r) => {
      locked = r;
    });
    const lockDone = new Promise<void>((r) => {
      unlock = r;
    });
    const work = processRelationshipSummaryRefresh(
      writer,
      extractionGateway(async () => {
        entered();
        await ready;
        return summaryResult();
      }),
      extractionCounter,
      input.operationId!,
      signal,
    );
    let mutation: Promise<unknown> | undefined;
    try {
      await started;
      mutation = mutator.transaction(async (tx) => {
        await lockExtractionRelationship(tx, input);
        if (kind === "revision")
          await tx
            .update(userCharacterMemorySetting)
            .set({ memoryRevision: 2 });
        if (kind === "epoch")
          await tx
            .update(userCharacterMemorySetting)
            .set({ memoryEpoch: 1, memoryRevision: 2 });
        if (kind === "pending-deletion")
          await tx
            .update(user)
            .set({ deletionPendingAt: new Date() })
            .where(eq(user.id, input.userId));
        if (kind === "recording-disable")
          await tx
            .update(userCharacterMemorySetting)
            .set({ recordingEnabled: false });
        if (kind === "user-edit") {
          const { editRelationshipSummaryInTransaction } =
            await import("./relationship-summary-service");
          await editRelationshipSummaryInTransaction(tx, {
            ...input,
            expectedRevision: 0,
            content: "Race winner.",
          });
        }
        locked();
        await lockDone;
      });
      await lockReady;
      release();
      expect(await waitForExtractionLock(database, name)).toMatch(
        /chat_settings/,
      );
      unlock();
      await mutation;
      await work;
      expect(await getRelationshipSummary(database, input)).toEqual(
        kind === "user-edit"
          ? expect.objectContaining({ content: "Race winner." })
          : null,
      );
      expect(await database.select().from(usageLedger)).toMatchObject([
        { outcome: "cancelled" },
      ]);
    } finally {
      release();
      unlock();
      await Promise.allSettled([work, mutation].filter(Boolean));
      await writer.$client.end();
      await mutator.$client.end();
    }
  },
);

test.each(["same-job", "replacement-job"] as const)(
  "production %s queue retries durably publish one dead letter without regressing auth or extraction",
  async (kind) => {
    const boss = createBoss(testDatabaseUrl());
    let stop: (() => Promise<void>) | undefined;
    const logger = { error: vi.fn() };
    try {
      await boss.start();
      await ensureQueues(boss);
      await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_QUEUE);
      await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE);
      const input = await summaryFixture(database);
      let calls = 0;
      stop = await registerRelationshipSummaryWorker(
        database,
        boss,
        extractionGateway(async () => {
          calls++;
          throw new ModelGatewayError("server", {
            retryable: true,
            providerRequestId: "private-summary-provider-id",
          });
        }),
        extractionCounter,
        logger,
      );
      expect((await boss.getQueue(AUTH_EMAIL_QUEUE))?.deadLetter).toBe(
        "auth-email-dead-letter",
      );
      expect((await boss.getQueue(MEMORY_EXTRACTION_QUEUE))?.retryLimit).toBe(
        4,
      );
      expect(await boss.getQueue(RELATIONSHIP_SUMMARY_QUEUE)).toMatchObject({
        retryLimit: 4,
        retryBackoff: true,
        retryDelay: 60,
        deadLetter: null,
      });
      for (let count = 1; count <= 5; count++) {
        await expect
          .poll(
            async () => {
              const [row] = await database
                .select()
                .from(relationshipSummaryRun);
              return { status: row.status, count: row.attemptCount };
            },
            { timeout: 6000 },
          )
          .toEqual({ count, status: count < 5 ? "retrying" : "dead_letter" });
        const [row] = await database.select().from(relationshipSummaryRun);
        await expect
          .poll(
            async () =>
              (await boss.getJobById(RELATIONSHIP_SUMMARY_QUEUE, row.jobId!))
                ?.state,
            { timeout: 6000 },
          )
          .toBe(count < 5 ? "retry" : "completed");
        if (count < 5) {
          await database
            .update(relationshipSummaryRun)
            .set({ nextRetryAt: new Date(0) });
          if (kind === "replacement-job") {
            await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_QUEUE);
            await enqueuePendingSummaryRuns(database, boss, new Date());
          } else {
            await database.execute(sql`UPDATE job.job SET start_after = NOW()
            WHERE id = ${row.jobId} AND name = ${RELATIONSHIP_SUMMARY_QUEUE}`);
          }
        }
      }
      await Promise.all([
        enqueuePendingSummaryRuns(database, boss, new Date()),
        enqueuePendingSummaryRuns(database, boss, new Date()),
      ]);
      expect(
        await boss.findJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE),
      ).toMatchObject([{ data: { operationId: input.operationId } }]);
      expect(
        await boss.findJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE),
      ).toHaveLength(1);
      expect(calls).toBe(5);
      const [terminal] = await database.select().from(relationshipSummaryRun);
      expect(
        (await boss.getJobById(RELATIONSHIP_SUMMARY_QUEUE, terminal.jobId!))
          ?.retryCount,
      ).toBe(kind === "same-job" ? 4 : 0);
      expect(await database.select().from(usageLedger)).toHaveLength(5);
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
        "private-summary-provider-id",
      );
      await expect(
        database
          .update(relationshipSummaryRun)
          .set({ deadLetterPublishedAt: null }),
      ).rejects.toThrow();
      await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE);
      await enqueuePendingSummaryRuns(database, boss, new Date());
      expect(
        await boss.findJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE),
      ).toEqual([]);
    } finally {
      await stop?.();
      await boss.offWork(RELATIONSHIP_SUMMARY_QUEUE);
      await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_QUEUE);
      await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE);
      await boss.stop({ graceful: false });
    }
  },
  40000,
);

test("summary input excludes inactive memories and unrelated users and characters", async () => {
  const input = await summaryFixture(database);
  const other = await summaryFixture(database);
  await database
    .update(memoryItem)
    .set({
      content: "Unrelated private.",
      normalizedContent: "unrelated private.",
    })
    .where(eq(memoryItem.userId, other.userId));
  const [active] = await database
    .select()
    .from(memoryItem)
    .where(eq(memoryItem.userId, input.userId));
  await database.insert(memoryItem).values({
    ...active,
    id: "inactive-summary-source",
    content: "Inactive private.",
    normalizedContent: "inactive private.",
    normalizedDigest: "c".repeat(64),
    automaticDigest: "c".repeat(64),
    isActive: false,
  });
  await process(
    input.operationId!,
    extractionGateway(async (request) => {
      expect(request.messages[1].content).not.toContain("Unrelated");
      expect(request.messages[1].content).not.toContain("Inactive");
      expect(request.messages[1].content).toContain("Likes green tea.");
      return summaryResult();
    }),
  );
});

test.each(["aborted", "epoch", "disabled", "deletion"] as const)(
  "preclaim %s invalidation makes no call and no reservation",
  async (kind) => {
    const input = await summaryFixture(database);
    const controller = new AbortController();
    if (kind === "aborted") controller.abort();
    if (kind === "epoch")
      await database.update(userCharacterMemorySetting).set({ memoryEpoch: 1 });
    if (kind === "disabled")
      await database.update(memorySettings).set({ enabled: false });
    if (kind === "deletion")
      await database.update(user).set({ deletionPendingAt: new Date() });
    await processRelationshipSummaryRefresh(
      database,
      extractionGateway(async () => {
        throw new Error("Provider must not be called.");
      }),
      extractionCounter,
      input.operationId!,
      controller.signal,
    );
    expect(
      await database.select().from(backgroundModelReservation),
    ).toHaveLength(0);
    expect(
      await database.select().from(relationshipSummaryVersion),
    ).toHaveLength(0);
  },
);

test("aborted provider completion creates no version and settles its usage exactly once", async () => {
  const input = await summaryFixture(database);
  const controller = new AbortController();
  await expect(
    processRelationshipSummaryRefresh(
      database,
      extractionGateway(async () => {
        controller.abort();
        return summaryResult();
      }),
      extractionCounter,
      input.operationId!,
      controller.signal,
    ),
  ).rejects.toMatchObject({ category: "cancelled" });
  expect(await database.select().from(relationshipSummaryVersion)).toHaveLength(
    0,
  );
  expect(await database.select().from(usageLedger)).toMatchObject([
    { outcome: "cancelled", inputTokens: 13, outputTokens: 7 },
  ]);
});

test("instance budget admission denial is durable bounded and never charges a user bucket", async () => {
  const input = await summaryFixture(database);
  await database.update(chatSettings).set({ instanceMonthlyTokenBudget: 1 });
  const gateway = extractionGateway(async () => {
    throw new Error("No admission.");
  });
  for (let count = 1; count <= 5; count++) {
    if (count > 1)
      await database
        .update(relationshipSummaryRun)
        .set({ nextRetryAt: new Date(0) });
    await expect(process(input.operationId!, gateway)).rejects.toMatchObject({
      code: "CHAT_INSTANCE_TOKEN_BUDGET",
    });
    expect(
      (await database.select().from(relationshipSummaryRun))[0],
    ).toMatchObject({
      attemptCount: count,
      status: count < 5 ? "retrying" : "dead_letter",
    });
  }
  await process(input.operationId!, gateway);
  expect(await database.select().from(usageLedger)).toEqual([]);
  expect(await database.select().from(backgroundModelReservation)).toEqual([]);
  expect(
    await database
      .select()
      .from(quotaBucket)
      .where(eq(quotaBucket.scope, "user")),
  ).toEqual([]);
});

test("crashed caller is fenced once before a fresh execution and late receipt cannot overwrite it", async () => {
  const input = await summaryFixture(database);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const ready = new Promise<void>((r) => {
    release = r;
  });
  const old = process(
    input.operationId!,
    extractionGateway(async () => {
      entered();
      await ready;
      return summaryResult("Old caller.");
    }),
  );
  await started;
  await database
    .update(relationshipSummaryRun)
    .set({ leaseExpiresAt: new Date(0) });
  await expect(process(input.operationId!)).rejects.toMatchObject({
    retryable: true,
  });
  await database
    .update(relationshipSummaryRun)
    .set({ nextRetryAt: new Date(0) });
  await process(input.operationId!);
  release();
  await old;
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    content: "Enjoys green tea.",
    revision: 1,
  });
  expect(await database.select().from(usageLedger)).toHaveLength(2);
  expect(await database.select().from(relationshipSummaryVersion)).toHaveLength(
    1,
  );
  expect((await database.select().from(quotaBucket))[0].reservedTokens).toBe(0);
});

test("saved receipt invalidated by a later memory revision is scrubbed and settled without application", async () => {
  const input = await summaryFixture(database);
  await database.execute(
    sql.raw(`
    CREATE FUNCTION task6_receipt_pause() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'pause'; END $$;
    CREATE TRIGGER task6_receipt_pause BEFORE INSERT ON usage_ledger
    FOR EACH ROW EXECUTE FUNCTION task6_receipt_pause()
  `),
  );
  try {
    await expect(process(input.operationId!)).rejects.toBeDefined();
    expect(
      (await database.select().from(relationshipSummaryExecution))[0].summary,
    ).toBe("Enjoys green tea.");
  } finally {
    await database.execute(
      sql.raw(
        "DROP TRIGGER task6_receipt_pause ON usage_ledger; DROP FUNCTION task6_receipt_pause()",
      ),
    );
  }
  await database.update(userCharacterMemorySetting).set({ memoryRevision: 2 });
  expect(
    (await database.select().from(relationshipSummaryExecution))[0].summary,
  ).toBeNull();
  await process(
    input.operationId!,
    extractionGateway(async () => {
      throw new Error("Do not call on replay.");
    }),
  );
  expect(await database.select().from(relationshipSummaryVersion)).toHaveLength(
    0,
  );
  expect(await database.select().from(usageLedger)).toMatchObject([
    { outcome: "cancelled", inputTokens: 13, outputTokens: 7 },
  ]);
});

test("reconciliation discovers manual memory revision changes without creating refreshes after forget", async () => {
  const input = await summaryFixture(database);
  await process(input.operationId!);
  await database.update(userCharacterMemorySetting).set({ memoryRevision: 2 });
  const send = vi.fn(async () => "new-job");
  expect(await enqueuePendingSummaryRuns(database, { send }, new Date())).toBe(
    1,
  );
  const runs = await database.select().from(relationshipSummaryRun);
  expect(runs.find((run) => run.basedOnMemoryRevision === 2)).toMatchObject({
    status: "queued",
    expectedSummaryRevision: 1,
  });

  await forgetCharacter(database, { ...input, expectedRevision: 1 });
  expect(
    await database.transaction((tx) =>
      ensureAutomaticSummaryRefresh(tx, input),
    ),
  ).toBeNull();
});

test("empty forgotten relationships cannot starve the bounded reconciliation batch", async () => {
  const input = await summaryFixture(database);
  await process(input.operationId!);
  const ids = Array.from({ length: 50 }, () => randomUUID());
  await database.insert(user).values(
    ids.map((id) => ({
      id,
      email: `${id}@example.com`,
      name: "Forgotten",
    })),
  );
  await database.insert(userCharacterMemorySetting).values(
    ids.map((userId) => ({
      userId,
      characterId: input.characterId,
      memoryEpoch: 1,
      memoryRevision: 2,
      updatedAt: new Date(0),
    })),
  );
  await database
    .update(userCharacterMemorySetting)
    .set({ memoryRevision: 2 })
    .where(eq(userCharacterMemorySetting.userId, input.userId));
  expect(
    await enqueuePendingSummaryRuns(
      database,
      { send: vi.fn(async () => "eligible-job") },
      new Date(),
    ),
  ).toBe(1);
});

test("database-terminal dead-letter publication failure rolls back both job and marker and recovery is idempotent", async () => {
  const boss = createBoss(testDatabaseUrl());
  let stop: (() => Promise<void>) | undefined;
  let trigger = false;
  const logger = { error: vi.fn() };
  try {
    await boss.start();
    await ensureQueues(boss);
    await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_QUEUE);
    await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE);
    const input = await summaryFixture(database);
    const gateway = extractionGateway(async () => {
      throw new ModelGatewayError("server", { retryable: true });
    });
    for (let count = 0; count < 5; count++) {
      await database
        .update(relationshipSummaryRun)
        .set({ nextRetryAt: new Date(0) });
      await expect(process(input.operationId!, gateway)).rejects.toMatchObject({
        category: "server",
      });
    }
    await database.execute(
      sql.raw(`
      CREATE FUNCTION task6_fail_publication() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'private-summary-publication-body'; END $$;
      CREATE TRIGGER task6_fail_publication BEFORE UPDATE OF dead_letter_published_at
      ON relationship_summary_runs FOR EACH ROW EXECUTE FUNCTION task6_fail_publication()
    `),
    );
    trigger = true;
    stop = await registerRelationshipSummaryWorker(
      database,
      boss,
      gateway,
      extractionCounter,
      logger,
    );
    expect(await boss.findJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE)).toEqual(
      [],
    );
    expect(
      (await database.select().from(relationshipSummaryRun))[0]
        .deadLetterPublishedAt,
    ).toBeNull();
    const wake = await boss.send(RELATIONSHIP_SUMMARY_QUEUE, {
      operationId: input.operationId,
    });
    await expect
      .poll(
        async () =>
          (await boss.getJobById(RELATIONSHIP_SUMMARY_QUEUE, wake!))?.state,
        { timeout: 6000 },
      )
      .toBe("retry");
    expect(
      JSON.stringify(
        (await boss.getJobById(RELATIONSHIP_SUMMARY_QUEUE, wake!))?.output,
      ),
    ).not.toContain("private-summary-publication-body");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "private-summary-publication-body",
    );
    await database.execute(
      sql.raw(
        "DROP TRIGGER task6_fail_publication ON relationship_summary_runs; DROP FUNCTION task6_fail_publication()",
      ),
    );
    trigger = false;
    await enqueuePendingSummaryRuns(database, boss, new Date());
    await enqueuePendingSummaryRuns(database, boss, new Date());
    expect(
      await boss.findJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE),
    ).toHaveLength(1);
    expect(
      (await database.select().from(relationshipSummaryRun))[0]
        .deadLetterPublishedAt,
    ).toBeInstanceOf(Date);
  } finally {
    if (trigger)
      await database.execute(
        sql.raw(
          "DROP TRIGGER task6_fail_publication ON relationship_summary_runs; DROP FUNCTION task6_fail_publication()",
        ),
      );
    await stop?.();
    await boss.offWork(RELATIONSHIP_SUMMARY_QUEUE);
    await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_QUEUE);
    await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE);
    await boss.stop({ graceful: false });
  }
}, 20000);

test("periodic worker reconciliation picks up a committed revision after startup", async () => {
  const boss = createBoss(testDatabaseUrl());
  let stop: (() => Promise<void>) | undefined;
  try {
    await boss.start();
    await ensureQueues(boss);
    await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_QUEUE);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    stop = await registerRelationshipSummaryWorker(
      database,
      boss,
      extractionGateway(async () => summaryResult()),
      extractionCounter,
      { error: vi.fn() },
    );
    const input = await summaryFixture(database);
    expect(
      (await database.select().from(relationshipSummaryRun))[0].jobId,
    ).toBeNull();
    await vi.advanceTimersByTimeAsync(30000);
    await expect
      .poll(
        async () =>
          (await database.select().from(relationshipSummaryRun))[0].status,
        { timeout: 6000 },
      )
      .toBe("complete");
    expect(await getRelationshipSummary(database, input)).toMatchObject({
      content: "Enjoys green tea.",
    });
  } finally {
    await stop?.();
    vi.useRealTimers();
    await boss.offWork(RELATIONSHIP_SUMMARY_QUEUE);
    await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_QUEUE);
    await boss.stop({ graceful: false });
  }
});
