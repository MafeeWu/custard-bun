import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { recordUserAudit } from "@/server/admin/audit";
import { ChatDomainError } from "@/server/chat/chat-errors";
import {
  lockUserCharacterChatMutation,
  type ChatTransaction,
} from "@/server/chat/chat-locks";
import type { Database } from "@/server/db/client";
import {
  character,
  memoryEvidence,
  memoryExtractionRun,
  memoryItem,
  relationshipSummary,
  relationshipSummaryRun,
  relationshipSummaryVersion,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import { assertMemoryCandidateAllowed } from "./memory-policy";
import type { MemorySensitivity, MemoryType } from "./memory-contracts";
import {
  normalizeMemoryCandidate,
  normalizeMemoryText,
} from "./memory-normalization";
import { MemoryDomainError } from "./memory-errors";
import { lockUserMemoryMutation } from "./memory-locks";
import { cancelRelationshipExtractions } from "./memory-extraction-service";

const nonterminalOperationStatuses = [
  "pending",
  "queued",
  "running",
  "retrying",
] as const;

type RelationshipSettings = typeof userCharacterMemorySetting.$inferSelect;

function notFound(): MemoryDomainError {
  return new MemoryDomainError(
    "MEMORY_NOT_FOUND",
    "The requested memory relationship or item was not found.",
  );
}

function revisionConflict(input: {
  memoryId?: string;
  expectedRevision: number;
  actualRevision: number;
}): MemoryDomainError {
  return new MemoryDomainError(
    "MEMORY_REVISION_CONFLICT",
    "Memory changed since it was loaded.",
    {
      metadata: {
        ...(input.memoryId ? { memoryId: input.memoryId } : {}),
        expectedRevision: input.expectedRevision,
        actualRevision: input.actualRevision,
      },
    },
  );
}

async function requireUserAndCharacter(
  transaction: ChatTransaction,
  input: { userId: string; characterId: string },
): Promise<void> {
  const [selectedUser] = await transaction
    .select({ id: user.id })
    .from(user)
    .where(
      and(eq(user.id, input.userId), sql`${user.deletionPendingAt} IS NULL`),
    )
    .for("update")
    .limit(1);
  if (!selectedUser) {
    throw notFound();
  }

  const [selectedCharacter] = await transaction
    .select({ id: character.id })
    .from(character)
    .where(eq(character.id, input.characterId))
    .limit(1);
  if (!selectedCharacter) {
    throw notFound();
  }
}

async function selectRelationshipSettingsForUpdate(
  transaction: ChatTransaction,
  input: { userId: string; characterId: string },
): Promise<RelationshipSettings | null> {
  const [settings] = await transaction
    .select()
    .from(userCharacterMemorySetting)
    .where(
      and(
        eq(userCharacterMemorySetting.userId, input.userId),
        eq(userCharacterMemorySetting.characterId, input.characterId),
      ),
    )
    .for("update")
    .limit(1);
  return settings ?? null;
}

async function ensureRelationshipSettings(
  transaction: ChatTransaction,
  input: { userId: string; characterId: string },
): Promise<RelationshipSettings> {
  const existing = await selectRelationshipSettingsForUpdate(
    transaction,
    input,
  );
  if (existing) {
    return existing;
  }

  await transaction
    .insert(userCharacterMemorySetting)
    .values(input)
    .onConflictDoNothing({
      target: [
        userCharacterMemorySetting.userId,
        userCharacterMemorySetting.characterId,
      ],
    });

  const inserted = await selectRelationshipSettingsForUpdate(
    transaction,
    input,
  );
  if (!inserted) {
    throw new MemoryDomainError(
      "MEMORY_INTERNAL",
      "Memory relationship settings could not be initialized.",
    );
  }
  return inserted;
}

async function beginRelationshipMutation(
  transaction: ChatTransaction,
  input: { userId: string; characterId: string },
): Promise<RelationshipSettings | null> {
  await lockUserMemoryMutation(transaction, input.userId);
  await lockUserCharacterChatMutation(
    transaction,
    input.userId,
    input.characterId,
  );
  await requireUserAndCharacter(transaction, input);
  return selectRelationshipSettingsForUpdate(transaction, input);
}

function validateManualEdit(input: {
  type: MemoryType;
  sensitivity: MemorySensitivity;
  confidence: number;
  importance: number;
  content: string;
}) {
  const normalizedText = normalizeMemoryText(input.content);
  if (normalizedText.length === 0) {
    throw new MemoryDomainError(
      "MEMORY_VALIDATION",
      "Memory content cannot be blank.",
    );
  }

  try {
    const candidate = normalizeMemoryCandidate({
      type: input.type,
      content: input.content,
      sourceMessageId: "00000000-0000-0000-0000-000000000000",
      explicitness: "direct",
      sensitivity: input.sensitivity,
      userExplicitlyAskedToRemember: true,
      confidence: input.confidence,
      importance: input.importance,
    });
    assertMemoryCandidateAllowed(candidate);
    return candidate;
  } catch (error) {
    if (error instanceof ChatDomainError && error.code === "CHAT_VALIDATION") {
      throw new MemoryDomainError("MEMORY_VALIDATION", error.message);
    }
    throw error;
  }
}

export async function updateMemoryControls(
  database: Database,
  input: {
    userId: string;
    characterId: string;
    expectedRevision: number;
    recordingEnabled: boolean;
    usageEnabled: boolean;
  },
): Promise<{ revision: number }> {
  return database.transaction(async (transaction) => {
    const settings = await beginRelationshipMutation(transaction, input);
    const actualRevision = settings?.revision ?? 1;
    if (input.expectedRevision !== actualRevision) {
      throw revisionConflict({
        expectedRevision: input.expectedRevision,
        actualRevision,
      });
    }

    const revision = actualRevision + 1;
    if (!input.recordingEnabled) {
      await cancelRelationshipExtractions(transaction, input, new Date());
    }
    if (!settings) {
      const inserted = await transaction
        .insert(userCharacterMemorySetting)
        .values({
          userId: input.userId,
          characterId: input.characterId,
          recordingEnabled: input.recordingEnabled,
          usageEnabled: input.usageEnabled,
          revision,
        })
        .onConflictDoNothing({
          target: [
            userCharacterMemorySetting.userId,
            userCharacterMemorySetting.characterId,
          ],
        })
        .returning({ revision: userCharacterMemorySetting.revision });
      if (inserted[0]) {
        return inserted[0];
      }

      const winner = await selectRelationshipSettingsForUpdate(
        transaction,
        input,
      );
      if (!winner) {
        throw new MemoryDomainError(
          "MEMORY_INTERNAL",
          "Memory relationship settings could not be created.",
        );
      }
      throw revisionConflict({
        expectedRevision: input.expectedRevision,
        actualRevision: winner.revision,
      });
    }

    const [updated] = await transaction
      .update(userCharacterMemorySetting)
      .set({
        recordingEnabled: input.recordingEnabled,
        usageEnabled: input.usageEnabled,
        revision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userCharacterMemorySetting.userId, input.userId),
          eq(userCharacterMemorySetting.characterId, input.characterId),
          eq(userCharacterMemorySetting.revision, input.expectedRevision),
        ),
      )
      .returning({ revision: userCharacterMemorySetting.revision });
    if (!updated) {
      throw revisionConflict({
        expectedRevision: input.expectedRevision,
        actualRevision,
      });
    }
    return updated;
  });
}

