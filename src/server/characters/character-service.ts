import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { recordAdminAudit } from "@/server/admin/audit";
import type { AdminActor } from "@/server/admin/admin-actor";
import { requireAdminWrite } from "@/server/admin/require-admin-write";
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
import {
  CharacterNotFoundError,
  DraftConflictError,
  InvalidCharacterStateError,
  InvalidDefaultVersionError,
  UnchangedDraftError,
} from "./character-errors";
import {
  changedCharacterFieldGroups,
  characterContentDigest,
} from "./content-digest";
import { verifyCharacterAvatarAsset } from "./avatar-assets";

export interface CharacterService {
  createCharacter(input: {
    slug: string;
    content: CharacterContent;
  }): Promise<{ characterId: string; draftRevision: number }>;
  saveDraft(input: {
    characterId: string;
    expectedRevision: number;
    content: CharacterContent;
  }): Promise<{ draftRevision: number }>;
  publishDraft(input: {
    characterId: string;
    expectedRevision: number;
  }): Promise<{
    versionId: string;
    versionNumber: number;
    draftRevision: number;
  }>;
  setDefaultVersion(input: {
    characterId: string;
    versionId: string;
  }): Promise<void>;
  setArchived(input: { characterId: string; archived: boolean }): Promise<void>;
}

type CharacterDraftRow = typeof characterDraft.$inferSelect;

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

function draftContent(row: CharacterDraftRow): CharacterContent {
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

function parseContent(content: CharacterContent): CharacterContent {
  return characterContentSchema.parse(content);
}

async function selectCharacterExists(
  executor: Pick<Database, "select">,
  characterId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: character.id })
    .from(character)
    .where(eq(character.id, characterId))
    .limit(1);
  return Boolean(row);
}

async function requireDraft(
  executor: Pick<Database, "select">,
  characterId: string,
): Promise<CharacterDraftRow> {
  const [draft] = await executor
    .select()
    .from(characterDraft)
    .where(eq(characterDraft.characterId, characterId))
    .limit(1);

  if (!draft) {
    throw new CharacterNotFoundError();
  }

  return draft;
}

async function versionNumberFor(
  executor: Pick<Database, "select">,
  versionId: string | null,
): Promise<number | null> {
  if (!versionId) {
    return null;
  }

  const [version] = await executor
    .select({ versionNumber: characterVersion.versionNumber })
    .from(characterVersion)
    .where(eq(characterVersion.id, versionId))
    .limit(1);

  return version?.versionNumber ?? null;
}

