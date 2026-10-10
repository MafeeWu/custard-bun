import "server-only";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { ChatTransaction } from "@/server/chat/chat-locks";
import {
  adminAuditEvent,
  character,
  characterVersion,
  chatSettings,
  conversation,
  conversationMessage,
  generationAttempt,
  memoryEvidence,
  memoryItem,
  relationshipSummary,
  relationshipSummaryVersion,
  usageLedger,
  user,
  userCharacterMemorySetting,
  userChatQuotaOverride,
} from "@/server/db/schema";
import {
  DataExportArchiveBuilder,
  ExportArchiveError,
} from "./data-export-archive";

// Every projection is an allowlist. Never spread database rows into private exports.
export async function readDataExportSnapshot(
  tx: ChatTransaction,
  userId: string,
  snapshotAt: Date,
  maxBytes: number,
) {
  const archive = new DataExportArchiveBuilder(maxBytes);
  let snapshotBytes = 0;
  async function rows<T>(query: {
    execute(): Promise<T[]>;
    limit(value: number): unknown;
    offset(value: number): unknown;
  }): Promise<T[]> {
    const result: T[] = [];
    query.limit(200);
    for (let offset = 0; ; offset += 200) {
      query.offset(offset);
      const page = await query.execute();
      for (const row of page) {
        snapshotBytes += Buffer.byteLength(JSON.stringify(row), "utf8") + 1;
        if (snapshotBytes > maxBytes)
          throw new ExportArchiveError("size_limit");
        result.push(row);
      }
      if (page.length < 200) return result;
    }
  }
  const [profile] = await tx
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .where(eq(user.id, userId));
  if (!profile) throw new Error("Export account unavailable.");
  archive.add("profile.json", profile);

  const ownedConversations = sql`${conversationMessage.conversationId} IN (
    SELECT ${conversation.id} FROM ${conversation} WHERE ${conversation.userId} = ${userId}
  )`;
  const ownedRelationships = sql`${character.id} IN (
    SELECT ${conversation.characterId} FROM ${conversation} WHERE ${conversation.userId} = ${userId}
    UNION SELECT ${userCharacterMemorySetting.characterId} FROM ${userCharacterMemorySetting} WHERE ${userCharacterMemorySetting.userId} = ${userId}
    UNION SELECT ${memoryItem.characterId} FROM ${memoryItem} WHERE ${memoryItem.userId} = ${userId}
    UNION SELECT ${relationshipSummaryVersion.characterId} FROM ${relationshipSummaryVersion} WHERE ${relationshipSummaryVersion.userId} = ${userId}
  )`;
  archive.add(
    "characters.json",
    await rows(
      tx
        .select({
          id: character.id,
          slug: character.slug,
          lifecycle: character.lifecycle,
          displayName: characterVersion.displayName,
          avatarPath: characterVersion.avatarPath,
          shortDescription: characterVersion.shortDescription,
        })
        .from(character)
        .leftJoin(
          characterVersion,
          eq(characterVersion.id, character.defaultVersionId),
        )
        .where(ownedRelationships)
        .orderBy(asc(character.id)),
    ),
  );
  const versions = await rows(
    tx
      .select({
        id: characterVersion.id,
        characterId: characterVersion.characterId,
        versionNumber: characterVersion.versionNumber,
        displayName: characterVersion.displayName,
        avatarPath: characterVersion.avatarPath,
        shortDescription: characterVersion.shortDescription,
      })
      .from(characterVersion)
      .where(
        sql`${characterVersion.id} IN (
    SELECT ${conversation.characterVersionId} FROM ${conversation} WHERE ${conversation.userId} = ${userId}
  )`,
      )
      .orderBy(asc(characterVersion.id)),
  );
  const conversations = await rows(
    tx
      .select({
        id: conversation.id,
        characterId: conversation.characterId,
        characterVersionId: conversation.characterVersionId,
        lifecycle: conversation.lifecycle,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastMessageAt: conversation.lastMessageAt,
        archivedAt: conversation.archivedAt,
      })
      .from(conversation)
      .where(eq(conversation.userId, userId))
      .orderBy(asc(conversation.id)),
  );
  const messages = await rows(
    tx
      .select({
        id: conversationMessage.id,
        conversationId: conversationMessage.conversationId,
        sequence: conversationMessage.sequence,
        role: conversationMessage.role,
        kind: conversationMessage.kind,
        content: conversationMessage.content,
        inReplyTo: conversationMessage.inReplyTo,
        createdAt: conversationMessage.createdAt,
      })
      .from(conversationMessage)
      .where(ownedConversations)
      .orderBy(
        asc(conversationMessage.conversationId),
        asc(conversationMessage.sequence),
      ),
  );
  const attempts = await rows(
    tx
      .select({
        id: generationAttempt.id,
        assistantMessageId: generationAttempt.assistantMessageId,
        attemptNumber: generationAttempt.attemptNumber,
        isCurrent: generationAttempt.isCurrent,
        status: generationAttempt.status,
        content: generationAttempt.content,
        inputTokens: generationAttempt.inputTokens,
        outputTokens: generationAttempt.outputTokens,
        usageIsEstimated: generationAttempt.usageIsEstimated,
        createdAt: generationAttempt.createdAt,
        completedAt: generationAttempt.completedAt,
      })
      .from(generationAttempt)
      .where(
        and(
          eq(generationAttempt.userId, userId),
          sql`${generationAttempt.assistantMessageId} IN (
    SELECT ${conversationMessage.id} FROM ${conversationMessage} WHERE ${ownedConversations}
  )`,
        ),
      )
      .orderBy(
        asc(generationAttempt.assistantMessageId),
        asc(generationAttempt.attemptNumber),
      ),
  );
  archive.add("conversations.json", {
    conversations,
    versions,
    messages,
    attempts,
  });

  const items = await rows(
    tx
      .select({
        id: memoryItem.id,
        characterId: memoryItem.characterId,
        type: memoryItem.type,
        content: memoryItem.content,
        isActive: memoryItem.isActive,
        origin: memoryItem.origin,
        sensitivity: memoryItem.sensitivity,
        explicitness: memoryItem.explicitness,
        confidence: memoryItem.confidence,
        importance: memoryItem.importance,
        firstObservedAt: memoryItem.firstObservedAt,
        lastConfirmedAt: memoryItem.lastConfirmedAt,
        userEditedAt: memoryItem.userEditedAt,
        createdAt: memoryItem.createdAt,
        updatedAt: memoryItem.updatedAt,
        revision: memoryItem.revision,
      })
      .from(memoryItem)
      .where(eq(memoryItem.userId, userId))
      .orderBy(asc(memoryItem.id)),
  );
  const evidence = await rows(
    tx
      .select({
        id: memoryEvidence.id,
        memoryId: memoryEvidence.memoryId,
        sourceMessageId: memoryEvidence.sourceMessageId,
        sourceAttemptId: memoryEvidence.sourceAttemptId,
        evidenceKind: memoryEvidence.evidenceKind,
        observedAt: memoryEvidence.observedAt,
        sourceDeletedAt: memoryEvidence.sourceDeletedAt,
      })
      .from(memoryEvidence)
      .where(
        and(
          sql`${memoryEvidence.memoryId} IN (SELECT ${memoryItem.id} FROM ${memoryItem} WHERE ${memoryItem.userId} = ${userId})`,
          or(
            isNull(memoryEvidence.sourceMessageId),
            sql`${memoryEvidence.sourceMessageId} IN (SELECT ${conversationMessage.id} FROM ${conversationMessage} WHERE ${ownedConversations})`,
          ),
          or(
            isNull(memoryEvidence.sourceAttemptId),
            sql`${memoryEvidence.sourceAttemptId} IN (SELECT ${generationAttempt.id} FROM ${generationAttempt} WHERE ${generationAttempt.userId} = ${userId})`,
          ),
        ),
      )
      .orderBy(asc(memoryEvidence.id)),
  );
  archive.add("memories.json", { items, evidence });

  const current = await rows(
    tx
      .select({
        characterId: relationshipSummary.characterId,
        currentVersionId: relationshipSummary.currentVersionId,
        revision: relationshipSummary.revision,
        updatedAt: relationshipSummary.updatedAt,
      })
      .from(relationshipSummary)
      .where(eq(relationshipSummary.userId, userId))
      .orderBy(asc(relationshipSummary.characterId)),
  );
  const history = await rows(
    tx
      .select({
        id: relationshipSummaryVersion.id,
        characterId: relationshipSummaryVersion.characterId,
        content: relationshipSummaryVersion.content,
        origin: relationshipSummaryVersion.origin,
        createdAt: relationshipSummaryVersion.createdAt,
      })
      .from(relationshipSummaryVersion)
      .where(eq(relationshipSummaryVersion.userId, userId))
      .orderBy(
        asc(relationshipSummaryVersion.characterId),
        asc(relationshipSummaryVersion.createdAt),
        asc(relationshipSummaryVersion.id),
      ),
  );
  archive.add("summaries.json", { current, history });

  const relationships = await rows(
    tx
      .select({
        characterId: userCharacterMemorySetting.characterId,
        recordingEnabled: userCharacterMemorySetting.recordingEnabled,
        usageEnabled: userCharacterMemorySetting.usageEnabled,
        revision: userCharacterMemorySetting.revision,
        createdAt: userCharacterMemorySetting.createdAt,
        updatedAt: userCharacterMemorySetting.updatedAt,
      })
      .from(userCharacterMemorySetting)
      .where(eq(userCharacterMemorySetting.userId, userId))
      .orderBy(asc(userCharacterMemorySetting.characterId)),
  );
  const [defaults] = await tx
    .select({
      dailyRequestLimit: chatSettings.userDailyRequestLimit,
      dailyTokenLimit: chatSettings.userDailyTokenLimit,
    })
    .from(chatSettings)
    .where(eq(chatSettings.id, "global"));
  const [override] = await tx
    .select({
      dailyRequestLimit: userChatQuotaOverride.dailyRequestLimit,
      dailyTokenLimit: userChatQuotaOverride.dailyTokenLimit,
    })
    .from(userChatQuotaOverride)
    .where(eq(userChatQuotaOverride.userId, userId));
  archive.add("settings.json", {
    relationships,
    chatQuota: {
      dailyRequestLimit:
        override?.dailyRequestLimit ?? defaults?.dailyRequestLimit,
      dailyTokenLimit: override?.dailyTokenLimit ?? defaults?.dailyTokenLimit,
    },
  });
  archive.add(
    "usage.json",
    await rows(
      tx
        .select({
          id: usageLedger.id,
          workloadType: usageLedger.workloadType,
          periodStart: usageLedger.periodStart,
          periodEnd: usageLedger.periodEnd,
          requestUnits: usageLedger.userRequestUnits,
          inputTokens: usageLedger.inputTokens,
          outputTokens: usageLedger.outputTokens,
          usageIsEstimated: usageLedger.usageIsEstimated,
          outcome: usageLedger.outcome,
          createdAt: usageLedger.createdAt,
        })
        .from(usageLedger)
        .where(eq(usageLedger.userId, userId))
        .orderBy(asc(usageLedger.createdAt), asc(usageLedger.id)),
    ),
  );
  archive.add(
    "audit.json",
    await rows(
      tx
        .select({
          id: adminAuditEvent.id,
          action: adminAuditEvent.action,
          targetType: adminAuditEvent.targetType,
          targetId: adminAuditEvent.targetId,
          createdAt: adminAuditEvent.createdAt,
        })
        .from(adminAuditEvent)
        .where(
          or(
            and(
              eq(adminAuditEvent.targetType, "user"),
              eq(adminAuditEvent.targetId, userId),
            ),
            and(
              eq(adminAuditEvent.action, "memory.character_forget"),
              eq(adminAuditEvent.actorUserId, userId),
            ),
          ),
        )
        .orderBy(asc(adminAuditEvent.createdAt), asc(adminAuditEvent.id)),
    ),
  );
  return archive.finish(snapshotAt.toISOString());
}