export async function editMemoryItem(
  database: Database,
  input: {
    userId: string;
    characterId: string;
    memoryId: string;
    expectedRevision: number;
    content: string;
  },
): Promise<{ revision: number }> {
  return database.transaction(async (transaction) => {
    const selectedSettings = await beginRelationshipMutation(
      transaction,
      input,
    );
    const settings =
      selectedSettings ??
      (await ensureRelationshipSettings(transaction, input));
    const [item] = await transaction
      .select()
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.id, input.memoryId),
          eq(memoryItem.userId, input.userId),
          eq(memoryItem.characterId, input.characterId),
          eq(memoryItem.memoryEpoch, settings.memoryEpoch),
        ),
      )
      .for("update")
      .limit(1);
    if (!item) {
      throw notFound();
    }
    if (item.revision !== input.expectedRevision) {
      throw revisionConflict({
        memoryId: input.memoryId,
        expectedRevision: input.expectedRevision,
        actualRevision: item.revision,
      });
    }

    const candidate = validateManualEdit({
      type: item.type,
      sensitivity: item.sensitivity,
      confidence: item.confidence,
      importance: item.importance,
      content: input.content,
    });
    const [duplicate] = await transaction
      .select({ id: memoryItem.id })
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.userId, input.userId),
          eq(memoryItem.characterId, input.characterId),
          eq(memoryItem.memoryEpoch, settings.memoryEpoch),
          eq(memoryItem.type, item.type),
          eq(memoryItem.normalizedDigest, candidate.normalizedDigest),
          ne(memoryItem.id, input.memoryId),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new MemoryDomainError(
        "MEMORY_VALIDATION",
        "A matching memory already exists.",
      );
    }

    const now = new Date();
    const revision = item.revision + 1;
    await transaction
      .update(memoryItem)
      .set({
        content: candidate.content,
        normalizedContent: candidate.normalizedContent,
        normalizedDigest: candidate.normalizedDigest,
        automaticDigest:
          item.automaticDigest ??
          (item.origin === "automatic" ? item.normalizedDigest : null),
        origin: "user_edited",
        isActive: true,
        explicitness: "direct",
        userEditedAt: now,
        updatedAt: now,
        revision,
      })
      .where(eq(memoryItem.id, item.id));
    await transaction
      .update(userCharacterMemorySetting)
      .set({
        memoryRevision: settings.memoryRevision + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(userCharacterMemorySetting.userId, input.userId),
          eq(userCharacterMemorySetting.characterId, input.characterId),
        ),
      );

    return { revision };
  });
}

