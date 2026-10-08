// @vitest-environment node
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { CharacterContent } from "@/server/characters/character-content";
import { characterContentDigest } from "@/server/characters/content-digest";
import { createDatabase } from "@/server/db/client";
import { character, characterDraft, characterVersion } from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  getPublicCharacterBySlug,
  getPublishedCharacterVersion,
  listPublicCharacters,
  resolveDefaultCharacterVersion,
} from "./character-queries";

const database = createDatabase(testDatabaseUrl());

const baseContent: CharacterContent = {
  displayName: "Calm Companion",
  avatarPath: "/characters/calm-listener.svg",
  shortDescription: "A calm, grounded presence.",
  longDescription: "A patient character for careful reflection.",
  personalityPrinciples: ["Lead with reflection."],
  speakingStyle: "Calm and warm.",
  responseRhythm: "Starts slow and asks one question.",
  relationshipBoundaries: ["Never pretend to be human."],
  openingMessage: "What feels most important right now?",
  exampleConversations: [
    {
      user: "I feel stuck.",
      assistant: "Let's slow down together and name what feels stuck.",
    },
  ],
  generationParameters: {
    temperature: 0.55,
    topP: 0.9,
    maxOutputTokens: 700,
  },
  safetyAdditions: ["Encourage support when safety is unclear."],
};

function contentWith(overrides: Partial<CharacterContent>): CharacterContent {
  return {
    ...baseContent,
    ...overrides,
  };
}

async function insertCharacter(options: {
  id: string;
  slug: string;
  lifecycle?: "active" | "archived";
  defaultVersionId?: string | null;
}) {
  await database.insert(character).values({
    id: options.id,
    slug: options.slug,
    lifecycle: options.lifecycle ?? "active",
    defaultVersionId: options.defaultVersionId ?? null,
    archivedAt: options.lifecycle === "archived" ? new Date() : null,
  });
}

async function insertDraft(options: {
  characterId: string;
  revision?: number;
  baseVersionId?: string | null;
  content: CharacterContent;
}) {
  await database.insert(characterDraft).values({
    characterId: options.characterId,
    revision: options.revision ?? 1,
    baseVersionId: options.baseVersionId ?? null,
    displayName: options.content.displayName,
    avatarPath: options.content.avatarPath,
    shortDescription: options.content.shortDescription,
    longDescription: options.content.longDescription,
    personalityPrinciples: options.content.personalityPrinciples,
    speakingStyle: options.content.speakingStyle,
    responseRhythm: options.content.responseRhythm,
    relationshipBoundaries: options.content.relationshipBoundaries,
    openingMessage: options.content.openingMessage,
    exampleConversations: options.content.exampleConversations,
    generationParameters: options.content.generationParameters,
    safetyAdditions: options.content.safetyAdditions,
  });
}

async function insertVersion(options: {
  id: string;
  characterId: string;
  versionNumber: number;
  content: CharacterContent;
}) {
  await database.insert(characterVersion).values({
    id: options.id,
    characterId: options.characterId,
    versionNumber: options.versionNumber,
    displayName: options.content.displayName,
    avatarPath: options.content.avatarPath,
    shortDescription: options.content.shortDescription,
    longDescription: options.content.longDescription,
    personalityPrinciples: options.content.personalityPrinciples,
    speakingStyle: options.content.speakingStyle,
    responseRhythm: options.content.responseRhythm,
    relationshipBoundaries: options.content.relationshipBoundaries,
    openingMessage: options.content.openingMessage,
    exampleConversations: options.content.exampleConversations,
    generationParameters: options.content.generationParameters,
    safetyAdditions: options.content.safetyAdditions,
    contentDigest: characterContentDigest(options.content),
    publishedAt: new Date(),
  });
}

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

