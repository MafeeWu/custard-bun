// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { adminAuditEvent } from "@/server/db/audit-schema";
import { createDatabase } from "@/server/db/client";
import {
  character,
  characterDraft,
  characterVersion,
} from "@/server/db/character-schema";
import { testDatabaseUrl } from "@/test/database-target";
import { characterContentDigest } from "./content-digest";
import { OFFICIAL_CHARACTER_SEEDS } from "./seed-definitions";
import { seedOfficialCharacters } from "./seed-characters";

const database = createDatabase(testDatabaseUrl());

beforeEach(async () => {
  await database.execute(
    sql.raw(`
      TRUNCATE TABLE
        admin_audit_events,
        character_drafts,
        character_versions,
        characters,
        "user"
      RESTART IDENTITY CASCADE
    `),
  );
});

afterAll(async () => {
  await database.$client.end();
});

async function officialCharacters() {
  return database
    .select()
    .from(character)
    .where(
      inArray(
        character.id,
        OFFICIAL_CHARACTER_SEEDS.map((seed) => seed.id),
      ),
    )
    .orderBy(character.slug);
}

describe("seedOfficialCharacters", () => {
  test("creates five stable characters with v1 snapshots, revision-1 drafts, defaults, and no audit events", async () => {
    const result = await seedOfficialCharacters(database);

    expect(result).toEqual({ created: 5, existing: 0 });
    const characters = await officialCharacters();
    expect(characters).toHaveLength(5);

    const drafts = await database.select().from(characterDraft);
    const versions = await database.select().from(characterVersion);
    expect(drafts).toHaveLength(5);
    expect(versions).toHaveLength(5);

    for (const seed of OFFICIAL_CHARACTER_SEEDS) {
      const seededCharacter = characters.find((row) => row.id === seed.id);
      const draft = drafts.find((row) => row.characterId === seed.id);
      const version = versions.find((row) => row.characterId === seed.id);

      expect(seededCharacter).toMatchObject({
        id: seed.id,
        slug: seed.slug,
        lifecycle: "active",
        createdBy: null,
        archivedAt: null,
        archivedBy: null,
        defaultVersionId: version?.id,
      });
      expect(version).toMatchObject({
        versionNumber: 1,
        displayName: seed.content.displayName,
        avatarPath: seed.content.avatarPath,
        contentDigest: characterContentDigest(seed.content),
        publishedBy: null,
      });
      expect(draft).toMatchObject({
        revision: 1,
        baseVersionId: version?.id,
        displayName: seed.content.displayName,
        avatarPath: seed.content.avatarPath,
        updatedBy: null,
      });
    }

    expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
  });

  test("reruns count existing seeds without overwriting draft, default, versions, or lifecycle", async () => {
    await seedOfficialCharacters(database);
    const seed = OFFICIAL_CHARACTER_SEEDS[0];
    const [v1] = await database
      .select()
      .from(characterVersion)
      .where(eq(characterVersion.characterId, seed.id));
    const v2Id = randomUUID();
    const editedContent = {
      ...seed.content,
      displayName: "Edited Calm Listener",
      shortDescription: "An edited local draft that seeding must preserve.",
    };

    await database.insert(characterVersion).values({
      id: v2Id,
      characterId: seed.id,
      versionNumber: 2,
      displayName: editedContent.displayName,
      avatarPath: editedContent.avatarPath,
      shortDescription: editedContent.shortDescription,
      longDescription: editedContent.longDescription,
      personalityPrinciples: editedContent.personalityPrinciples,
      speakingStyle: editedContent.speakingStyle,
      responseRhythm: editedContent.responseRhythm,
      relationshipBoundaries: editedContent.relationshipBoundaries,
      openingMessage: editedContent.openingMessage,
      exampleConversations: editedContent.exampleConversations,
      generationParameters: editedContent.generationParameters,
      safetyAdditions: editedContent.safetyAdditions,
      contentDigest: characterContentDigest(editedContent),
      publishedBy: null,
      publishedAt: new Date(),
    });
    await database
      .update(characterDraft)
      .set({
        revision: 2,
        baseVersionId: v2Id,
        displayName: editedContent.displayName,
        shortDescription: editedContent.shortDescription,
      })
      .where(eq(characterDraft.characterId, seed.id));
    await database
      .update(character)
      .set({
        defaultVersionId: v2Id,
        lifecycle: "archived",
        archivedAt: new Date(),
        archivedBy: null,
      })
      .where(eq(character.id, seed.id));

    const result = await seedOfficialCharacters(database);

    expect(result).toEqual({ created: 0, existing: 5 });
    const [afterCharacter] = await database
      .select()
      .from(character)
      .where(eq(character.id, seed.id));
    const [afterDraft] = await database
      .select()
      .from(characterDraft)
      .where(eq(characterDraft.characterId, seed.id));
    const versions = await database
      .select()
      .from(characterVersion)
      .where(eq(characterVersion.characterId, seed.id))
      .orderBy(characterVersion.versionNumber);

    expect(afterCharacter).toMatchObject({
      defaultVersionId: v2Id,
      lifecycle: "archived",
    });
    expect(afterDraft).toMatchObject({
      revision: 2,
      baseVersionId: v2Id,
      displayName: editedContent.displayName,
      shortDescription: editedContent.shortDescription,
    });
    expect(versions.map((version) => version.id)).toEqual([v1.id, v2Id]);
    expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
  });

  test("reserved slug collision fails explicitly without partially creating seeds", async () => {
    await database.insert(character).values({
      id: randomUUID(),
      slug: OFFICIAL_CHARACTER_SEEDS[2].slug,
    });

    await expect(seedOfficialCharacters(database)).rejects.toThrow(
      /official character seed collision/i,
    );

    const characters = await database.select().from(character);
    expect(characters).toHaveLength(1);
    expect(characters[0].slug).toBe(OFFICIAL_CHARACTER_SEEDS[2].slug);
    expect(await database.select().from(characterDraft)).toHaveLength(0);
    expect(await database.select().from(characterVersion)).toHaveLength(0);
    expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
  });
});
