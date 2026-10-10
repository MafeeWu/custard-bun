// @vitest-environment node
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  conversation,
  accountDeletionRequest,
  backgroundModelReservation,
  generationAttempt,
  memoryExtractionExecution,
  memoryExtractionRun,
  memorySettings,
  user,
  userCharacterMemorySetting,
  usageLedger,
} from "@/server/db/schema";
import { processAccountPurgeStage } from "@/server/privacy/account-purge-job";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionAttempt,
  extractionFixture,
  extractionNow,
  resetExtractionDatabase,
} from "@/test/memory-extraction-fixture";
import {
  createExtractionRunForCompletedAttempt,
  enqueuePendingExtractionRuns,
  retryMemoryExtraction,
} from "./memory-extraction-service";
import { forgetCharacter, updateMemoryControls } from "./memory-service";

const database = createDatabase(testDatabaseUrl());
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());

async function fixtureWithAttempt(
  status: typeof generationAttempt.$inferSelect.status = "complete",
) {
  const fixture = await extractionFixture(database);
  const attempt = await extractionAttempt(
    database,
    fixture,
    1,
    "I prefer green tea.",
    status,
  );
  return { ...fixture, ...attempt, now: extractionNow };
}

test("current complete completion inserts exactly one durable run atomically", async () => {
  const input = await fixtureWithAttempt();
  const first = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, input),
  );
  const duplicate = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, input),
  );
  expect(first).toEqual({ runId: expect.any(String) });
  expect(duplicate).toEqual(first);
  expect(await database.select().from(memoryExtractionRun)).toHaveLength(1);
});

test("a transaction rollback removes the run with its completion", async () => {
  const input = await fixtureWithAttempt();
  await expect(
    database.transaction(async (tx) => {
      await createExtractionRunForCompletedAttempt(tx, input);
      throw new Error("rollback completion");
    }),
  ).rejects.toThrow("rollback completion");
  expect(await database.select().from(memoryExtractionRun)).toHaveLength(0);
});

test.each([
  "forget",
  "recording-disable",
  "global-disable",
  "account-lockout",
] as const)(
  "admission fence survives %s followed by restoration before completion",
  async (kind) => {
    const input = await fixtureWithAttempt("streaming");
    expect((await database.select().from(generationAttempt))[0]).toMatchObject({
      extractionMemoryEpoch: 0,
    });
    if (kind === "forget")
      await forgetCharacter(database, { ...input, expectedRevision: 1 });
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
    if (kind === "global-disable") {
      await database.update(memorySettings).set({ enabled: false });
      await database.update(memorySettings).set({ enabled: true });
    }
    if (kind === "account-lockout") {
      await database
        .update(user)
        .set({ deletionPendingAt: extractionNow })
        .where(eq(user.id, input.userId));
      await database
        .update(user)
        .set({ deletionPendingAt: null })
        .where(eq(user.id, input.userId));
    }
    await database
      .update(generationAttempt)
      .set({ status: "complete", completedAt: extractionNow })
      .where(eq(generationAttempt.id, input.attemptId));
    expect(
      (await database.select().from(generationAttempt))[0]
        .extractionMemoryEpoch,
    ).toBeNull();
    expect(
      await database.transaction((tx) =>
        createExtractionRunForCompletedAttempt(tx, input),
      ),
    ).toBeNull();
    await expect(
      database
        .update(generationAttempt)
        .set({ extractionMemoryEpoch: 0 })
        .where(eq(generationAttempt.id, input.attemptId)),
    ).rejects.toThrow();
    expect(await database.select().from(memoryExtractionRun)).toEqual([]);
  },
);

test("an attempt admitted with recording disabled stays ineligible after reenable", async () => {
  const fixture = await extractionFixture(database);
  await database
    .insert(userCharacterMemorySetting)
    .values({ ...fixture, recordingEnabled: false });
  const attempt = await extractionAttempt(database, fixture);
  await updateMemoryControls(database, {
    ...fixture,
    expectedRevision: 1,
    recordingEnabled: true,
    usageEnabled: true,
  });
  expect(
    await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, {
        ...fixture,
        ...attempt,
        now: extractionNow,
      }),
    ),
  ).toBeNull();
});

