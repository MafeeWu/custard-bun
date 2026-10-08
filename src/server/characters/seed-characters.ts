import { randomUUID } from "node:crypto";
import { eq, or } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import {
  character,
  characterDraft,
  characterVersion,
} from "@/server/db/character-schema";
import {
  characterContentSchema,
  type CharacterContent,
} from "./character-content";
import { characterContentDigest } from "./content-digest";
import { verifyCharacterAvatarAsset } from "./avatar-assets";
import {
  OFFICIAL_CHARACTER_SEEDS,
  type OfficialCharacterSeed,
} from "./seed-definitions";

export interface SeedOfficialCharactersOptions {
  rootDirectory?: string;
}

export interface SeedOfficialCharactersResult {
  created: number;
  existing: number;
}

export class OfficialCharacterSeedCollisionError extends Error {
  constructor(seed: OfficialCharacterSeed, detail: string) {
    super(`Official character seed collision for ${seed.slug}: ${detail}`);
    this.name = "OfficialCharacterSeedCollisionError";
  }
}

function contentColumns(content: CharacterContent) {
  return {
    displayName: content.displayName,
    avatarPath: content.avatarPath,
    shortDescription: content.shortDescription,
    longDescription: content.longDescription,
    personalityPrinciples: content.personalityPrinciples,
    speakingStyle: content.speakingStyle,
    responseRhythm: content.responseRhythm,
    relationshipBoundaries: content.relationshipBoundaries,
    openingMessage: content.openingMessage,
    exampleConversations: content.exampleConversations,
    generationParameters: content.generationParameters,
    safetyAdditions: content.safetyAdditions,
  };
}

function assertNoCollision(
  seed: OfficialCharacterSeed,
  rows: { id: string; slug: string }[],
): boolean {
  const idMatch = rows.find((row) => row.id === seed.id);
  if (idMatch && idMatch.slug !== seed.slug) {
    throw new OfficialCharacterSeedCollisionError(
      seed,
      `stable id already uses slug ${idMatch.slug}`,
    );
  }

  const slugMatch = rows.find((row) => row.slug === seed.slug);
  if (slugMatch && slugMatch.id !== seed.id) {
    throw new OfficialCharacterSeedCollisionError(
      seed,
      `slug already belongs to character ${slugMatch.id}`,
    );
  }

  return Boolean(idMatch);
}

export async function seedOfficialCharacters(
  database: Database,
  options: SeedOfficialCharactersOptions = {},
): Promise<SeedOfficialCharactersResult> {
  return database.transaction(async (transaction) => {
    let created = 0;
    let existing = 0;

    for (const seed of OFFICIAL_CHARACTER_SEEDS) {
      const content = characterContentSchema.parse(seed.content);
      const rows = await transaction
        .select({ id: character.id, slug: character.slug })
        .from(character)
        .where(or(eq(character.id, seed.id), eq(character.slug, seed.slug)));

      if (assertNoCollision(seed, rows)) {
        existing += 1;
        continue;
      }

      await verifyCharacterAvatarAsset(
        content.avatarPath,
        options.rootDirectory,
      );
      const versionId = randomUUID();
      const now = new Date();

      await transaction.insert(character).values({
        id: seed.id,
        slug: seed.slug,
        createdBy: null,
        updatedAt: now,
      });
      await transaction.insert(characterVersion).values({
        id: versionId,
        characterId: seed.id,
        versionNumber: 1,
        ...contentColumns(content),
        contentDigest: characterContentDigest(content),
        publishedBy: null,
        publishedAt: now,
      });
      await transaction.insert(characterDraft).values({
        characterId: seed.id,
        revision: 1,
        baseVersionId: versionId,
        ...contentColumns(content),
        updatedBy: null,
        updatedAt: now,
      });
      await transaction
        .update(character)
        .set({ defaultVersionId: versionId, updatedAt: now })
        .where(eq(character.id, seed.id));

      created += 1;
    }

    return { created, existing };
  });
}
