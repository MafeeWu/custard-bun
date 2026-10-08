import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import {
  character,
  characterDraft,
  characterVersion,
} from "@/server/db/character-schema";
import {
  characterContentSchema,
  characterSlugSchema,
  type CharacterContent,
} from "./character-content";

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
      and(eq(character.id, characterId), eq(character.lifecycle, "active")),
    )
    .limit(1);

  return row ?? null;
}

export interface AdminCharacterListItem {
  id: string;
  slug: string;
  lifecycle: "active" | "archived";
  displayName: string;
  draftRevision: number;
  baseVersionNumber: number | null;
  defaultVersionNumber: number | null;
  latestVersionNumber: number | null;
}

export interface AdminCharacterVersionSummary {
  id: string;
  versionNumber: number;
  displayName: string;
  publishedAt: Date;
}

export interface AdminCharacterEditorDetail {
  id: string;
  slug: string;
  lifecycle: "active" | "archived";
  draftRevision: number;
  baseVersionId: string | null;
  baseVersionNumber: number | null;
  defaultVersionId: string | null;
  defaultVersionNumber: number | null;
  draft: CharacterContent;
  versions: AdminCharacterVersionSummary[];
}

export interface AdminCharacterPreview {
  id: string;
  slug: string;
  draftRevision: number;
  draft: CharacterContent;
}

export type AdminCharacterVersion = PublishedCharacterVersion & {
  publishedAt: Date;
};

type ContentProjection = {
  displayName: string;
  avatarPath: string;
  shortDescription: string;
  longDescription: string;
  personalityPrinciples: CharacterContent["personalityPrinciples"];
  speakingStyle: string;
  responseRhythm: string;
  relationshipBoundaries: CharacterContent["relationshipBoundaries"];
  openingMessage: string;
  exampleConversations: CharacterContent["exampleConversations"];
  generationParameters: CharacterContent["generationParameters"];
  safetyAdditions: CharacterContent["safetyAdditions"];
};

function contentFromProjection(row: ContentProjection): CharacterContent {
  return characterContentSchema.parse({
    displayName: row.displayName,
    avatarPath: row.avatarPath,
    shortDescription: row.shortDescription,
    longDescription: row.longDescription,
    personalityPrinciples: row.personalityPrinciples,
    speakingStyle: row.speakingStyle,
    responseRhythm: row.responseRhythm,
    relationshipBoundaries: row.relationshipBoundaries,
    openingMessage: row.openingMessage,
    exampleConversations: row.exampleConversations,
    generationParameters: row.generationParameters,
    safetyAdditions: row.safetyAdditions,
  });
}

async function versionNumberById(
  database: Database,
  versionId: string | null,
): Promise<number | null> {
  if (!versionId) {
    return null;
  }
  const [row] = await database
    .select({ versionNumber: characterVersion.versionNumber })
    .from(characterVersion)
    .where(eq(characterVersion.id, versionId))
    .limit(1);
  return row?.versionNumber ?? null;
}

async function latestVersionNumber(
  database: Database,
  characterId: string,
): Promise<number | null> {
  const [row] = await database
    .select({
      versionNumber: sql<number>`MAX(${characterVersion.versionNumber})`,
    })
    .from(characterVersion)
    .where(eq(characterVersion.characterId, characterId));
  return row.versionNumber === null ? null : Number(row.versionNumber);
}

export async function listAdminCharacters(
  database: Database,
): Promise<AdminCharacterListItem[]> {
  const rows = await database
    .select({
      id: character.id,
      slug: character.slug,
      lifecycle: character.lifecycle,
      defaultVersionId: character.defaultVersionId,
      draftRevision: characterDraft.revision,
      baseVersionId: characterDraft.baseVersionId,
      displayName: characterDraft.displayName,
    })
    .from(character)
    .innerJoin(characterDraft, eq(characterDraft.characterId, character.id))
    .orderBy(asc(characterDraft.displayName), asc(character.id));

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      slug: row.slug,
      lifecycle: row.lifecycle,
      displayName: row.displayName,
      draftRevision: row.draftRevision,
      baseVersionNumber: await versionNumberById(database, row.baseVersionId),
      defaultVersionNumber: await versionNumberById(
        database,
        row.defaultVersionId,
      ),
      latestVersionNumber: await latestVersionNumber(database, row.id),
    })),
  );
}

export async function getAdminCharacterEditorDetail(
  database: Database,
  characterId: string,
): Promise<AdminCharacterEditorDetail | null> {
  const [row] = await database
    .select({
      id: character.id,
      slug: character.slug,
      lifecycle: character.lifecycle,
      defaultVersionId: character.defaultVersionId,
      revision: characterDraft.revision,
      baseVersionId: characterDraft.baseVersionId,
      displayName: characterDraft.displayName,
      avatarPath: characterDraft.avatarPath,
      shortDescription: characterDraft.shortDescription,
      longDescription: characterDraft.longDescription,
      personalityPrinciples: characterDraft.personalityPrinciples,
      speakingStyle: characterDraft.speakingStyle,
      responseRhythm: characterDraft.responseRhythm,
      relationshipBoundaries: characterDraft.relationshipBoundaries,
      openingMessage: characterDraft.openingMessage,
      exampleConversations: characterDraft.exampleConversations,
      generationParameters: characterDraft.generationParameters,
      safetyAdditions: characterDraft.safetyAdditions,
    })
    .from(character)
    .innerJoin(characterDraft, eq(characterDraft.characterId, character.id))
    .where(eq(character.id, characterId))
    .limit(1);

  if (!row) {
    return null;
  }

  const versions = await database
    .select({
      id: characterVersion.id,
      versionNumber: characterVersion.versionNumber,
      displayName: characterVersion.displayName,
      publishedAt: characterVersion.publishedAt,
    })
    .from(characterVersion)
    .where(eq(characterVersion.characterId, characterId))
    .orderBy(desc(characterVersion.versionNumber));

  return {
    id: row.id,
    slug: row.slug,
    lifecycle: row.lifecycle,
    draftRevision: row.revision,
    baseVersionId: row.baseVersionId,
    baseVersionNumber: await versionNumberById(database, row.baseVersionId),
    defaultVersionId: row.defaultVersionId,
    defaultVersionNumber: await versionNumberById(
      database,
      row.defaultVersionId,
    ),
    draft: contentFromProjection(row),
    versions,
  };
}

export async function getAdminCharacterPreview(
  database: Database,
  characterId: string,
): Promise<AdminCharacterPreview | null> {
  const detail = await getAdminCharacterEditorDetail(database, characterId);
  if (!detail) {
    return null;
  }
  return {
    id: detail.id,
    slug: detail.slug,
    draftRevision: detail.draftRevision,
    draft: detail.draft,
  };
}

export async function getAdminCharacterVersion(
  database: Database,
  characterId: string,
  versionId: string,
): Promise<AdminCharacterVersion | null> {
  const [row] = await database
    .select()
    .from(characterVersion)
    .where(
      and(
        eq(characterVersion.characterId, characterId),
        eq(characterVersion.id, versionId),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    characterId: row.characterId,
    versionNumber: row.versionNumber,
    publishedAt: row.publishedAt,
    ...contentFromProjection(row),
  };
}
