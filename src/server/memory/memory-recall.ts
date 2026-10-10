import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import type { TokenCounter } from "@/server/chat/token-counter";
import type { ChatTransaction } from "@/server/chat/chat-locks";
import {
  character,
  memoryItem,
  relationshipSummary,
  relationshipSummaryVersion,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import type { MemoryType, MemoryExplicitness } from "./memory-contracts";
import { boundMemoryContext, memoryPromptLimits } from "./memory-prompt";

export interface RecalledMemoryContext {
  summary?: { content: string; versionId: string };
  items: Array<{
    id: string;
    type: MemoryType;
    content: string;
    origin: "automatic" | "user_edited";
    explicitness: MemoryExplicitness;
    importance: number;
    confidence: number;
    lastConfirmedAt: Date;
  }>;
}

export async function loadMemoryContext(
  database: Database | ChatTransaction,
  input: {
    userId: string;
    characterId: string;
    summaryTokenBudget: number;
    itemTokenBudget: number;
    tokenCounter: TokenCounter;
  },
): Promise<RecalledMemoryContext> {
  const currentEpoch = sql<number>`COALESCE(${userCharacterMemorySetting.memoryEpoch}, 0)`;
  // One statement keeps account, controls, epoch, summary and items on one snapshot.
  const rows = await database
    .select({
      summary: {
        content: relationshipSummaryVersion.content,
        versionId: relationshipSummaryVersion.id,
      },
      item: {
        id: memoryItem.id,
        type: memoryItem.type,
        content: memoryItem.content,
        origin: memoryItem.origin,
        explicitness: memoryItem.explicitness,
        importance: memoryItem.importance,
        confidence: memoryItem.confidence,
        lastConfirmedAt: memoryItem.lastConfirmedAt,
      },
    })
    .from(user)
    .innerJoin(character, eq(character.id, input.characterId))
    .leftJoin(
      userCharacterMemorySetting,
      and(
        eq(userCharacterMemorySetting.userId, user.id),
        eq(userCharacterMemorySetting.characterId, character.id),
      ),
    )
    .leftJoin(
      relationshipSummary,
      and(
        eq(relationshipSummary.userId, user.id),
        eq(relationshipSummary.characterId, character.id),
        eq(relationshipSummary.memoryEpoch, currentEpoch),
      ),
    )
    .leftJoin(
      relationshipSummaryVersion,
      and(
        eq(relationshipSummaryVersion.id, relationshipSummary.currentVersionId),
        eq(relationshipSummaryVersion.userId, user.id),
        eq(relationshipSummaryVersion.characterId, character.id),
        eq(relationshipSummaryVersion.memoryEpoch, currentEpoch),
      ),
    )
    .leftJoin(
      memoryItem,
      and(
        eq(memoryItem.userId, user.id),
        eq(memoryItem.characterId, character.id),
        eq(memoryItem.memoryEpoch, currentEpoch),
        eq(memoryItem.isActive, true),
      ),
    )
    .where(
      and(
        eq(user.id, input.userId),
        isNull(user.deletionPendingAt),
        sql`NOT COALESCE(${user.banned}, false)`,
        sql`COALESCE(${userCharacterMemorySetting.usageEnabled}, true)`,
      ),
    )
    .orderBy(
      desc(
        sql`CASE WHEN ${memoryItem.origin} = 'user_edited' THEN 1 ELSE 0 END`,
      ),
      desc(
        sql`CASE WHEN ${memoryItem.explicitness} = 'direct' THEN 1 ELSE 0 END`,
      ),
      desc(memoryItem.importance),
      desc(memoryItem.confidence),
      desc(memoryItem.lastConfirmedAt),
      asc(sql`${memoryItem.id} COLLATE "C"`),
    )
    .limit(memoryPromptLimits.itemCount);

  const context: RecalledMemoryContext = {
    items: rows.flatMap((row) => (row.item ? [row.item] : [])),
  };
  if (rows[0]?.summary) context.summary = rows[0].summary;
  return boundMemoryContext(context, input);
}
