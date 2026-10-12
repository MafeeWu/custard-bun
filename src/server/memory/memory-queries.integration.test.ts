// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  character,
  memoryEvidence,
  memoryItem,
  memorySettings,
  relationshipSummary,
  relationshipSummaryVersion,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import { getCharacterMemoryView } from "./memory-queries";

const database = createDatabase(testDatabaseUrl());

beforeEach(async () => {
  await database.execute(sql`
    TRUNCATE TABLE memory_settings, characters, "user"
    RESTART IDENTITY CASCADE
  `);
  await database.insert(memorySettings).values({
    id: "global",
    enabled: false,
    deploymentDefaultEnabled: false,
  });
});

afterAll(async () => {
  await database.$client.end();
});

async function insertUserAndCharacter() {
  const userId = randomUUID();
  const characterId = randomUUID();
  await database.insert(user).values({
    id: userId,
    name: "Memory User",
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  await database.insert(character).values({
    id: characterId,
    slug: `memory-${characterId}`,
  });
  return { userId, characterId };
}

describe("getCharacterMemoryView", () => {
  test("resolves a missing relationship row to fixed enabled controls and epoch zero", async () => {
    const fixture = await insertUserAndCharacter();

    const view = await getCharacterMemoryView(database, fixture);

    expect(view).toEqual({
      characterId: fixture.characterId,
      settings: {
        recordingEnabled: true,
        usageEnabled: true,
        memoryEpoch: 0,
        memoryRevision: 0,
        revision: 1,
      },
      summary: null,
      summaryRevision: 0,
      items: [],
    });
  });

  test("returns only current-epoch memory, source counts, and the owned summary", async () => {
    const fixture = await insertUserAndCharacter();
    const memoryId = randomUUID();
    const oldMemoryId = randomUUID();
    const summaryVersionId = randomUUID();
    const now = new Date("2026-10-10T00:00:00.000Z");
    await database.insert(userCharacterMemorySetting).values({
      ...fixture,
      recordingEnabled: false,
      usageEnabled: true,
      memoryEpoch: 2,
      memoryRevision: 8,
      revision: 4,
    });
    await database.insert(memoryItem).values({
        id: oldMemoryId,
        ...fixture,
        memoryEpoch: 2,
        type: "other",
        content: "Old epoch content.",
        normalizedContent: "Old epoch content.",
        normalizedDigest:
          "bb45e25c794806e045edb5da6ce543c266e3fdb30fdda2b2fd076d10d9695b82",
        origin: "automatic",
        sensitivity: "ordinary",
        explicitness: "direct",
        confidence: 50,
        importance: 50,
        firstObservedAt: now,
        lastConfirmedAt: now,
    });
    await database
      .update(userCharacterMemorySetting)
      .set({ memoryEpoch: 3 })
      .where(
        and(
          eq(userCharacterMemorySetting.userId, fixture.userId),
          eq(userCharacterMemorySetting.characterId, fixture.characterId),
        ),
      );
    await database.insert(memoryItem).values({
      id: memoryId,
      ...fixture,
      memoryEpoch: 3,
      type: "preference",
      content: "Likes jasmine tea.",
      normalizedContent: "Likes jasmine tea.",
      normalizedDigest:
        "c2eddd7be71912eed1454a28458981c5146396a622781ad5121452d6e48ef0c9",
      origin: "user_edited",
      sensitivity: "ordinary",
      explicitness: "direct",
      confidence: 92,
      importance: 70,
      firstObservedAt: now,
      lastConfirmedAt: now,
      userEditedAt: now,
      revision: 2,
    });
    await database.insert(memoryEvidence).values([
      {
        id: randomUUID(),
        memoryId,
        sourceDeletedAt: now,
        observedAt: now,
        evidenceKind: "direct",
      },
      {
        id: randomUUID(),
        memoryId,
        sourceDeletedAt: now,
        observedAt: now,
        evidenceKind: "supporting",
      },
    ]);
    await database.insert(relationshipSummaryVersion).values({
      id: summaryVersionId,
      ...fixture,
      memoryEpoch: 3,
      content: "A trusted tea companion.",
      origin: "user_edited",
      basedOnMemoryRevision: 8,
      createdAt: now,
    });
    await database.insert(relationshipSummary).values({
      ...fixture,
      memoryEpoch: 3,
      currentVersionId: summaryVersionId,
      revision: 5,
      updatedAt: now,
    });

    const view = await getCharacterMemoryView(database, fixture);

    expect(view?.settings).toEqual({
      recordingEnabled: false,
      usageEnabled: true,
      memoryEpoch: 3,
      memoryRevision: 8,
      revision: 4,
    });
    expect(view?.summary).toEqual({
      content: "A trusted tea companion.",
      origin: "user_edited",
      revision: 5,
      updatedAt: now,
    });
    expect(view?.summaryRevision).toBe(5);
    expect(view?.items).toEqual([
      {
        id: memoryId,
        type: "preference",
        content: "Likes jasmine tea.",
        origin: "user_edited",
        sensitivity: "ordinary",
        explicitness: "direct",
        lastConfirmedAt: now,
        supportingSourceCount: 2,
        revision: 2,
      },
    ]);
  });

  test("returns null for a missing user or character and never leaks another user's rows", async () => {
    const owner = await insertUserAndCharacter();
    const otherUserId = randomUUID();
    const memoryId = randomUUID();
    const now = new Date("2026-10-10T00:00:00.000Z");
    await database.insert(user).values({
      id: otherUserId,
      name: "Other User",
      email: `${otherUserId}@example.com`,
      emailVerified: true,
    });
    await database.insert(userCharacterMemorySetting).values({
      ...owner,
      memoryEpoch: 1,
    });
    await database.insert(memoryItem).values({
      id: memoryId,
      ...owner,
      memoryEpoch: 1,
      type: "other",
      content: "Owner-only memory.",
      normalizedContent: "Owner-only memory.",
      normalizedDigest:
        "6089bddbd90e0119a5a9f3e8df2177ae4507a30c37bdd79f47a523f89600c1db",
      origin: "automatic",
      sensitivity: "ordinary",
      explicitness: "direct",
      confidence: 80,
      importance: 80,
      firstObservedAt: now,
      lastConfirmedAt: now,
    });

    const otherView = await getCharacterMemoryView(database, {
      userId: otherUserId,
      characterId: owner.characterId,
    });
    expect(otherView?.items).toEqual([]);
    expect(
      await getCharacterMemoryView(database, {
        userId: randomUUID(),
        characterId: owner.characterId,
      }),
    ).toBeNull();
    expect(
      await getCharacterMemoryView(database, {
        userId: owner.userId,
        characterId: randomUUID(),
      }),
    ).toBeNull();

    const [unchanged] = await database
      .select({ content: memoryItem.content })
      .from(memoryItem)
      .where(eq(memoryItem.id, memoryId));
    expect(unchanged?.content).toBe("Owner-only memory.");
  });
});
