import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  MemoryExplicitness,
  MemorySensitivity,
  MemoryType,
} from "./memory-contracts";
import type { Database } from "@/server/db/client";
import {
  character,
  memoryEvidence,
  memoryItem,
  relationshipSummary,
  relationshipSummaryVersion,
  user,
  userCharacterMemorySetting,
  characterVersion,
  conversation,
  memoryExtractionRun,
  relationshipSummaryRun,
} from "@/server/db/schema";
import {
  EXTRACTION_MAX_EXECUTIONS,
  readExtractionSource,
} from "./memory-extraction-service";

export type MemorySyncStatus =
  "synced" | "processing" | "retrying" | "needs_retry";

export interface MemoryRelationshipOverview {
  character: { id: string; displayName: string };
  itemCount: number;
  recordingEnabled: boolean;
  usageEnabled: boolean;
}

export interface RelationshipMemoryScreenView {
  character: MemoryRelationshipOverview["character"];
  settings: Pick<
    CharacterMemoryView["settings"],
    "recordingEnabled" | "usageEnabled" | "revision"
  >;
  items: CharacterMemoryView["items"];
  summary: CharacterMemoryView["summary"];
  summaryRevision: number;
  extractions: Array<{
    id: string;
    status: MemorySyncStatus;
    canRetry: boolean;
  }>;
  summaryStatus: MemorySyncStatus;
  conversationId?: string;
}

function syncStatus(status: string): MemorySyncStatus {
  if (status === "retrying") return "retrying";
  if (["pending", "queued", "running"].includes(status)) return "processing";
  if (["failed", "dead_letter"].includes(status)) return "needs_retry";
  return "synced";
}

export async function listMemoryRelationships(
  database: Pick<Database, "select">,
  userId: string,
): Promise<MemoryRelationshipOverview[]> {
  const rows = await database
    .select({
      id: character.id,
      displayName: sql<string>`coalesce(${characterVersion.displayName}, ${character.slug})`,
      recordingEnabled: sql<boolean>`coalesce(${userCharacterMemorySetting.recordingEnabled}, true)`,
      usageEnabled: sql<boolean>`coalesce(${userCharacterMemorySetting.usageEnabled}, true)`,
      itemCount: sql<number>`(
      SELECT count(*)::integer FROM ${memoryItem}
      WHERE ${memoryItem.userId} = ${userId}
        AND ${memoryItem.characterId} = ${character.id}
        AND ${memoryItem.memoryEpoch} = coalesce(${userCharacterMemorySetting.memoryEpoch}, 0)
        AND ${memoryItem.isActive} = true
    )`,
    })
    .from(character)
    .innerJoin(
      user,
      and(
        eq(user.id, userId),
        isNull(user.deletionPendingAt),
        eq(user.banned, false),
      ),
    )
    .leftJoin(
      characterVersion,
      eq(characterVersion.id, character.defaultVersionId),
    )
    .leftJoin(
      userCharacterMemorySetting,
      and(
        eq(userCharacterMemorySetting.userId, userId),
        eq(userCharacterMemorySetting.characterId, character.id),
      ),
    )
    .where(
      sql`${userCharacterMemorySetting.userId} IS NOT NULL OR EXISTS (
      SELECT 1 FROM ${conversation}
      WHERE ${conversation.userId} = ${userId}
        AND ${conversation.characterId} = ${character.id}
    )`,
    )
    .orderBy(asc(characterVersion.displayName), asc(character.id));
  return rows.map(({ id, displayName, ...settings }) => ({
    character: { id, displayName },
    ...settings,
  }));
}