test.each(["pending", "streaming", "failed", "interrupted"] as const)(
  "%s attempts create no extraction",
  async (status) => {
    const input = await fixtureWithAttempt(status);
    expect(
      await database.transaction((tx) =>
        createExtractionRunForCompletedAttempt(tx, input),
      ),
    ).toBeNull();
  },
);

test.each([
  "superseded",
  "historical",
  "deleted",
  "disabled",
  "global-disabled",
  "deletion-pending",
  "banned",
] as const)("%s source creates no extraction", async (kind) => {
  const input = await fixtureWithAttempt();
  if (kind === "superseded")
    await database
      .update(generationAttempt)
      .set({ isCurrent: false })
      .where(eq(generationAttempt.id, input.attemptId));
  if (kind === "historical")
    await database
      .update(generationAttempt)
      .set({ createdAt: new Date("2026-01-01") })
      .where(eq(generationAttempt.id, input.attemptId));
  if (kind === "deleted")
    await database
      .delete(conversation)
      .where(eq(conversation.id, input.conversationId));
  if (kind === "disabled")
    await database
      .update(userCharacterMemorySetting)
      .set({ recordingEnabled: false })
      .where(eq(userCharacterMemorySetting.userId, input.userId));
  if (kind === "global-disabled")
    await database.update(memorySettings).set({ enabled: false });
  if (kind === "deletion-pending")
    await database
      .update(user)
      .set({ deletionPendingAt: extractionNow })
      .where(eq(user.id, input.userId));
  if (kind === "banned")
    await database
      .update(user)
      .set({ banned: true })
      .where(eq(user.id, input.userId));
  expect(
    await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, input),
    ),
  ).toBeNull();
  expect(await database.select().from(memoryExtractionRun)).toHaveLength(0);
});

test("usage disabled does not disable recording", async () => {
  const input = await fixtureWithAttempt();
  await database
    .update(userCharacterMemorySetting)
    .set({ usageEnabled: false })
    .where(eq(userCharacterMemorySetting.userId, input.userId));
  expect(
    await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, input),
    ),
  ).not.toBeNull();
});

test("reconciler recovers commit-before-send and a lost queue job with the run singleton", async () => {
  const input = await fixtureWithAttempt();
  const run = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, input),
  );
  const send = vi
    .fn<(...args: unknown[]) => Promise<string | null>>()
    .mockRejectedValueOnce(new Error("queue unavailable"))
    .mockResolvedValue("job-1");
  const boss = { send };
  await expect(
    enqueuePendingExtractionRuns(database, boss, extractionNow),
  ).rejects.toThrow();
  expect((await database.select().from(memoryExtractionRun))[0].status).toBe(
    "pending",
  );
  expect(
    await enqueuePendingExtractionRuns(database, boss, extractionNow),
  ).toBe(1);
  expect(send).toHaveBeenLastCalledWith(
    "memory-extraction",
    { runId: run!.runId },
    expect.objectContaining({
      singletonKey: run!.runId,
      retryLimit: 4,
      retryBackoff: true,
      retryDelay: 60,
    }),
  );
  send.mockResolvedValue(null);
  await enqueuePendingExtractionRuns(database, boss, extractionNow);
  expect((await database.select().from(memoryExtractionRun))[0].jobId).toBe(
    "job-1",
  );
  send.mockResolvedValue("job-2");
  await enqueuePendingExtractionRuns(
    database,
    boss,
    new Date(extractionNow.getTime() + 120_000),
  );
  expect((await database.select().from(memoryExtractionRun))[0].jobId).toBe(
    "job-2",
  );
});