export async function deleteMemoryItem(
  database: Database,
  input: {
    userId: string;
    characterId: string;
    memoryId: string;
  },
): Promise<void> {
  await database.transaction(async (transaction) => {
    const selectedSettings = await beginRelationshipMutation(
      transaction,
      input,
    );
    const settings =
      selectedSettings ??
      (await ensureRelationshipSettings(transaction, input));
    const [item] = await transaction
      .select({ id: memoryItem.id })
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.id, input.memoryId),
          eq(memoryItem.userId, input.userId),
          eq(memoryItem.characterId, input.characterId),
          eq(memoryItem.memoryEpoch, settings.memoryEpoch),
        ),
      )
      .for("update")
      .limit(1);
    if (!item) {
      throw notFound();
    }

    await transaction
      .select({ id: memoryEvidence.id })
      .from(memoryEvidence)
      .where(eq(memoryEvidence.memoryId, item.id))
      .orderBy(asc(memoryEvidence.id))
      .for("update");
    await transaction
      .delete(memoryEvidence)
      .where(eq(memoryEvidence.memoryId, item.id));
    await transaction.delete(memoryItem).where(eq(memoryItem.id, item.id));
    await transaction
      .update(userCharacterMemorySetting)
      .set({
        memoryRevision: settings.memoryRevision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userCharacterMemorySetting.userId, input.userId),
          eq(userCharacterMemorySetting.characterId, input.characterId),
        ),
      );
  });
}