export async function getRelationshipMemoryScreenView(
  database: Database,
  input: { userId: string; characterId: string },
): Promise<RelationshipMemoryScreenView | null> {
  return database.transaction(
    async (tx) => {
      const relationship = (
        await listMemoryRelationships(tx, input.userId)
      ).find((row) => row.character.id === input.characterId);
      if (!relationship) return null;
      const view = await getCharacterMemoryView(tx, input);
      if (!view) return null;
      const runs = await tx
        .select()
        .from(memoryExtractionRun)
        .where(
          and(
            eq(memoryExtractionRun.userId, input.userId),
            eq(memoryExtractionRun.characterId, input.characterId),
            eq(memoryExtractionRun.memoryEpoch, view.settings.memoryEpoch),
          ),
        )
        .orderBy(desc(memoryExtractionRun.createdAt));
      const extractions: RelationshipMemoryScreenView["extractions"] = [];
      for (const run of runs) {
        if (run.status === "cancelled" || run.status === "complete") continue;
        const status = syncStatus(run.status);
        extractions.push({
          id: run.id,
          status,
          canRetry:
            status === "needs_retry" &&
            run.attemptCount < EXTRACTION_MAX_EXECUTIONS &&
            Boolean(await readExtractionSource(tx, run)),
        });
      }
      const [summaryRun] = await tx
        .select({ status: relationshipSummaryRun.status })
        .from(relationshipSummaryRun)
        .where(
          and(
            eq(relationshipSummaryRun.userId, input.userId),
            eq(relationshipSummaryRun.characterId, input.characterId),
            eq(relationshipSummaryRun.memoryEpoch, view.settings.memoryEpoch),
          ),
        )
        .orderBy(desc(relationshipSummaryRun.createdAt))
        .limit(1);
      const [active] = await tx
        .select({ id: conversation.id })
        .from(conversation)
        .where(
          and(
            eq(conversation.userId, input.userId),
            eq(conversation.characterId, input.characterId),
            eq(conversation.lifecycle, "active"),
          ),
        )
        .limit(1);
      return {
        character: relationship.character,
        settings: {
          recordingEnabled: view.settings.recordingEnabled,
          usageEnabled: view.settings.usageEnabled,
          revision: view.settings.revision,
        },
        items: view.items,
        summary: view.summary,
        summaryRevision: view.summary?.revision ?? 0,
        extractions,
        summaryStatus: summaryRun ? syncStatus(summaryRun.status) : "synced",
        ...(active ? { conversationId: active.id } : {}),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export interface CharacterMemoryView {
  characterId: string;
  settings: {
    recordingEnabled: boolean;
    usageEnabled: boolean;
    memoryEpoch: number;
    memoryRevision: number;
    revision: number;
  };
  summary: {
    content: string;
    origin: "automatic" | "user_edited";
    revision: number;
    updatedAt: Date;
  } | null;
  items: Array<{
    id: string;
    type: MemoryType;
    content: string;
    origin: "automatic" | "user_edited";
    sensitivity: MemorySensitivity;
    explicitness: MemoryExplicitness;
    lastConfirmedAt: Date;
    supportingSourceCount: number;
    revision: number;
  }>;
}

export async function getCharacterMemoryView(
  database: Pick<Database, "select">,
  input: { userId: string; characterId: string },
): Promise<CharacterMemoryView | null> {
  const [owner] = await database
    .select({
      userId: user.id,
      characterId: character.id,
    })
    .from(user)
    .innerJoin(character, eq(character.id, input.characterId))
    .where(and(eq(user.id, input.userId), isNull(user.deletionPendingAt)))
    .limit(1);
  if (!owner) {
    return null;
  }

  const [storedSettings] = await database
    .select({
      recordingEnabled: userCharacterMemorySetting.recordingEnabled,
      usageEnabled: userCharacterMemorySetting.usageEnabled,
      memoryEpoch: userCharacterMemorySetting.memoryEpoch,
      memoryRevision: userCharacterMemorySetting.memoryRevision,
      revision: userCharacterMemorySetting.revision,
    })
    .from(userCharacterMemorySetting)
    .where(
      and(
        eq(userCharacterMemorySetting.userId, input.userId),
        eq(userCharacterMemorySetting.characterId, input.characterId),
      ),
    )
    .limit(1);

  const settings = storedSettings ?? {
    recordingEnabled: true,
    usageEnabled: true,
    memoryEpoch: 0,
    memoryRevision: 0,
    revision: 1,
  };

  const items = await database
    .select({
      id: memoryItem.id,
      type: memoryItem.type,
      content: memoryItem.content,
      origin: memoryItem.origin,
      sensitivity: memoryItem.sensitivity,
      explicitness: memoryItem.explicitness,
      lastConfirmedAt: memoryItem.lastConfirmedAt,
      supportingSourceCount: count(memoryEvidence.id),
      revision: memoryItem.revision,
    })
    .from(memoryItem)
    .leftJoin(memoryEvidence, eq(memoryEvidence.memoryId, memoryItem.id))
    .where(
      and(
        eq(memoryItem.userId, input.userId),
        eq(memoryItem.characterId, input.characterId),
        eq(memoryItem.memoryEpoch, settings.memoryEpoch),
        eq(memoryItem.isActive, true),
      ),
    )
    .groupBy(memoryItem.id)
    .orderBy(desc(memoryItem.lastConfirmedAt), asc(memoryItem.id));

  const [summary] = await database
    .select({
      content: relationshipSummaryVersion.content,
      origin: relationshipSummaryVersion.origin,
      revision: relationshipSummary.revision,
      updatedAt: relationshipSummary.updatedAt,
    })
    .from(relationshipSummary)
    .innerJoin(
      relationshipSummaryVersion,
      and(
        eq(relationshipSummaryVersion.id, relationshipSummary.currentVersionId),
        eq(relationshipSummaryVersion.userId, relationshipSummary.userId),
        eq(
          relationshipSummaryVersion.characterId,
          relationshipSummary.characterId,
        ),
        eq(
          relationshipSummaryVersion.memoryEpoch,
          relationshipSummary.memoryEpoch,
        ),
      ),
    )
    .where(
      and(
        eq(relationshipSummary.userId, input.userId),
        eq(relationshipSummary.characterId, input.characterId),
        eq(relationshipSummary.memoryEpoch, settings.memoryEpoch),
      ),
    )
    .limit(1);

  return {
    characterId: input.characterId,
    settings,
    summary: summary ?? null,
    items,
  };
}
