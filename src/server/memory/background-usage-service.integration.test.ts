// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type Database } from "@/server/db/client";
import {
  backgroundModelReservation,
  chatSettings,
  memorySettings,
  quotaBucket,
  usageLedger,
  user,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  admitBackgroundModelWork,
  settleBackgroundModelWork,
} from "./background-usage-service";

const database = createDatabase(testDatabaseUrl());
const now = new Date("2026-10-09T12:00:00.000Z");
const periodStart = new Date("2026-10-01T00:00:00.000Z");
const periodEnd = new Date("2026-11-01T00:00:00.000Z");
const instanceBucketId = `instance:global:${periodStart.toISOString()}`;

beforeEach(async () => {
  await database.execute(
    sql.raw(`
      TRUNCATE TABLE
        usage_ledger,
        background_model_reservations,
        quota_buckets,
        memory_settings,
        chat_settings,
        "user"
      RESTART IDENTITY CASCADE
    `),
  );
  await insertSettings();
});

afterAll(async () => {
  await database.$client.end();
});

async function insertSettings(instanceMonthlyTokenBudget = 1_000) {
  await database.insert(chatSettings).values({
    id: "global",
    userDailyRequestLimit: 10,
    userDailyTokenLimit: 10_000,
    instanceMonthlyRequestLimit: 100,
    instanceMonthlyTokenBudget,
    maxConcurrentGenerations: 2,
    deploymentDefaultUserDailyRequestLimit: 10,
    deploymentDefaultUserDailyTokenLimit: 10_000,
    deploymentDefaultInstanceMonthlyRequestLimit: 100,
    deploymentDefaultInstanceMonthlyTokenBudget: instanceMonthlyTokenBudget,
    deploymentDefaultMaxConcurrentGenerations: 2,
  });
  await database.insert(memorySettings).values({
    id: "global",
    enabled: true,
    deploymentDefaultEnabled: true,
  });
}

async function replaceSettings(instanceMonthlyTokenBudget: number) {
  await database.delete(chatSettings);
  await database.delete(memorySettings);
  await insertSettings(instanceMonthlyTokenBudget);
}

async function insertUser() {
  const id = randomUUID();
  await database.insert(user).values({
    id,
    name: "Background User",
    email: `${id}@example.com`,
    emailVerified: true,
  });
  return id;
}

async function admit(
  executor: Database,
  input: {
    userId: string;
    operationId?: string;
    workloadType?: "memory_extraction" | "summary_refresh";
    estimatedTokens?: number;
  },
) {
  const operationId = input.operationId ?? randomUUID();
  const result = await executor.transaction((transaction) =>
    admitBackgroundModelWork(transaction, {
      userId: input.userId,
      operationId,
      workloadType: input.workloadType ?? "memory_extraction",
      estimatedTokens: input.estimatedTokens ?? 100,
      now,
    }),
  );
  return { ...result, operationId };
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
        query =
          result.rows.find((row) => row.wait_event_type === "Lock")?.query ??
          "";
        return query.length > 0;
      },
      { timeout: 2_000 },
    )
    .toBe(true);
  return query;
}

async function instanceBucket() {
  return (
    await database
      .select()
      .from(quotaBucket)
      .where(eq(quotaBucket.id, instanceBucketId))
  )[0];
}

