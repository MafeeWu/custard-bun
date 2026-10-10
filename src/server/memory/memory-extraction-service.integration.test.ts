// @vitest-environment node
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  conversation,
  generationAttempt,
  memoryExtractionRun,
  memorySettings,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
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
      .insert(userCharacterMemorySetting)
      .values({ ...input, recordingEnabled: false });
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
    .insert(userCharacterMemorySetting)
    .values({ ...input, usageEnabled: false });
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
      deadLetter: "memory-extraction-dead-letter",
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