export async function forgetCharacter(
  database: Database,
  input: {
    userId: string;
    characterId: string;
    expectedRevision: number;
  },
): Promise<{ memoryEpoch: number; revision: number }> {
  return database.transaction(async (transaction) => {
    const selectedSettings = await beginRelationshipMutation(
      transaction,
      input,
    );
    const settings =
      selectedSettings ??
      (await ensureRelationshipSettings(transaction, input));
    if (settings.revision !== input.expectedRevision) {
      throw revisionConflict({
        expectedRevision: input.expectedRevision,
        actualRevision: settings.revision,
      });
    }

    const now = new Date();
    const memoryEpoch = settings.memoryEpoch + 1;
    const revision = settings.revision + 1;
    await cancelRelationshipExtractions(transaction, input, now);
    await transaction
      .update(userCharacterMemorySetting)
      .set({
        memoryEpoch,
        memoryRevision: settings.memoryRevision + 1,
        revision,
        updatedAt: now,
      })
      .where(
        and(
          eq(userCharacterMemorySetting.userId, input.userId),
          eq(userCharacterMemorySetting.characterId, input.characterId),
          eq(userCharacterMemorySetting.revision, input.expectedRevision),
        ),
      );

    await transaction
      .select({ id: memoryExtractionRun.id })
      .from(memoryExtractionRun)
      .where(
        and(
          eq(memoryExtractionRun.userId, input.userId),
          eq(memoryExtractionRun.characterId, input.characterId),
          inArray(memoryExtractionRun.status, nonterminalOperationStatuses),
        ),
      )
      .orderBy(asc(memoryExtractionRun.id))
      .for("update");
    await transaction
      .select({ id: relationshipSummaryRun.id })
      .from(relationshipSummaryRun)
      .where(
        and(
          eq(relationshipSummaryRun.userId, input.userId),
          eq(relationshipSummaryRun.characterId, input.characterId),
          inArray(relationshipSummaryRun.status, nonterminalOperationStatuses),
        ),
      )
      .orderBy(asc(relationshipSummaryRun.id))
      .for("update");
    await transaction
      .update(memoryExtractionRun)
      .set({
        status: "cancelled",
        nextRetryAt: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(memoryExtractionRun.userId, input.userId),
          eq(memoryExtractionRun.characterId, input.characterId),
          inArray(memoryExtractionRun.status, nonterminalOperationStatuses),
        ),
      );
    await transaction
      .update(relationshipSummaryRun)
      .set({
        status: "cancelled",
        nextRetryAt: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(relationshipSummaryRun.userId, input.userId),
          eq(relationshipSummaryRun.characterId, input.characterId),
          inArray(relationshipSummaryRun.status, nonterminalOperationStatuses),
        ),
      );

    await transaction
      .select({ userId: relationshipSummary.userId })
      .from(relationshipSummary)
      .where(
        and(
          eq(relationshipSummary.userId, input.userId),
          eq(relationshipSummary.characterId, input.characterId),
        ),
      )
      .for("update");
    await transaction
      .select({ id: relationshipSummaryVersion.id })
      .from(relationshipSummaryVersion)
      .where(
        and(
          eq(relationshipSummaryVersion.userId, input.userId),
          eq(relationshipSummaryVersion.characterId, input.characterId),
        ),
      )
      .orderBy(asc(relationshipSummaryVersion.id))
      .for("update");
    const itemRows = await transaction
      .select({ id: memoryItem.id })
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.userId, input.userId),
          eq(memoryItem.characterId, input.characterId),
        ),
      )
      .orderBy(asc(memoryItem.id))
      .for("update");
    const itemIds = itemRows.map((item) => item.id);
    if (itemIds.length > 0) {
      await transaction
        .select({ id: memoryEvidence.id })
        .from(memoryEvidence)
        .where(inArray(memoryEvidence.memoryId, itemIds))
        .orderBy(asc(memoryEvidence.id))
        .for("update");
      await transaction
        .delete(memoryEvidence)
        .where(inArray(memoryEvidence.memoryId, itemIds));
      await transaction
        .delete(memoryItem)
        .where(inArray(memoryItem.id, itemIds));
    }
    await transaction
      .delete(relationshipSummary)
      .where(
        and(
          eq(relationshipSummary.userId, input.userId),
          eq(relationshipSummary.characterId, input.characterId),
        ),
      );
    await transaction
      .delete(relationshipSummaryVersion)
      .where(
        and(
          eq(relationshipSummaryVersion.userId, input.userId),
          eq(relationshipSummaryVersion.characterId, input.characterId),
        ),
      );

    await recordUserAudit(transaction, {
      userId: input.userId,
      action: "memory.character_forget",
      targetType: "character",
      targetId: input.characterId,
      metadata: { memoryEpoch, revision },
    });

    return { memoryEpoch, revision };
  });
}
