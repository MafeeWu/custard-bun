// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { CharacterContent } from "@/server/characters/character-content";
import { characterContentDigest } from "@/server/characters/content-digest";
import { testDatabaseUrl } from "@/test/database-target";
import { createDatabase } from "./client";
import { characterVersion } from "./character-schema";

const database = createDatabase(testDatabaseUrl());

const validContent: CharacterContent = {
  displayName: "Mira",
  avatarPath: "/characters/calm-listener.svg",
  shortDescription: "A calm, attentive companion.",
  longDescription: "Mira listens carefully and responds without rushing.",
  personalityPrinciples: ["Listen before advising.", "Name uncertainty."],
  speakingStyle: "Warm, direct, and unhurried.",
  responseRhythm: "Usually two short paragraphs followed by one question.",
  relationshipBoundaries: [
    "Never claim consciousness.",
    "Do not encourage dependency.",
  ],
  openingMessage: "What would feel useful to talk through today?",
  exampleConversations: [
    {
      user: "I had a difficult day.",
      assistant: "I am here. Which part is weighing on you most?",
    },
  ],
  generationParameters: {
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: 800,
  },
  safetyAdditions: ["Use grounding language when the user sounds overwhelmed."],
};

beforeEach(async () => {
  await database.execute(
    sql.raw(`
    TRUNCATE TABLE
      admin_audit_events,
      character_drafts,
      character_versions,
      characters
    RESTART IDENTITY CASCADE
  `),
  );
});

afterAll(async () => {
  await database.$client.end();
});

async function expectDatabaseError(
  promise: Promise<unknown>,
  matcher: RegExp,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected database operation to fail");
  } catch (error: unknown) {
    const messageParts = [
      error instanceof Error ? error.message : "",
      error &&
      typeof error === "object" &&
      "cause" in error &&
      error.cause instanceof Error
        ? error.cause.message
        : "",
    ].filter(Boolean);

    expect(messageParts.join("\n")).toMatch(matcher);
  }
}

async function insertCharacter(options: {
  id?: string;
  slug: string;
  defaultVersionId?: string | null;
}) {
  const id = options.id ?? randomUUID();
  await database.execute(sql`
    INSERT INTO characters (id, slug, lifecycle, default_version_id)
    VALUES (${id}, ${options.slug}, 'active', ${options.defaultVersionId ?? null})
  `);
  return id;
}

async function insertDraft(options: {
  characterId: string;
  baseVersionId?: string | null;
  content?: CharacterContent;
}) {
  const content = options.content ?? validContent;
  await database.execute(sql`
    INSERT INTO character_drafts (
      character_id,
      revision,
      base_version_id,
      display_name,
      avatar_path,
      short_description,
      long_description,
      personality_principles,
      speaking_style,
      response_rhythm,
      relationship_boundaries,
      opening_message,
      example_conversations,
      generation_parameters,
      safety_additions
    )
    VALUES (
      ${options.characterId},
      1,
      ${options.baseVersionId ?? null},
      ${content.displayName},
      ${content.avatarPath},
      ${content.shortDescription},
      ${content.longDescription},
      ${JSON.stringify(content.personalityPrinciples)}::jsonb,
      ${content.speakingStyle},
      ${content.responseRhythm},
      ${JSON.stringify(content.relationshipBoundaries)}::jsonb,
      ${content.openingMessage},
      ${JSON.stringify(content.exampleConversations)}::jsonb,
      ${JSON.stringify(content.generationParameters)}::jsonb,
      ${JSON.stringify(content.safetyAdditions)}::jsonb
    )
  `);
}

async function insertPublishedVersion(options: {
  id?: string;
  characterId: string;
  versionNumber: number;
  content?: CharacterContent;
}) {
  const id = options.id ?? randomUUID();
  const content = options.content ?? validContent;

  await database.execute(sql`
    INSERT INTO character_versions (
      id,
      character_id,
      version_number,
      display_name,
      avatar_path,
      short_description,
      long_description,
      personality_principles,
      speaking_style,
      response_rhythm,
      relationship_boundaries,
      opening_message,
      example_conversations,
      generation_parameters,
      safety_additions,
      content_digest,
      published_at
    )
    VALUES (
      ${id},
      ${options.characterId},
      ${options.versionNumber},
      ${content.displayName},
      ${content.avatarPath},
      ${content.shortDescription},
      ${content.longDescription},
      ${JSON.stringify(content.personalityPrinciples)}::jsonb,
      ${content.speakingStyle},
      ${content.responseRhythm},
      ${JSON.stringify(content.relationshipBoundaries)}::jsonb,
      ${content.openingMessage},
      ${JSON.stringify(content.exampleConversations)}::jsonb,
      ${JSON.stringify(content.generationParameters)}::jsonb,
      ${JSON.stringify(content.safetyAdditions)}::jsonb,
      ${characterContentDigest(content)},
      NOW()
    )
  `);

  return id;
}

describe("character storage invariants", () => {
  test("publisher attribution is a durable ID, not a mutable user foreign key", async () => {
    const foreignKeys = getTableConfig(characterVersion).foreignKeys;
    expect(
      foreignKeys.flatMap((key) =>
        key.reference().columns.map((column) => column.name),
      ),
    ).not.toContain("published_by");
    const { rows } = await database.$client.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'character_versions'::regclass
         AND contype = 'f'
         AND pg_get_constraintdef(oid) LIKE '%published_by%'`,
    );
    expect(rows).toHaveLength(0);
  });

  test("published versions, default ownership, and slugs are immutable", async () => {
    const characterId = await insertCharacter({ slug: "mira" });
    const otherCharacterId = await insertCharacter({ slug: "sol" });
    await insertDraft({ characterId });
    await insertDraft({ characterId: otherCharacterId });

    const versionId = await insertPublishedVersion({
      characterId,
      versionNumber: 1,
    });
    const otherCharacterVersionId = await insertPublishedVersion({
      characterId: otherCharacterId,
      versionNumber: 1,
      content: {
        ...validContent,
        displayName: "Sol",
      },
    });

    await database.execute(sql`
      UPDATE characters
      SET default_version_id = ${versionId}
      WHERE id = ${characterId}
    `);

    await expectDatabaseError(
      database.execute(sql`
        UPDATE character_versions
        SET display_name = 'Mutated'
        WHERE id = ${versionId}
      `),
      /immutable/i,
    );

    await expectDatabaseError(
      database.execute(sql`
        DELETE FROM character_versions
        WHERE id = ${versionId}
      `),
      /immutable/i,
    );

    await expectDatabaseError(
      database.execute(sql`
        UPDATE characters
        SET default_version_id = ${otherCharacterVersionId}
        WHERE id = ${characterId}
      `),
      /same character/i,
    );

    await expectDatabaseError(
      database.execute(sql`
        UPDATE characters
        SET slug = 'renamed-character'
        WHERE id = ${characterId}
      `),
      /slug is immutable/i,
    );
  });

  test("allows only one draft and one version number per character", async () => {
    const characterId = await insertCharacter({ slug: "mira" });
    await insertDraft({ characterId });
    await insertPublishedVersion({
      characterId,
      versionNumber: 1,
    });

    await expect(insertDraft({ characterId })).rejects.toThrow();

    await expect(
      insertPublishedVersion({
        characterId,
        versionNumber: 1,
      }),
    ).rejects.toThrow();
  });
});