export function createCharacterService(dependencies: {
  database: Database;
  actor: AdminActor;
  verifyAvatarAsset?: (avatarPath: string) => Promise<void>;
}): CharacterService {
  const { database, actor } = dependencies;
  const verifyAvatarAsset =
    dependencies.verifyAvatarAsset ?? verifyCharacterAvatarAsset;

  return {
    async createCharacter(input) {
      const slug = characterSlugSchema.parse(input.slug);
      const content = parseContent(input.content);
      const characterId = randomUUID();

      return database.transaction(async (transaction) => {
        await requireAdminWrite(transaction, actor);
        await transaction.insert(character).values({
          id: characterId,
          slug,
          createdBy: actor.userId,
          updatedAt: new Date(),
        });
        const [draft] = await transaction
          .insert(characterDraft)
          .values({
            characterId,
            revision: 1,
            ...contentColumns(content),
            updatedBy: actor.userId,
            updatedAt: new Date(),
          })
          .returning({ revision: characterDraft.revision });

        await recordAdminAudit(transaction, actor, {
          action: "character.create",
          targetType: "character",
          targetId: characterId,
          metadata: { slug, revision: draft.revision },
        });

        return { characterId, draftRevision: draft.revision };
      });
    },

    async saveDraft(input) {
      const content = parseContent(input.content);

      return database.transaction(async (transaction) => {
        await requireAdminWrite(transaction, actor);
        const previousDraft = await requireDraft(
          transaction,
          input.characterId,
        );
        const [updated] = await transaction
          .update(characterDraft)
          .set({
            ...contentColumns(content),
            revision: sql`${characterDraft.revision} + 1`,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characterDraft.characterId, input.characterId),
              eq(characterDraft.revision, input.expectedRevision),
            ),
          )
          .returning({ revision: characterDraft.revision });

        if (!updated) {
          if (await selectCharacterExists(transaction, input.characterId)) {
            throw new DraftConflictError();
          }
          throw new CharacterNotFoundError();
        }

        const changedFields = changedCharacterFieldGroups(
          draftContent(previousDraft),
          content,
        ).join(",");

        await recordAdminAudit(transaction, actor, {
          action: "character.draft.save",
          targetType: "character",
          targetId: input.characterId,
          metadata: { revision: updated.revision, changedFields },
        });

        return { draftRevision: updated.revision };
      });
    },

    async publishDraft(input) {
      return database.transaction(async (transaction) => {
        await requireAdminWrite(transaction, actor);
        await transaction.execute(sql`
          SELECT c.id
          FROM characters c
          JOIN character_drafts d ON d.character_id = c.id
          WHERE c.id = ${input.characterId}
          FOR UPDATE OF c, d
        `);

        const draft = await requireDraft(transaction, input.characterId);
        if (draft.revision !== input.expectedRevision) {
          throw new DraftConflictError();
        }

        const content = draftContent(draft);
        await verifyAvatarAsset(content.avatarPath);
        const digest = characterContentDigest(content);

        if (draft.baseVersionId) {
          const [baseVersion] = await transaction
            .select({ contentDigest: characterVersion.contentDigest })
            .from(characterVersion)
            .where(eq(characterVersion.id, draft.baseVersionId))
            .limit(1);

          if (baseVersion?.contentDigest === digest) {
            throw new UnchangedDraftError();
          }
        }

        const [nextVersion] = await transaction
          .select({
            versionNumber: sql<number>`COALESCE(MAX(${characterVersion.versionNumber}), 0) + 1`,
          })
          .from(characterVersion)
          .where(eq(characterVersion.characterId, input.characterId));
        const versionNumber = Number(nextVersion.versionNumber);
        const versionId = randomUUID();
        const publishedAt = new Date();

        await transaction.insert(characterVersion).values({
          id: versionId,
          characterId: input.characterId,
          versionNumber,
          ...contentColumns(content),
          contentDigest: digest,
          publishedBy: actor.userId,
          publishedAt,
        });

        const [updatedDraft] = await transaction
          .update(characterDraft)
          .set({
            baseVersionId: versionId,
            revision: sql`${characterDraft.revision} + 1`,
            updatedBy: actor.userId,
            updatedAt: publishedAt,
          })
          .where(eq(characterDraft.characterId, input.characterId))
          .returning({ revision: characterDraft.revision });

        await recordAdminAudit(transaction, actor, {
          action: "character.version.publish",
          targetType: "character",
          targetId: input.characterId,
          metadata: { versionNumber },
        });

        return {
          versionId,
          versionNumber,
          draftRevision: updatedDraft.revision,
        };
      });
    },

    async setDefaultVersion(input) {
      await database.transaction(async (transaction) => {
        await requireAdminWrite(transaction, actor);
        await transaction.execute(sql`
          SELECT id
          FROM characters
          WHERE id = ${input.characterId}
          FOR UPDATE
        `);

        const [selectedCharacter] = await transaction
          .select({ defaultVersionId: character.defaultVersionId })
          .from(character)
          .where(eq(character.id, input.characterId))
          .limit(1);

        const [selectedVersion] = await transaction
          .select({
            id: characterVersion.id,
            versionNumber: characterVersion.versionNumber,
          })
          .from(characterVersion)
          .where(
            and(
              eq(characterVersion.id, input.versionId),
              eq(characterVersion.characterId, input.characterId),
            ),
          )
          .limit(1);

        if (!selectedCharacter) {
          throw new CharacterNotFoundError();
        }
        if (!selectedVersion) {
          throw new InvalidDefaultVersionError();
        }

        const previousVersionNumber = await versionNumberFor(
          transaction,
          selectedCharacter.defaultVersionId,
        );

        await transaction
          .update(character)
          .set({
            defaultVersionId: selectedVersion.id,
            updatedAt: new Date(),
          })
          .where(eq(character.id, input.characterId));

        await recordAdminAudit(transaction, actor, {
          action: "character.default.change",
          targetType: "character",
          targetId: input.characterId,
          metadata: {
            previousVersionNumber,
            newVersionNumber: selectedVersion.versionNumber,
          },
        });
      });
    },

    async setArchived(input) {
      await database.transaction(async (transaction) => {
        await requireAdminWrite(transaction, actor);
        const action = input.archived
          ? "character.archive"
          : "character.restore";
        const [updated] = await transaction
          .update(character)
          .set({
            lifecycle: input.archived ? "archived" : "active",
            archivedAt: input.archived ? new Date() : null,
            archivedBy: input.archived ? actor.userId : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(character.id, input.characterId),
              eq(character.lifecycle, input.archived ? "active" : "archived"),
            ),
          )
          .returning({ id: character.id });

        if (!updated) {
          if (await selectCharacterExists(transaction, input.characterId)) {
            throw new InvalidCharacterStateError();
          }
          throw new CharacterNotFoundError();
        }

        await recordAdminAudit(transaction, actor, {
          action,
          targetType: "character",
          targetId: input.characterId,
          metadata: { archived: input.archived },
        });
      });
    },
  };
}
