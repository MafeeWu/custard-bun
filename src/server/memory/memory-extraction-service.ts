import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import {
  lockUserCharacterChatMutation,
  type ChatTransaction,
} from "@/server/chat/chat-locks";
import type { Database } from "@/server/db/client";
import {
  conversation,
  conversationMessage,
  generationAttempt,
  memoryExtractionRun,
  memoryExtractionExecution,
  memorySettings,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import {
  MEMORY_EXTRACTION_DEAD_LETTER_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
} from "@/server/jobs/queues";
import { lockUserMemoryMutation } from "./memory-locks";
import { MemoryDomainError } from "./memory-errors";

export const EXTRACTION_MAX_EXECUTIONS = 5;
export const EXTRACTION_LEASE_MS = 5 * 60_000;

export interface MemoryExtractionJob {
  runId: string;
}

export async function captureExtractionAdmission(
  transaction: ChatTransaction,
  input: { userId: string; conversationId: string },
): Promise<number | null> {
  const [source] = await transaction
    .select({ characterId: conversation.characterId })
    .from(conversation)
    .where(
      and(
        eq(conversation.id, input.conversationId),
        eq(conversation.userId, input.userId),
      ),
    )
    .limit(1);
  if (!source) return null;
  const settings = await lockExtractionRelationship(transaction, {
    ...input,
    ...source,
  });
  const [global] = await transaction
    .select()
    .from(memorySettings)
    .where(eq(memorySettings.id, "global"));
  const [owner] = await transaction
    .select()
    .from(user)
    .where(eq(user.id, input.userId));
  return global?.enabled &&
    settings?.recordingEnabled &&
    owner &&
    !owner.banned &&
    !owner.deletionPendingAt
    ? settings.memoryEpoch
    : null;
}

export async function lockExtractionRelationship(
  transaction: ChatTransaction,
  input: { userId: string; characterId: string },
) {
  await lockUserMemoryMutation(transaction, input.userId);
  await lockUserCharacterChatMutation(
    transaction,
    input.userId,
    input.characterId,
  );
  const [owner] = await transaction
    .select()
    .from(user)
    .where(eq(user.id, input.userId))
    .for("update")
    .limit(1);
  if (!owner) return null;
  await transaction
    .insert(userCharacterMemorySetting)
    .values({
      userId: input.userId,
      characterId: input.characterId,
    })
    .onConflictDoNothing();
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

export async function readExtractionSource(
  transaction: ChatTransaction,
  input: {
    userId: string;
    characterId: string;
    conversationId: string | null;
    generationAttemptId: string | null;
    memoryEpoch?: number;
  },
) {
  if (!input.conversationId || !input.generationAttemptId) return null;
  const [global] = await transaction
    .select()
    .from(memorySettings)
    .where(eq(memorySettings.id, "global"))
    .limit(1);
  if (!global?.enabled) return null;
  const [owner] = await transaction
    .select({ banned: user.banned, deletionPendingAt: user.deletionPendingAt })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (!owner || owner.banned || owner.deletionPendingAt) return null;
  const [settings] = await transaction
    .select()
    .from(userCharacterMemorySetting)
    .where(
      and(
        eq(userCharacterMemorySetting.userId, input.userId),
        eq(userCharacterMemorySetting.characterId, input.characterId),
      ),
    )
    .limit(1);
  if (
    !settings?.recordingEnabled ||
    (input.memoryEpoch !== undefined &&
      settings.memoryEpoch !== input.memoryEpoch)
  )
    return null;
  const [source] = await transaction
    .select({
      conversationId: conversation.id,
      attemptId: generationAttempt.id,
      assistantContent: generationAttempt.content,
      sourceMessageId: conversationMessage.inReplyTo,
      modelId: generationAttempt.modelId,
    })
    .from(generationAttempt)
    .innerJoin(
      conversationMessage,
      eq(conversationMessage.id, generationAttempt.assistantMessageId),
    )
    .innerJoin(
      conversation,
      eq(conversation.id, conversationMessage.conversationId),
    )
    .where(
      and(
        eq(generationAttempt.id, input.generationAttemptId),
        eq(generationAttempt.userId, input.userId),
        eq(generationAttempt.isCurrent, true),
        eq(generationAttempt.status, "complete"),
        eq(generationAttempt.extractionMemoryEpoch, settings.memoryEpoch),
        sql`${generationAttempt.createdAt} >= ${global.createdAt}`,
        isNull(generationAttempt.cancelRequestedAt),
        eq(conversation.id, input.conversationId),
        eq(conversation.userId, input.userId),
        eq(conversation.characterId, input.characterId),
        eq(conversationMessage.role, "assistant"),
        eq(conversationMessage.kind, "generated"),
      ),
    )
    .limit(1);
  if (!source?.sourceMessageId) return null;
  const [message] = await transaction
    .select({
      content: conversationMessage.content,
      createdAt: conversationMessage.createdAt,
    })
    .from(conversationMessage)
    .where(
      and(
        eq(conversationMessage.id, source.sourceMessageId),
        eq(conversationMessage.conversationId, input.conversationId),
        eq(conversationMessage.role, "user"),
        eq(conversationMessage.kind, "user"),
      ),
    )
    .limit(1);
  if (!message?.content || !source.assistantContent.trim()) return null;
  return {
    ...source,
    sourceMessageId: source.sourceMessageId,
    userContent: message.content,
    observedAt: message.createdAt,
    memoryEpoch: settings.memoryEpoch,
  };
}

export async function createExtractionRunForCompletedAttempt(
  transaction: ChatTransaction,
  input: {
    attemptId: string;
    userId: string;
    characterId: string;
    conversationId: string;
    now: Date;
  },
): Promise<{ runId: string } | null> {
  if (!(await lockExtractionRelationship(transaction, input))) return null;
  const source = await readExtractionSource(transaction, {
    ...input,
    generationAttemptId: input.attemptId,
  });
  if (!source) return null;
  const [inserted] = await transaction
    .insert(memoryExtractionRun)
    .values({
      id: randomUUID(),
      userId: input.userId,
      characterId: input.characterId,
      conversationId: input.conversationId,
      generationAttemptId: input.attemptId,
      memoryEpoch: source.memoryEpoch,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ runId: memoryExtractionRun.id });
  if (inserted) return inserted;
  const [existing] = await transaction
    .select({ runId: memoryExtractionRun.id })
    .from(memoryExtractionRun)
    .where(eq(memoryExtractionRun.generationAttemptId, input.attemptId))
    .limit(1);
  return existing ?? null;
}

export async function enqueuePendingExtractionRuns(
  database: Database,
  boss: Pick<PgBoss, "send">,
  now: Date,
): Promise<number> {
  let sent = await publishExtractionDeadLetters(database, boss, now);
  const rows = await database
    .select()
    .from(memoryExtractionRun)
    .where(
      or(
        eq(memoryExtractionRun.status, "pending"),
        and(
          eq(memoryExtractionRun.status, "retrying"),
          or(
            isNull(memoryExtractionRun.nextRetryAt),
            lte(memoryExtractionRun.nextRetryAt, now),
          ),
        ),
        eq(memoryExtractionRun.status, "queued"),
        and(
          eq(memoryExtractionRun.status, "running"),
          lte(memoryExtractionRun.leaseExpiresAt, now),
        ),
        and(
          inArray(memoryExtractionRun.status, ["running", "cancelled"]),
          sql`EXISTS (
      SELECT 1 FROM ${memoryExtractionExecution}
      WHERE ${memoryExtractionExecution.runId} = ${memoryExtractionRun.id}
        AND ${memoryExtractionExecution.settledAt} IS NULL
        AND (${memoryExtractionExecution.responseAt} IS NOT NULL
          OR ${memoryExtractionRun.leaseExpiresAt} <= ${now})
    )`,
        ),
      ),
    )
    .orderBy(asc(memoryExtractionRun.createdAt), asc(memoryExtractionRun.id))
    .limit(50);
  for (const row of rows) {
    const jobId = await boss.send(
      MEMORY_EXTRACTION_QUEUE,
      { runId: row.id },
      {
        singletonKey: row.id,
        retryLimit: EXTRACTION_MAX_EXECUTIONS - 1,
        retryDelay: 60,
        retryBackoff: true,
        expireInSeconds: EXTRACTION_LEASE_MS / 1000,
      },
    );
    if (!jobId) continue;
    if (row.status !== "cancelled")
      await database.transaction(async (transaction) => {
        await lockUserMemoryMutation(transaction, row.userId);
        await transaction
          .update(memoryExtractionRun)
          .set({
            jobId,
            ...(row.status === "pending" || row.status === "queued"
              ? { status: "queued" as const }
              : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(memoryExtractionRun.id, row.id),
              eq(memoryExtractionRun.status, row.status),
            ),
          );
      });
    sent++;
  }
  return sent;
}

export async function publishExtractionDeadLetters(
  database: Database,
  boss: Pick<PgBoss, "send">,
  now: Date,
): Promise<number> {
  const rows = await database
    .select({ id: memoryExtractionRun.id })
    .from(memoryExtractionRun)
    .where(
      and(
        eq(memoryExtractionRun.status, "dead_letter"),
        isNull(memoryExtractionRun.deadLetterPublishedAt),
      ),
    )
    .orderBy(asc(memoryExtractionRun.createdAt), asc(memoryExtractionRun.id))
    .limit(50);
  let sent = 0;
  for (const row of rows) {
    const client = await database.$client.connect();
    try {
      await client.query("BEGIN");
      // Queue publication and its database receipt share one PostgreSQL transaction.
      const locked = await client.query(
        "SELECT id FROM memory_extraction_runs WHERE id = $1 AND status = 'dead_letter' AND dead_letter_published_at IS NULL FOR UPDATE",
        [row.id],
      );
      if (locked.rowCount) {
        const id = await boss.send(
          MEMORY_EXTRACTION_DEAD_LETTER_QUEUE,
          { runId: row.id },
          {
            id: row.id,
            singletonKey: row.id,
            db: { executeSql: (text, values) => client.query(text, values) },
          },
        );
        if (id) {
          await client.query(
            "UPDATE memory_extraction_runs SET dead_letter_published_at = $2 WHERE id = $1",
            [row.id, now],
          );
          sent++;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return sent;
}

export async function retryMemoryExtraction(
  database: Database,
  input: { userId: string; characterId: string; runId: string },
): Promise<void> {
  await database.transaction(async (transaction) => {
    await lockExtractionRelationship(transaction, input);
    const [run] = await transaction
      .select()
      .from(memoryExtractionRun)
      .where(
        and(
          eq(memoryExtractionRun.id, input.runId),
          eq(memoryExtractionRun.userId, input.userId),
          eq(memoryExtractionRun.characterId, input.characterId),
        ),
      )
      .for("update")
      .limit(1);
    if (!run)
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Extraction run not found.",
      );
    if (
      !["failed", "retrying", "dead_letter"].includes(run.status) ||
      run.attemptCount >= EXTRACTION_MAX_EXECUTIONS
    ) {
      throw new MemoryDomainError(
        "MEMORY_VALIDATION",
        "Extraction cannot be retried.",
      );
    }
    if (!(await readExtractionSource(transaction, run))) {
      throw new MemoryDomainError(
        "MEMORY_VALIDATION",
        "Extraction source is no longer eligible.",
      );
    }
    await transaction
      .update(memoryExtractionRun)
      .set({
        status: "pending",
        finishedAt: null,
        nextRetryAt: null,
        jobId: null,
        errorCategory: null,
        claimToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(memoryExtractionRun.id, run.id));
  });
}

export const extractionRunnableStatuses = [
  "pending",
  "queued",
  "retrying",
  "running",
] as const;

export async function cancelConversationExtractions(
  transaction: ChatTransaction,
  conversationId: string,
  now: Date,
) {
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
        eq(memoryExtractionRun.conversationId, conversationId),
        inArray(memoryExtractionRun.status, extractionRunnableStatuses),
      ),
    );
  await transaction.update(memoryExtractionExecution).set({ candidates: null })
    .where(sql`${memoryExtractionExecution.runId} IN (
      SELECT ${memoryExtractionRun.id} FROM ${memoryExtractionRun}
      WHERE ${memoryExtractionRun.conversationId} = ${conversationId}
    )`);
}

export async function cancelRelationshipExtractions(
  transaction: ChatTransaction,
  input: { userId: string; characterId?: string },
  now: Date,
) {
  const scope = and(
    eq(memoryExtractionRun.userId, input.userId),
    input.characterId
      ? eq(memoryExtractionRun.characterId, input.characterId)
      : undefined,
  );
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
        scope,
        inArray(memoryExtractionRun.status, extractionRunnableStatuses),
      ),
    );
  await transaction.update(memoryExtractionExecution).set({ candidates: null })
    .where(sql`${memoryExtractionExecution.runId} IN (
      SELECT ${memoryExtractionRun.id} FROM ${memoryExtractionRun} WHERE ${scope}
    )`);
}