describe("background model admission", () => {
  test("locks global settings before the instance bucket and changes only instance token reservations", async () => {
    const userId = await insertUser();
    await database.insert(quotaBucket).values({
      id: instanceBucketId,
      scope: "instance",
      periodStart,
      periodEnd,
      consumedRequests: 7,
      reservedRequests: 3,
      consumedTokens: 40,
      reservedTokens: 10,
    });
    const settingsBlocker = await database.$client.connect();
    const bucketBlocker = await database.$client.connect();
    const applicationName = `background-lock-order-${randomUUID()}`;
    const admissionDatabase = createDatabase(testDatabaseUrl(), {
      application_name: applicationName,
      max: 1,
    });
    let admission: ReturnType<typeof admit> | undefined;

    try {
      await settingsBlocker.query("BEGIN");
      await bucketBlocker.query("BEGIN");
      await settingsBlocker.query(
        "SELECT id FROM chat_settings WHERE id = 'global' FOR UPDATE",
      );
      await bucketBlocker.query(
        "SELECT id FROM quota_buckets WHERE id = $1 FOR UPDATE",
        [instanceBucketId],
      );

      admission = admit(admissionDatabase, {
        userId,
        operationId: "lock-order-operation",
        estimatedTokens: 100,
      });
      void admission.catch(() => undefined);

      expect(await waitForWaitingQuery(applicationName)).toMatch(
        /chat_settings/i,
      );
      await settingsBlocker.query("COMMIT");
      expect(await waitForWaitingQuery(applicationName)).toMatch(
        /quota_buckets/i,
      );
      await bucketBlocker.query("COMMIT");

      await expect(admission).resolves.toMatchObject({
        operationId: "lock-order-operation",
        reservationId: expect.any(String),
      });
      expect(await instanceBucket()).toMatchObject({
        consumedRequests: 7,
        reservedRequests: 3,
        consumedTokens: 40,
        reservedTokens: 110,
      });
      expect(
        await database
          .select()
          .from(quotaBucket)
          .where(eq(quotaBucket.scope, "user")),
      ).toHaveLength(0);
    } finally {
      await settingsBlocker.query("ROLLBACK");
      await bucketBlocker.query("ROLLBACK");
      settingsBlocker.release();
      bucketBlocker.release();
      await Promise.allSettled(admission ? [admission] : []);
      await admissionDatabase.$client.end();
    }
  }, 10_000);

  test("rejects work that exceeds the remaining instance token capacity", async () => {
    await replaceSettings(99);
    const userId = await insertUser();

    await expect(
      admit(database, { userId, estimatedTokens: 100 }),
    ).rejects.toMatchObject({
      code: "CHAT_INSTANCE_TOKEN_BUDGET",
    });
    expect(await database.select().from(backgroundModelReservation)).toEqual(
      [],
    );
    expect(await database.select().from(quotaBucket)).toEqual([]);
  });

  test("permits only one operation racing for the final instance tokens", async () => {
    await replaceSettings(100);
    const firstUserId = await insertUser();
    const secondUserId = await insertUser();
    const firstDatabase = createDatabase(testDatabaseUrl(), {
      application_name: `background-final-token-first-${randomUUID()}`,
      max: 1,
    });
    const secondDatabase = createDatabase(testDatabaseUrl(), {
      application_name: `background-final-token-second-${randomUUID()}`,
      max: 1,
    });

    try {
      const results = await Promise.allSettled([
        admit(firstDatabase, {
          userId: firstUserId,
          operationId: "final-token-first",
          estimatedTokens: 100,
        }),
        admit(secondDatabase, {
          userId: secondUserId,
          operationId: "final-token-second",
          estimatedTokens: 100,
        }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
        1,
      );
      const [rejected] = results.filter(
        (result) => result.status === "rejected",
      );
      expect(rejected).toMatchObject({
        reason: { code: "CHAT_INSTANCE_TOKEN_BUDGET" },
      });
      expect(await database.select().from(backgroundModelReservation)).toHaveLength(
        1,
      );
      expect(await instanceBucket()).toMatchObject({
        consumedRequests: 0,
        reservedRequests: 0,
        consumedTokens: 0,
        reservedTokens: 100,
      });
    } finally {
      await firstDatabase.$client.end();
      await secondDatabase.$client.end();
    }
  });
});

describe("background model settlement", () => {
  test("settles actual usage exactly once and releases unused reservation headroom", async () => {
    const userId = await insertUser();
    const { operationId } = await admit(database, {
      userId,
      operationId: "actual-settlement",
      workloadType: "memory_extraction",
      estimatedTokens: 100,
    });
    const settlement = {
      operationId,
      outcome: "complete" as const,
      modelId: "background-model",
      providerRequestIds: ["provider-actual"],
      inputTokens: 30,
      outputTokens: 10,
      estimatedInputTokens: 36,
      estimatedOutputTokens: 12,
      latencyMs: 250,
      now,
    };

    await settleBackgroundModelWork(database, settlement);
    await settleBackgroundModelWork(database, settlement);

    expect(await instanceBucket()).toMatchObject({
      consumedRequests: 0,
      reservedRequests: 0,
      consumedTokens: 40,
      reservedTokens: 0,
    });
    expect(await database.select().from(backgroundModelReservation)).toMatchObject(
      [
        {
          operationId,
          reservedTokens: 100,
          consumedInputTokens: 30,
          consumedOutputTokens: 10,
          settledAt: now,
        },
      ],
    );
    expect(await database.select().from(usageLedger)).toMatchObject([
      {
        backgroundOperationId: operationId,
        memoryExtractionRunId: operationId,
        workloadType: "memory_extraction",
        userRequestUnits: 0,
        providerCallNumber: 1,
        inputTokens: 30,
        outputTokens: 10,
        usageIsEstimated: false,
        modelId: "background-model",
        outcome: "complete",
        errorCategory: null,
        automaticRetryCount: 0,
        latencyMs: 250,
      },
    ]);
  });

  test("uses approved safety-margin estimates when provider usage is missing", async () => {
    const userId = await insertUser();
    const { operationId } = await admit(database, {
      userId,
      workloadType: "summary_refresh",
      estimatedTokens: 100,
    });

    await settleBackgroundModelWork(database, {
      operationId,
      outcome: "failed",
      modelId: "background-model",
      providerRequestIds: ["provider-missing-usage"],
      estimatedInputTokens: 72,
      estimatedOutputTokens: 18,
      latencyMs: 500,
      errorCategory: "total_timeout",
      now,
    });

    expect(await instanceBucket()).toMatchObject({
      consumedRequests: 0,
      reservedRequests: 0,
      consumedTokens: 90,
      reservedTokens: 0,
    });
    expect(await database.select().from(usageLedger)).toMatchObject([
      {
        backgroundOperationId: operationId,
        relationshipSummaryVersionId: null,
        workloadType: "summary_refresh",
        userRequestUnits: 0,
        inputTokens: 72,
        outputTokens: 18,
        usageIsEstimated: true,
        outcome: "failed",
        errorCategory: "total_timeout",
      },
    ]);
  });

  test("records cancelled stale work distinctly and releases the full unused reservation", async () => {
    const userId = await insertUser();
    const { operationId } = await admit(database, {
      userId,
      workloadType: "summary_refresh",
      estimatedTokens: 100,
    });

    await settleBackgroundModelWork(database, {
      operationId,
      outcome: "cancelled",
      modelId: "background-model",
      providerRequestIds: [],
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      latencyMs: 0,
      errorCategory: "stale_operation",
      now,
    });

    expect(await instanceBucket()).toMatchObject({
      consumedRequests: 0,
      reservedRequests: 0,
      consumedTokens: 0,
      reservedTokens: 0,
    });
    expect(await database.select().from(usageLedger)).toMatchObject([
      {
        backgroundOperationId: operationId,
        workloadType: "summary_refresh",
        inputTokens: 0,
        outputTokens: 0,
        usageIsEstimated: true,
        outcome: "cancelled",
        errorCategory: "stale_operation",
      },
    ]);
  });

  test("rejects a conflicting second settlement without changing accounting", async () => {
    const userId = await insertUser();
    const { operationId } = await admit(database, {
      userId,
      estimatedTokens: 100,
    });
    await settleBackgroundModelWork(database, {
      operationId,
      outcome: "complete",
      modelId: "background-model",
      providerRequestIds: ["provider-one"],
      inputTokens: 20,
      outputTokens: 5,
      estimatedInputTokens: 24,
      estimatedOutputTokens: 6,
      latencyMs: 100,
      now,
    });

    await expect(
      settleBackgroundModelWork(database, {
        operationId,
        outcome: "failed",
        modelId: "different-model",
        providerRequestIds: ["provider-two"],
        inputTokens: 40,
        outputTokens: 10,
        estimatedInputTokens: 48,
        estimatedOutputTokens: 12,
        latencyMs: 200,
        errorCategory: "server",
        now,
      }),
    ).rejects.toMatchObject({ code: "MEMORY_INTERNAL" });

    expect(await instanceBucket()).toMatchObject({
      consumedTokens: 25,
      reservedTokens: 0,
    });
    expect(await database.select().from(usageLedger)).toHaveLength(1);
  });

  test("rejects changed provider identity replay without changing settled state", async () => {
    const userId = await insertUser();
    const { operationId } = await admit(database, {
      userId,
      estimatedTokens: 100,
    });
    const settlement = {
      operationId,
      outcome: "complete" as const,
      modelId: "background-model",
      providerRequestIds: ["provider-original"],
      inputTokens: 20,
      outputTokens: 5,
      estimatedInputTokens: 24,
      estimatedOutputTokens: 6,
      latencyMs: 100,
      now,
    };
    await settleBackgroundModelWork(database, settlement);
    const bucketBefore = await instanceBucket();
    const reservationBefore = await database
      .select()
      .from(backgroundModelReservation);
    const ledgerBefore = await database.select().from(usageLedger);
    expect(reservationBefore[0]?.settlementFingerprint).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(JSON.stringify(reservationBefore)).not.toContain(
      "provider-original",
    );
    const replayDatabase = createDatabase(testDatabaseUrl(), {
      application_name: `background-provider-replay-${randomUUID()}`,
      max: 1,
    });

    try {
      await expect(
        settleBackgroundModelWork(replayDatabase, {
          ...settlement,
          providerRequestIds: ["provider-changed"],
        }),
      ).rejects.toMatchObject({ code: "MEMORY_INTERNAL" });
    } finally {
      await replayDatabase.$client.end();
    }

    expect(await instanceBucket()).toEqual(bucketBefore);
    expect(
      await database.select().from(backgroundModelReservation),
    ).toEqual(reservationBefore);
    expect(await database.select().from(usageLedger)).toEqual(ledgerBefore);
  });

  test("provider success followed by concurrent database retry charges one ledger row once", async () => {
    const userId = await insertUser();
    const { operationId } = await admit(database, {
      userId,
      estimatedTokens: 100,
    });
    const firstDatabase = createDatabase(testDatabaseUrl(), {
      application_name: `background-settle-first-${randomUUID()}`,
      max: 1,
    });
    const retryDatabase = createDatabase(testDatabaseUrl(), {
      application_name: `background-settle-retry-${randomUUID()}`,
      max: 1,
    });
    const settlement = {
      operationId,
      outcome: "complete" as const,
      modelId: "background-model",
      providerRequestIds: ["provider-success"],
      inputTokens: 25,
      outputTokens: 5,
      estimatedInputTokens: 30,
      estimatedOutputTokens: 6,
      latencyMs: 125,
      now,
    };

    try {
      await expect(
        Promise.all([
          settleBackgroundModelWork(firstDatabase, settlement),
          settleBackgroundModelWork(retryDatabase, settlement),
        ]),
      ).resolves.toEqual([undefined, undefined]);
      expect(await database.select().from(usageLedger)).toHaveLength(1);
      expect(await instanceBucket()).toMatchObject({
        consumedRequests: 0,
        reservedRequests: 0,
        consumedTokens: 30,
        reservedTokens: 0,
      });
    } finally {
      await firstDatabase.$client.end();
      await retryDatabase.$client.end();
    }
  });
});