describe("public character queries", () => {
  test("lists and resolves only active characters with default-version public content", async () => {
    const historyCharacterId = "11111111-1111-1111-1111-111111111111";
    const historyDefaultVersionId = "11111111-1111-1111-1111-aaaaaaaaaaaa";
    const historyLatestVersionId = "11111111-1111-1111-1111-bbbbbbbbbbbb";
    const secondCharacterId = "22222222-2222-2222-2222-222222222222";
    const secondDefaultVersionId = "22222222-2222-2222-2222-aaaaaaaaaaaa";
    const noDefaultCharacterId = "33333333-3333-3333-3333-333333333333";
    const archivedCharacterId = "44444444-4444-4444-4444-444444444444";
    const archivedDefaultVersionId = "44444444-4444-4444-4444-aaaaaaaaaaaa";

    const defaultContent = contentWith({
      displayName: "Calm Companion",
      shortDescription: "Visible default summary.",
      longDescription: "Visible default detail.",
      speakingStyle: "Measured and warm.",
      responseRhythm: "Pauses, reflects, then asks one question.",
      openingMessage: "Let's begin with what feels present for you.",
    });
    const latestPublishedContent = contentWith({
      displayName: "Leaked Latest Name",
      shortDescription: "Should never appear publicly.",
      longDescription: "This latest version should stay hidden.",
      openingMessage: "You should not see this latest opening.",
    });
    const draftContent = contentWith({
      displayName: "Leaked Draft Name",
      shortDescription: "Draft text that must not leak.",
      longDescription: "Draft detail that must not leak.",
      openingMessage: "Draft-only opening.",
    });
    const secondContent = contentWith({
      displayName: "Calm Companion",
      avatarPath: "/characters/action-coach.svg",
      shortDescription: "Another visible default summary.",
      longDescription: "Another visible default detail.",
      openingMessage: "A second visible opening message.",
    });
    const noDefaultContent = contentWith({
      displayName: "Hidden Until Default",
      shortDescription: "No default means no public listing.",
    });
    const archivedContent = contentWith({
      displayName: "Archived Character",
      shortDescription: "Archived characters stay private.",
    });

    await insertCharacter({
      id: historyCharacterId,
      slug: "calm-companion-one",
    });
    await insertVersion({
      id: historyDefaultVersionId,
      characterId: historyCharacterId,
      versionNumber: 1,
      content: defaultContent,
    });
    await insertVersion({
      id: historyLatestVersionId,
      characterId: historyCharacterId,
      versionNumber: 2,
      content: latestPublishedContent,
    });
    await insertDraft({
      characterId: historyCharacterId,
      revision: 3,
      baseVersionId: historyLatestVersionId,
      content: draftContent,
    });

    await insertCharacter({
      id: secondCharacterId,
      slug: "calm-companion-two",
    });
    await insertVersion({
      id: secondDefaultVersionId,
      characterId: secondCharacterId,
      versionNumber: 1,
      content: secondContent,
    });
    await insertDraft({
      characterId: secondCharacterId,
      baseVersionId: secondDefaultVersionId,
      content: secondContent,
    });

    await insertCharacter({
      id: noDefaultCharacterId,
      slug: "hidden-until-default",
    });
    await insertVersion({
      id: "33333333-3333-3333-3333-aaaaaaaaaaaa",
      characterId: noDefaultCharacterId,
      versionNumber: 1,
      content: noDefaultContent,
    });
    await insertDraft({
      characterId: noDefaultCharacterId,
      baseVersionId: "33333333-3333-3333-3333-aaaaaaaaaaaa",
      content: noDefaultContent,
    });

    await insertCharacter({
      id: archivedCharacterId,
      slug: "archived-character",
      lifecycle: "archived",
    });
    await insertVersion({
      id: archivedDefaultVersionId,
      characterId: archivedCharacterId,
      versionNumber: 1,
      content: archivedContent,
    });
    await insertDraft({
      characterId: archivedCharacterId,
      baseVersionId: archivedDefaultVersionId,
      content: archivedContent,
    });

    await database
      .update(character)
      .set({ defaultVersionId: historyDefaultVersionId })
      .where(eq(character.id, historyCharacterId));
    await database
      .update(character)
      .set({ defaultVersionId: secondDefaultVersionId })
      .where(eq(character.id, secondCharacterId));
    await database
      .update(character)
      .set({ defaultVersionId: archivedDefaultVersionId })
      .where(eq(character.id, archivedCharacterId));

    expect(await listPublicCharacters(database)).toEqual([
      {
        id: historyCharacterId,
        slug: "calm-companion-one",
        displayName: defaultContent.displayName,
        avatarPath: defaultContent.avatarPath,
        shortDescription: defaultContent.shortDescription,
        openingMessage: defaultContent.openingMessage,
      },
      {
        id: secondCharacterId,
        slug: "calm-companion-two",
        displayName: secondContent.displayName,
        avatarPath: secondContent.avatarPath,
        shortDescription: secondContent.shortDescription,
        openingMessage: secondContent.openingMessage,
      },
    ]);

    expect(
      await getPublicCharacterBySlug(database, "calm-companion-one"),
    ).toEqual({
      id: historyCharacterId,
      slug: "calm-companion-one",
      displayName: defaultContent.displayName,
      avatarPath: defaultContent.avatarPath,
      shortDescription: defaultContent.shortDescription,
      openingMessage: defaultContent.openingMessage,
      longDescription: defaultContent.longDescription,
      personalityPrinciples: defaultContent.personalityPrinciples,
      speakingStyle: defaultContent.speakingStyle,
      responseRhythm: defaultContent.responseRhythm,
      relationshipBoundaries: defaultContent.relationshipBoundaries,
    });

    await expect(
      getPublicCharacterBySlug(database, "hidden-until-default"),
    ).resolves.toBeNull();
    await expect(
      getPublicCharacterBySlug(database, "archived-character"),
    ).resolves.toBeNull();
    await expect(
      getPublicCharacterBySlug(database, "unknown-character"),
    ).resolves.toBeNull();
  });

  test("resolves default versions only for active characters and still loads archived pinned versions", async () => {
    const activeCharacterId = "55555555-5555-5555-5555-555555555555";
    const activeDefaultVersionId = "55555555-5555-5555-5555-aaaaaaaaaaaa";
    const noDefaultCharacterId = "66666666-6666-6666-6666-666666666666";
    const archivedCharacterId = "77777777-7777-7777-7777-777777777777";
    const archivedVersionId = "77777777-7777-7777-7777-aaaaaaaaaaaa";

    const activeContent = contentWith({
      displayName: "Visible Default",
      avatarPath: "/characters/energetic-friend.svg",
      openingMessage: "Visible default opening.",
    });
    const archivedContent = contentWith({
      displayName: "Archived Version",
      avatarPath: "/characters/rational-companion.svg",
      shortDescription: "Archived but still pinned for old sessions.",
    });

    await insertCharacter({
      id: activeCharacterId,
      slug: "visible-default",
    });
    await insertVersion({
      id: activeDefaultVersionId,
      characterId: activeCharacterId,
      versionNumber: 1,
      content: activeContent,
    });
    await insertDraft({
      characterId: activeCharacterId,
      baseVersionId: activeDefaultVersionId,
      content: activeContent,
    });

    await insertCharacter({
      id: noDefaultCharacterId,
      slug: "no-default",
    });
    await insertDraft({
      characterId: noDefaultCharacterId,
      content: contentWith({ displayName: "No Default Draft" }),
    });

    await insertCharacter({
      id: archivedCharacterId,
      slug: "archived-default",
      lifecycle: "archived",
    });
    await insertVersion({
      id: archivedVersionId,
      characterId: archivedCharacterId,
      versionNumber: 4,
      content: archivedContent,
    });
    await insertDraft({
      characterId: archivedCharacterId,
      revision: 5,
      baseVersionId: archivedVersionId,
      content: archivedContent,
    });
    await database
      .update(character)
      .set({ defaultVersionId: activeDefaultVersionId })
      .where(eq(character.id, activeCharacterId));
    await database
      .update(character)
      .set({ defaultVersionId: archivedVersionId })
      .where(eq(character.id, archivedCharacterId));

    expect(
      await resolveDefaultCharacterVersion(database, activeCharacterId),
    ).toEqual({
      id: activeDefaultVersionId,
      characterId: activeCharacterId,
      versionNumber: 1,
      ...activeContent,
    });
    await expect(
      resolveDefaultCharacterVersion(database, noDefaultCharacterId),
    ).resolves.toBeNull();
    await expect(
      resolveDefaultCharacterVersion(database, archivedCharacterId),
    ).resolves.toBeNull();

    expect(
      await getPublishedCharacterVersion(database, archivedVersionId),
    ).toEqual({
      id: archivedVersionId,
      characterId: archivedCharacterId,
      versionNumber: 4,
      ...archivedContent,
    });
    await expect(
      getPublishedCharacterVersion(
        database,
        "88888888-8888-8888-8888-888888888888",
      ),
    ).resolves.toBeNull();
  });
});
