// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  adminAuditEvent,
  accountDeletionRequest,
  account,
  dataExportJob,
  memoryExtractionExecution,
  memoryExtractionRun,
  relationshipSummaryRun,
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
import { createExtractionRunForCompletedAttempt } from "@/server/memory/memory-extraction-service";
import { processAccountPurgeStage } from "@/server/privacy/account-purge-job";
import { retryDeadLetterOperation } from "./memory-operations-service";

const database = createDatabase(testDatabaseUrl());
const actor = { userId: "admin-retry", label: "admin-retry@example.com", operationId: "retry-op" };
beforeEach(async () => {
  await resetExtractionDatabase(database);
  await database.insert(user).values({
    id: actor.userId, name: "Administrator", email: "admin-retry@example.com",
    emailVerified: true, role: "admin",
  });
});
afterAll(() => database.$client.end());

test("enforces exact operation type, terminal state, and active owner with content-free audit", async () => {
  const scope = await extractionFixture(database);
  const attempt = await extractionAttempt(database, scope, 1, "PRIVATE SENTENCE", "complete");
  const { runId } = (await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, { ...scope, ...attempt, now: extractionNow })
  ))!;
  await database.update(memoryExtractionRun).set({
    status: "failed", attemptCount: 1, finishedAt: extractionNow, errorCategory: "internal",
  }).where(eq(memoryExtractionRun.id, runId));
  await expect(retryDeadLetterOperation(database, actor, {
    operationType: "summary_refresh", operationId: runId,
  })).rejects.toMatchObject({ code: "RETRY_UNAVAILABLE" });
  await Promise.all([
    retryDeadLetterOperation(database, actor, { operationType: "memory_extraction", operationId: runId }),
    retryDeadLetterOperation(database, actor, { operationType: "memory_extraction", operationId: runId }),
  ]);
  expect((await database.select().from(memoryExtractionRun))[0].status).toBe("pending");
  const audits = await database.select({
    metadata: adminAuditEvent.metadata, actorLabel: adminAuditEvent.actorLabel,
  }).from(adminAuditEvent);
  expect(audits).toHaveLength(1);
  expect(audits[0].metadata).toEqual({
    operationType: "memory_extraction", operationId: runId,
    previousState: "failed", nextState: "pending",
  });

  expect(JSON.stringify(audits)).not.toContain("PRIVATE SENTENCE");
  expect(JSON.stringify(audits)).not.toContain(actor.label);
  expect(audits[0].actorLabel).toBe("administrator");

  const exportId = randomUUID();
  await database.insert(dataExportJob).values({ id: exportId, userId: scope.userId, status: "failed" });
  await database.update(user).set({ banned: true }).where(eq(user.id, scope.userId));
  await expect(retryDeadLetterOperation(database, actor, {
    operationType: "data_export", operationId: exportId,
  })).rejects.toMatchObject({ code: "RETRY_UNAVAILABLE" });
  await database.update(user).set({ banned: true }).where(eq(user.id, actor.userId));
  await expect(retryDeadLetterOperation(database, actor, {
    operationType: "data_export", operationId: exportId,
  })).rejects.toThrow("Administrator access required");
});

test("an exhausted extraction dead letter restarts through its owning service", async () => {
  const scope = await extractionFixture(database);
  const attempt = await extractionAttempt(database, scope, 1, "PRIVATE HISTORY", "complete");
  const { runId } = (await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, { ...scope, ...attempt, now: extractionNow })
  ))!;
  await database.insert(memoryExtractionExecution).values(
    Array.from({ length: 5 }, (_, index) => ({
      id: randomUUID(), runId, executionNumber: index + 1,
      modelId: "test-model", estimatedInputTokens: 1,
      errorCategory: "internal",
    })),
  );
  await database.update(memoryExtractionRun).set({
    status: "dead_letter", attemptCount: 5, finishedAt: extractionNow,
    deadLetterPublishedAt: extractionNow,
  }).where(eq(memoryExtractionRun.id, runId));
  await expect(database.update(memoryExtractionRun).set({
    attemptCount: 0,
  }).where(eq(memoryExtractionRun.id, runId))).rejects.toThrow();
  await retryDeadLetterOperation(database, actor, {
    operationType: "memory_extraction", operationId: runId,
  });
  expect((await database.select().from(memoryExtractionRun))[0]).toMatchObject({
    status: "pending", attemptCount: 0, deadLetterPublishedAt: null,
  });
  expect(await database.select({ id: memoryExtractionExecution.id }).from(memoryExtractionExecution)).toEqual([]);
  await database.insert(memoryExtractionExecution).values({
    id: randomUUID(), runId, executionNumber: 1, modelId: "test-model",
    estimatedInputTokens: 1,
  });
});