test("manual retry is owner scoped and cannot reset the five-execution ceiling", async () => {
  const input = await fixtureWithAttempt();
  const run = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, input),
  );
  await database
    .update(memoryExtractionRun)
    .set({ status: "failed", attemptCount: 1, finishedAt: extractionNow })
    .where(eq(memoryExtractionRun.id, run!.runId));
  await expect(
    retryMemoryExtraction(database, {
      ...input,
      userId: "other",
      runId: run!.runId,
    }),
  ).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
  await retryMemoryExtraction(database, { ...input, runId: run!.runId });
  expect((await database.select().from(memoryExtractionRun))[0]).toMatchObject({
    status: "pending",
    attemptCount: 1,
    finishedAt: null,
  });

  await database
    .update(memoryExtractionRun)
    .set({ status: "dead_letter", attemptCount: 5, finishedAt: extractionNow });
  await expect(
    retryMemoryExtraction(database, { ...input, runId: run!.runId }),
  ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
});

test("exhausted extraction retry followed by purge removes old execution accounting links but retains settled totals", async () => {
  const input = await fixtureWithAttempt();
  const { runId } = (await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, input)))!;
  const operationId = randomUUID();
  await database.insert(memoryExtractionExecution).values(
    Array.from({ length: 5 }, (_, index) => ({
      id: index === 0 ? operationId : randomUUID(),
      runId, executionNumber: index + 1, modelId: "test-model", estimatedInputTokens: 13,
      errorCategory: "internal",
    })),
  );
  const periodStart = new Date("2026-10-01T00:00:00Z");
  const periodEnd = new Date("2026-11-01T00:00:00Z");
  await database.insert(backgroundModelReservation).values({
    id: randomUUID(), operationId, workloadType: "memory_extraction", periodStart, periodEnd,
    reservedTokens: 20, consumedInputTokens: 13, consumedOutputTokens: 7,
    settledAt: extractionNow,
  });

  await database.insert(usageLedger).values({
    id: randomUUID(), backgroundOperationId: operationId, memoryExtractionRunId: runId,
    workloadType: "memory_extraction", periodStart, periodEnd,
    providerCallNumber: 1, inputTokens: 13, outputTokens: 7,
    usageIsEstimated: false, modelId: "test-model", outcome: "failed",
  });
  await database.update(memoryExtractionRun).set({
    status: "dead_letter", attemptCount: 5, finishedAt: extractionNow,
    deadLetterPublishedAt: extractionNow,
  }).where(eq(memoryExtractionRun.id, runId));
  await retryMemoryExtraction(database, { ...input, runId, administrativeRetry: true });
  const requestId = randomUUID();
  await database.insert(accountDeletionRequest).values({
    id: requestId, userId: input.userId, status: "purging", currentStage: "memory",
    verificationConsumedAt: extractionNow, confirmedAt: extractionNow, lockedAt: extractionNow,
  });
  await expect(processAccountPurgeStage(database, requestId, extractionNow)).resolves.toBe("continue");
  expect(await database.select().from(backgroundModelReservation)).toEqual([]);
  expect(await database.select().from(usageLedger)).toMatchObject([{
    backgroundOperationId: null, memoryExtractionRunId: null,
    inputTokens: 13, outputTokens: 7,
  }]);
});

test("exhausted extraction retry keeps receipts when a reservation is not settled", async () => {
  const input = await fixtureWithAttempt();
  const { runId } = (await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, input)))!;
  const operationId = randomUUID();
  await database.insert(memoryExtractionExecution).values({
    id: operationId, runId, executionNumber: 1,
    modelId: "test-model", estimatedInputTokens: 10,
  });
  await database.insert(backgroundModelReservation).values({
    id: randomUUID(), operationId, workloadType: "memory_extraction",
    periodStart: new Date("2026-10-01T00:00:00Z"),
    periodEnd: new Date("2026-11-01T00:00:00Z"),
    reservedTokens: 10,
  });
  await database.update(memoryExtractionRun).set({
    status: "dead_letter", attemptCount: 5, finishedAt: extractionNow,
    deadLetterPublishedAt: extractionNow,
  }).where(eq(memoryExtractionRun.id, runId));
  await expect(retryMemoryExtraction(database, { ...input, runId, administrativeRetry: true }))
    .rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
  expect(await database.select({ id: memoryExtractionExecution.id }).from(memoryExtractionExecution))
    .toEqual([{ id: operationId }]);
  expect(await database.select({ operationId: backgroundModelReservation.operationId })
    .from(backgroundModelReservation)).toEqual([{ operationId }]);
});
