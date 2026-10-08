import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { character, characterVersion } from "@/server/db/character-schema";
import { characterSlugSchema, type CharacterContent } from "./character-content";

export interface PublicCharacterSummary {
  id: string;
  slug: string;
  displayName: string;
  avatarPath: string;
  shortDescription: string;
  openingMessage: string;
}

export interface PublicCharacterDetail extends PublicCharacterSummary {
  longDescription: string;
  personalityPrinciples: string[];
  speakingStyle: string;
  responseRhythm: string;
  relationshipBoundaries: string[];
}

type PublishedCharacterVersion = CharacterContent & {
  id: string;
  characterId: string;
  versionNumber: number;
};

function defaultVersionJoin() {
  return and(
    eq(character.defaultVersionId, characterVersion.id),
    eq(character.id, characterVersion.characterId),
  );
}

export async function listPublicCharacters(
  database: Database,
): Promise<PublicCharacterSummary[]> {
  return database
    .select({
      id: character.id,
      slug: character.slug,
      displayName: characterVersion.displayName,
      avatarPath: characterVersion.avatarPath,
      shortDescription: characterVersion.shortDescription,
      openingMessage: characterVersion.openingMessage,
    })
    .from(character)
    .innerJoin(characterVersion, defaultVersionJoin())
    .where(eq(character.lifecycle, "active"))
    .orderBy(asc(characterVersion.displayName), asc(character.id));
}

export async function getPublicCharacterBySlug(
  database: Database,
  slug: string,
): Promise<PublicCharacterDetail | null> {
  const parsedSlug = characterSlugSchema.safeParse(slug);
  if (!parsedSlug.success) {
    return null;
  }

  const [row] = await database
    .select({
      id: character.id,
      slug: character.slug,
      displayName: characterVersion.displayName,
      avatarPath: characterVersion.avatarPath,
      shortDescription: characterVersion.shortDescription,
      openingMessage: characterVersion.openingMessage,
      longDescription: characterVersion.longDescription,
      personalityPrinciples: characterVersion.personalityPrinciples,
      speakingStyle: characterVersion.speakingStyle,
      responseRhythm: characterVersion.responseRhythm,
      relationshipBoundaries: characterVersion.relationshipBoundaries,
    })
    .from(character)
    .innerJoin(characterVersion, defaultVersionJoin())
    .where(
      and(
        eq(character.lifecycle, "active"),
        eq(character.slug, parsedSlug.data),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function getPublishedCharacterVersion(
  database: Database,
  versionId: string,
): Promise<PublishedCharacterVersion | null> {
  const [row] = await database
    .select({
      id: characterVersion.id,
      characterId: characterVersion.characterId,
      versionNumber: characterVersion.versionNumber,
      displayName: characterVersion.displayName,
      avatarPath: characterVersion.avatarPath,
      shortDescription: characterVersion.shortDescription,
      longDescription: characterVersion.longDescription,
      personalityPrinciples: characterVersion.personalityPrinciples,
      speakingStyle: characterVersion.speakingStyle,
      responseRhythm: characterVersion.responseRhythm,
      relationshipBoundaries: characterVersion.relationshipBoundaries,
      openingMessage: characterVersion.openingMessage,
      exampleConversations: characterVersion.exampleConversations,
      generationParameters: characterVersion.generationParameters,
      safetyAdditions: characterVersion.safetyAdditions,
    })
    .from(characterVersion)
    .where(eq(characterVersion.id, versionId))
    .limit(1);

  return row ?? null;
}

export async function resolveDefaultCharacterVersion(
  database: Database,
  characterId: string,
): Promise<PublishedCharacterVersion | null> {
  const [row] = await database
    .select({
      id: characterVersion.id,
      characterId: characterVersion.characterId,
      versionNumber: characterVersion.versionNumber,
      displayName: characterVersion.displayName,
      avatarPath: characterVersion.avatarPath,
      shortDescription: characterVersion.shortDescription,
      longDescription: characterVersion.longDescription,
      personalityPrinciples: characterVersion.personalityPrinciples,
      speakingStyle: characterVersion.speakingStyle,
      responseRhythm: characterVersion.responseRhythm,
      relationshipBoundaries: characterVersion.relationshipBoundaries,
      openingMessage: characterVersion.openingMessage,
      exampleConversations: characterVersion.exampleConversations,
      generationParameters: characterVersion.generationParameters,
      safetyAdditions: characterVersion.safetyAdditions,
    })
    .from(character)
    .innerJoin(characterVersion, defaultVersionJoin())
    .where(
      and(
        eq(character.id, characterId),
        eq(character.lifecycle, "active"),
      ),
    )
    .limit(1);

  return row ?? null;
}