test("summary retry respects current epoch and revives an exhausted dead letter", async () => {
  const { userId, characterId } = await extractionFixture(database);
  const operationId = randomUUID();
  await database.insert(userCharacterMemorySetting).values({ userId, characterId }).onConflictDoNothing();
  await database.insert(relationshipSummaryRun).values({
    id: operationId, userId, characterId, memoryEpoch: 0,
    basedOnMemoryRevision: 0, expectedSummaryRevision: 0,
    status: "dead_letter", attemptCount: 5, finishedAt: extractionNow,
    deadLetterPublishedAt: extractionNow,
  });
  await retryDeadLetterOperation(database, actor, {
    operationType: "summary_refresh", operationId,
  });
  expect((await database.select().from(relationshipSummaryRun))[0]).toMatchObject({
    status: "pending", attemptCount: 0, deadLetterPublishedAt: null,
  });
  await database.update(relationshipSummaryRun).set({
    status: "failed", finishedAt: extractionNow,
  });
  await database.update(userCharacterMemorySetting).set({ memoryEpoch: 1 })
    .where(eq(userCharacterMemorySetting.userId, userId));
  await expect(retryDeadLetterOperation(database, { ...actor, operationId: "different-action" }, {
    operationType: "summary_refresh", operationId,
  })).rejects.toMatchObject({ code: "RETRY_UNAVAILABLE" });
});

test("purge retry delegates after authentication account removal", async () => {
  const { userId } = await extractionFixture(database);
  await database.insert(account).values({
    id: randomUUID(), userId, accountId: userId, providerId: "credential",
    password: "private-password", updatedAt: extractionNow,
  });
  await database.update(user).set({ deletionPendingAt: extractionNow })
    .where(eq(user.id, userId));
  const requestId = randomUUID();
  await database.insert(accountDeletionRequest).values({
    id: requestId, userId, status: "dead_letter", currentStage: "auth",
    verificationConsumedAt: extractionNow, confirmedAt: extractionNow,
    lockedAt: extractionNow, attemptCount: 5, errorCategory: "PURGE_STAGE_FAILED",
  });
  await database.delete(account).where(eq(account.userId, userId));
  expect(await database.select().from(account)).toEqual([]);

  await retryDeadLetterOperation(database, actor, {
    operationType: "account_purge", operationId: requestId,
  });
  expect((await database.select().from(accountDeletionRequest))[0]).toMatchObject({
    status: "purging", attemptCount: 0, currentStage: "auth",
  });
  const [audit] = await database.select().from(adminAuditEvent);
  expect(audit).toMatchObject({
    actorLabel: "administrator", targetId: requestId,
    metadata: { operationType: "account_purge", operationId: requestId,
      previousState: "dead_letter", nextState: "purging" },
  });
  expect(JSON.stringify(audit)).not.toMatch(/admin-retry@example\.com|private-password/);
  await expect(processAccountPurgeStage(database, requestId, extractionNow)).resolves.toBe("complete");
  expect(await database.select().from(user).where(eq(user.id, userId))).toEqual([]);
  await expect(retryDeadLetterOperation(database, actor, {
    operationType: "account_purge", operationId: requestId,
  })).resolves.toBeUndefined();
  await expect(retryDeadLetterOperation(database, { ...actor, operationId: "new-action" }, {
    operationType: "account_purge", operationId: requestId,
  })).rejects.toMatchObject({ code: "RETRY_UNAVAILABLE" });
  expect(await database.select({ status: accountDeletionRequest.status })
    .from(accountDeletionRequest)).toEqual([{ status: "complete" }]);
  const persistedAudits = await database.select().from(adminAuditEvent);
  expect(persistedAudits).toHaveLength(1);
  expect(JSON.stringify(persistedAudits)).not.toMatch(/admin-retry@example\.com|private-password/);
});

test("export retry creates one fresh job via the owning service and audits only the original ID", async () => {
  const { userId } = await extractionFixture(database);
  const exportId = randomUUID();
  await database.insert(dataExportJob).values({
    id: exportId, userId, status: "failed", errorCategory: "internal",
  });
  await Promise.all([
    retryDeadLetterOperation(database, actor, { operationType: "data_export", operationId: exportId }),
    retryDeadLetterOperation(database, actor, { operationType: "data_export", operationId: exportId }),
  ]);
  const jobs = await database.select({
    id: dataExportJob.id, status: dataExportJob.status,
  }).from(dataExportJob);
  expect(jobs).toHaveLength(2);
  expect(jobs).toContainEqual({ id: exportId, status: "failed" });
  expect(jobs).toContainEqual({ id: expect.any(String), status: "pending" });
  const audits = await database.select({ metadata: adminAuditEvent.metadata, actorLabel: adminAuditEvent.actorLabel }).from(adminAuditEvent);
  expect(audits).toEqual([{ actorLabel: "administrator", metadata: {
    operationType: "data_export", operationId: exportId,
    previousState: "failed", nextState: "pending",
  } }]);
});
