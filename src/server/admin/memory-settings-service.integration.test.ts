// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  adminAuditEvent, memoryItem, memorySettings, user, userCharacterMemorySetting,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionAttempt, extractionCounter, extractionFixture, extractionNow, resetExtractionDatabase,
} from "@/test/memory-extraction-fixture";
import { loadMemoryContext } from "@/server/memory/memory-recall";
import { createExtractionRunForCompletedAttempt } from "@/server/memory/memory-extraction-service";
import {
  getGlobalMemorySettings,
  resetGlobalMemorySettings,
  updateGlobalMemorySettings,
} from "./memory-settings-service";

const database = createDatabase(testDatabaseUrl());
const actor = { userId: "admin-memory", label: "administrator", operationId: "setting-op" };
beforeEach(async () => {
  await resetExtractionDatabase(database);
  await database.insert(user).values({
    id: actor.userId,
    name: "Administrator",
    email: "admin-memory@example.com",
    emailVerified: true,
    role: "admin",
  });
  await database.update(memorySettings).set({ deploymentDefaultEnabled: false });
});
afterAll(() => database.$client.end());

test("updates atomically, conflicts leave state unchanged, and reset uses stored deployment default", async () => {
  expect(await getGlobalMemorySettings(database)).toMatchObject({ enabled: true, revision: 1 });
  await expect(updateGlobalMemorySettings(database, actor, {
    expectedRevision: 0, enabled: false,
  })).rejects.toMatchObject({ code: "INVALID_SETTINGS" });
  expect(await updateGlobalMemorySettings(database, actor, {
    expectedRevision: 1, enabled: false,
  })).toEqual({ revision: 2 });
  await expect(updateGlobalMemorySettings(database, actor, {
    expectedRevision: 1, enabled: true,
  })).rejects.toMatchObject({ code: "SETTINGS_CONFLICT" });
  expect(await getGlobalMemorySettings(database)).toMatchObject({ enabled: false, revision: 2 });
  expect(await resetGlobalMemorySettings(database, actor, { expectedRevision: 2 }))
    .toEqual({ enabled: false, revision: 3 });
  const audits = await database.select({ action: adminAuditEvent.action, metadata: adminAuditEvent.metadata })
    .from(adminAuditEvent);
  expect(audits).toEqual([
    { action: "memory.settings.update", metadata: { previousRevision: 1, nextRevision: 2, previousEnabled: true, enabled: false } },
    { action: "memory.settings.reset", metadata: { previousRevision: 2, nextRevision: 3, previousEnabled: false, enabled: false } },
  ]);
});

test("rechecks administrator write authorization inside the transaction", async () => {
  await database.update(user).set({ banned: true }).where(eq(user.id, actor.userId));
  await expect(updateGlobalMemorySettings(database, actor, {
    expectedRevision: 1, enabled: false,
  })).rejects.toThrow("Administrator access required");
  expect(await getGlobalMemorySettings(database)).toMatchObject({ enabled: true, revision: 1 });
});

test("global disable blocks new runs but existing recall follows relationship usage controls", async () => {
  const fixture = await extractionFixture(database);
  const { userId, characterId } = fixture;
  await database.insert(userCharacterMemorySetting).values({ userId, characterId }).onConflictDoNothing();
  await database.insert(memoryItem).values({
    id: "previous-memory", userId, characterId, memoryEpoch: 0, type: "preference",
    content: "Enjoys green tea", normalizedContent: "Enjoys green tea",
    normalizedDigest: createHash("sha256").update("Enjoys green tea").digest("hex"),
    origin: "automatic", sensitivity: "ordinary", explicitness: "direct",
    confidence: 90, importance: 90, firstObservedAt: extractionNow,
    lastConfirmedAt: extractionNow,
  });
  await updateGlobalMemorySettings(database, actor, { expectedRevision: 1, enabled: false });
  const attempt = await extractionAttempt(database, fixture, 1, "Remember the same preference.", "complete");
  expect(await database.transaction((tx) => createExtractionRunForCompletedAttempt(tx, {
    ...fixture, ...attempt, now: extractionNow,
  }))).toBeNull();
  const input = { userId, characterId, summaryTokenBudget: 512, itemTokenBudget: 1536, tokenCounter: extractionCounter };
  expect((await loadMemoryContext(database, input)).items).toHaveLength(1);
  await database.update(userCharacterMemorySetting).set({ usageEnabled: false })
    .where(eq(userCharacterMemorySetting.userId, userId));
  expect((await loadMemoryContext(database, input)).items).toHaveLength(0);
});
