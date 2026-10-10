// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  dataExportJob,
  accountDeletionRequest,
  memoryExtractionExecution,
  memoryExtractionRun,
  memoryItem,
  relationshipSummaryVersion,
  relationshipSummaryRun,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionFixture,
  extractionNow,
  resetExtractionDatabase,
} from "@/test/memory-extraction-fixture";
import { createExtractionRunForCompletedAttempt } from "@/server/memory/memory-extraction-service";
import { extractionAttempt } from "@/test/memory-extraction-fixture";
import { getMemoryOperationsDashboard, getMemoryOperationsDetails, type MemoryOperationsDashboard } from "./memory-operations-queries";

type DashboardKeys = "jobs" | "processingDelayMs" | "tokens" | "exports" | "purges" | "failures";
const dashboardHasNoAdditionalKeys: Exclude<keyof MemoryOperationsDashboard, DashboardKeys> extends never ? true : false = true;

const database = createDatabase(testDatabaseUrl());
const secretPhrase = "SECRET TRANSCRIPT PHRASE 91c64";
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());

test("aggregates operations without returning message, memory, summary, or archive content", async () => {
  const fixture = await extractionFixture(database);
  const { userId, characterId } = fixture;
  await database.insert(userCharacterMemorySetting).values({
    userId,
    characterId,
  }).onConflictDoNothing();
  const attempt = await extractionAttempt(database, fixture, 1, secretPhrase, "complete");
  const created = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, { ...fixture, ...attempt, now: extractionNow }));
  await database.update(memoryExtractionRun).set({
    status: "dead_letter", errorCategory: "validation", finishedAt: extractionNow,
    providerRequestIds: [secretPhrase],
    startedAt: new Date(extractionNow.getTime() + 100),
  }).where(eq(memoryExtractionRun.id, created!.runId));
  await database.insert(memoryExtractionExecution).values({
    id: "receipt-private",
    runId: created!.runId,
    executionNumber: 1,
    modelId: "model-private",
    estimatedInputTokens: 5,
    candidates: [{
      type: "preference", content: secretPhrase, sourceMessageId: attempt.sourceMessageId,
      explicitness: "direct", sensitivity: "ordinary",
      userExplicitlyAskedToRemember: false, confidence: 80, importance: 80,
    }],
  });

  await database.insert(memoryItem).values({
    id: "memory-private", userId, characterId, memoryEpoch: 0, type: "preference",
    content: secretPhrase, normalizedContent: secretPhrase,
    normalizedDigest: createHash("sha256").update(secretPhrase).digest("hex"),
    origin: "automatic", sensitivity: "ordinary", explicitness: "direct",
    confidence: 80, importance: 80, firstObservedAt: extractionNow, lastConfirmedAt: extractionNow,
  });
  await database.insert(relationshipSummaryVersion).values({
    id: "summary-version-private", userId, characterId, memoryEpoch: 0,
    content: secretPhrase, origin: "automatic", basedOnMemoryRevision: 0,
  });
  await database.insert(relationshipSummaryRun).values({
    id: "summary-secret",
    userId,
    characterId,
    memoryEpoch: 0,
    expectedSummaryRevision: 0,
    basedOnMemoryRevision: 0,
    status: "failed",
    errorCategory: "internal",
    finishedAt: extractionNow,
    createdAt: extractionNow,
    startedAt: new Date(extractionNow.getTime() + 300),
  });
  await database.insert(dataExportJob).values({
    id: "export-secret",
    userId,
    status: "failed",
    errorCategory: "internal",
  });
  await database.insert(dataExportJob).values({
    id: "unsafe-category", userId, status: "failed", errorCategory: secretPhrase,
  });
  const archiveBytes = Buffer.from(secretPhrase);
  const completedAt = new Date(Date.now() - 60_000);
  await database.insert(dataExportJob).values({
    id: "archive-private", userId, status: "complete",
    archiveBytes, archiveSize: archiveBytes.length,
    archiveSha256: createHash("sha256").update(archiveBytes).digest("hex"),
    completedAt,
    expiresAt: new Date(completedAt.getTime() + 24 * 3600000),
  });
  const dashboard = await getMemoryOperationsDashboard(database, new Date(completedAt.getTime() + 25 * 3600000));
  expect(dashboard.jobs.deadLetter).toBe(1);
  expect(dashboard.jobs.failed).toBe(1);
  expect(dashboard.processingDelayMs).toEqual({ p50: 200, p95: 290 });
  expect(dashboard.exports.expiredBytes).toBe(archiveBytes.length);
  expect(dashboard.failures).toEqual([
    { category: "internal", count: 2 },
    { category: "other", count: 1 },
    { category: "validation", count: 1 },
  ]);
  expect(JSON.stringify(dashboard)).not.toContain(secretPhrase);
  expect(JSON.stringify(dashboard)).not.toContain("archiveBytes");
  expect(JSON.stringify(dashboard)).not.toContain(created!.runId);
  expect((await getMemoryOperationsDetails(database)).exportStates).toEqual([
    { state: "complete", count: 1 },
    { state: "failed", count: 2 },
  ]);
});

test("decodes populated purge and pending timestamps and keeps the public dashboard exact", async () => {
  expect(dashboardHasNoAdditionalKeys).toBe(true);
  const fixture = await extractionFixture(database);
  const attempt = await extractionAttempt(database, fixture);
  await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, { ...fixture, ...attempt, now: extractionNow }));
  await database.insert(relationshipSummaryRun).values({
    id: randomUUID(), userId: fixture.userId, characterId: fixture.characterId,
    memoryEpoch: 0, basedOnMemoryRevision: 0, expectedSummaryRevision: 0,
    createdAt: new Date("2026-10-07T01:00:00Z"),
  });
  await database.insert(accountDeletionRequest).values({
    id: randomUUID(), userId: fixture.userId, status: "locked", currentStage: "settle",
    verificationConsumedAt: extractionNow, confirmedAt: extractionNow,
    lockedAt: new Date("2026-10-06T01:00:00Z"),
  });
  const dashboard = await getMemoryOperationsDashboard(database);
  expect(Object.keys(dashboard).sort()).toEqual(["exports", "failures", "jobs", "processingDelayMs", "purges", "tokens"]);
  expect(dashboard.jobs.pending).toBe(2);
  expect(dashboard.purges).toEqual([{
    stage: "settle", count: 1, oldestAt: new Date("2026-10-06T01:00:00Z"),
  }]);
  expect(dashboard.purges[0].oldestAt?.toISOString()).toBe("2026-10-06T01:00:00.000Z");
  const details = await getMemoryOperationsDetails(database);
  expect(details.oldestPendingAt).toEqual(new Date("2026-10-07T01:00:00Z"));
  expect(details.oldestPendingAt?.toISOString()).toBe("2026-10-07T01:00:00.000Z");
});
