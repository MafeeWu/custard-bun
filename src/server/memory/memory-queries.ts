import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
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
} from "@/server/db/schema";

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
  database: Database,
  input: { userId: string; characterId: string },
): Promise<CharacterMemoryView | null> {
  const [owner] = await database
    .select({
      userId: user.id,
      characterId: character.id,
    })
    .from(user)
    .innerJoin(character, eq(character.id, input.characterId))
    .where(
      and(eq(user.id, input.userId), isNull(user.deletionPendingAt)),
    )
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
        eq(
          relationshipSummaryVersion.id,
          relationshipSummary.currentVersionId,
        ),
        eq(
          relationshipSummaryVersion.userId,
          relationshipSummary.userId,
        ),
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
