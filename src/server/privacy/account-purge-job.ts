import "server-only";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { Database } from "@/server/db/client";
import {
  lockGlobalChatMutation,
  lockUserChatMutation,
  type ChatTransaction,
} from "@/server/chat/chat-locks";
import { settleUserGenerationsBeforeDeletion } from "@/server/chat/quota-service";
import { settleUserExtractionWorkBeforeDeletion } from "@/server/memory/background-usage-service";
import {
  account,
  accountDeletionRequest,
  adminAuditEvent,
  conversation,
  dataExportJob,
  memoryEvidence,
  memoryExtractionRun,
  memoryItem,
  relationshipSummary,
  relationshipSummaryRun,
  relationshipSummaryVersion,
  session,
  usageLedger,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import {
  ACCOUNT_PURGE_QUEUE,
  ACCOUNT_PURGE_DEAD_LETTER_QUEUE,
} from "@/server/jobs/queues";

const STAGES = [
  "settle",
  "exports",
  "memory",
  "conversations",
  "audit",
  "auth",
] as const;
const MAX_FAILURES = 5;
export interface AccountPurgeQueueJob {
  requestId: string;
}
const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

async function requestPreview(database: Database, requestId: string) {
  const [preview] = await database
    .select({ userId: accountDeletionRequest.userId })
    .from(accountDeletionRequest)
    .where(eq(accountDeletionRequest.id, requestId))
    .catch(() => {
      throw new Error("PURGE_STATE_UNAVAILABLE");
    });
  return preview;
}

async function lockRequest(
  tx: ChatTransaction,
  requestId: string,
  userId: string | null,
) {
  if (userId) await lockUserChatMutation(tx, userId);
  else await lockGlobalChatMutation(tx);
  const [request] = await tx
    .select()
    .from(accountDeletionRequest)
    .where(eq(accountDeletionRequest.id, requestId))
    .for("update");
  return request;
}
async function queuePresent(tx: ChatTransaction) {
  const result = await tx.execute<{ present: boolean }>(
    sql`SELECT to_regclass('job.job') IS NOT NULL AS present`,
  );

  return result.rows[0]?.present;
}
async function removePrivateQueueJobs(
  tx: ChatTransaction,
  userId: string,
  stage: "exports" | "memory" | "auth",
) {
  if (!(await queuePresent(tx))) return;
  if (stage === "exports")
    await tx.execute(sql`DELETE FROM job.job WHERE name IN ('data-export', 'data-export-dead-letter')
    AND data->>'exportId' IN (SELECT id FROM data_export_jobs WHERE user_id = ${userId})`);
  if (stage === "memory")
    await tx.execute(sql`DELETE FROM job.job WHERE name IN ('memory-extraction', 'memory-extraction-dead-letter', 'relationship-summary', 'relationship-summary-dead-letter')
    AND (data->>'runId' IN (SELECT id FROM memory_extraction_runs WHERE user_id = ${userId})
      OR data->>'operationId' IN (SELECT id FROM relationship_summary_runs WHERE user_id = ${userId}))`);
  if (stage === "auth")
    await tx.execute(sql`DELETE FROM job.job WHERE name IN ('auth-email', 'auth-email-dead-letter')
    AND data->>'to' = (SELECT email FROM "user" WHERE id = ${userId})`);
}
async function deidentifyAudit(tx: ChatTransaction, userId: string) {
  await tx.update(adminAuditEvent).set({
    actorUserId: null,
    actorLabel: "deleted",
    targetId: "deleted",
    metadata: {},
    operationId: "deleted",
  }).where(sql`${adminAuditEvent.actorUserId} = ${userId}
    OR ${adminAuditEvent.targetId} = ${userId}
    OR strpos(${adminAuditEvent.metadata}::text, ${userId}) > 0
    OR strpos(${adminAuditEvent.metadata}::text, (SELECT email FROM "user" WHERE id = ${userId})) > 0
    OR ${adminAuditEvent.actorLabel} = (SELECT email FROM "user" WHERE id = ${userId})`);
}
async function purgeStage(
  tx: ChatTransaction,
  userId: string,
  stage: (typeof STAGES)[number],
  now: Date,
) {
  switch (stage) {
    case "settle":
      await settleUserGenerationsBeforeDeletion(tx, userId, now);
      await settleUserExtractionWorkBeforeDeletion(tx, { userId, now });
      return;
    case "exports":
      await removePrivateQueueJobs(tx, userId, stage);
      await tx.delete(dataExportJob).where(eq(dataExportJob.userId, userId));
      return;
    case "memory":
      await removePrivateQueueJobs(tx, userId, stage);
      // Background usage has no user FK. De-identify via executions BEFORE deleting their owner graph.
      await tx.execute(sql`UPDATE usage_ledger SET background_operation_id = NULL,
        memory_extraction_run_id = NULL, relationship_summary_version_id = NULL
        WHERE background_operation_id IN (
          SELECT e.id FROM memory_extraction_executions e JOIN memory_extraction_runs r ON r.id = e.run_id WHERE r.user_id = ${userId}
          UNION ALL
          SELECT e.id FROM relationship_summary_executions e JOIN relationship_summary_runs r ON r.id = e.run_id WHERE r.user_id = ${userId}
        ) OR memory_extraction_run_id IN (SELECT id FROM memory_extraction_runs WHERE user_id = ${userId})
        OR relationship_summary_version_id IN (SELECT id FROM relationship_summary_versions WHERE user_id = ${userId})`);
      await tx.execute(sql`DELETE FROM background_model_reservations WHERE operation_id IN (
        SELECT e.id FROM memory_extraction_executions e JOIN memory_extraction_runs r ON r.id = e.run_id WHERE r.user_id = ${userId}
        UNION ALL
        SELECT e.id FROM relationship_summary_executions e JOIN relationship_summary_runs r ON r.id = e.run_id WHERE r.user_id = ${userId}
      )`);
      await tx
        .delete(relationshipSummary)
        .where(eq(relationshipSummary.userId, userId));
      await tx
        .delete(relationshipSummaryVersion)
        .where(eq(relationshipSummaryVersion.userId, userId));
      await tx
        .delete(relationshipSummaryRun)
        .where(eq(relationshipSummaryRun.userId, userId));
      await tx
        .delete(memoryEvidence)
        .where(
          sql`${memoryEvidence.memoryId} IN (SELECT id FROM memory_items WHERE user_id = ${userId})`,
        );
      await tx.delete(memoryItem).where(eq(memoryItem.userId, userId));
      await tx
        .delete(memoryExtractionRun)
        .where(eq(memoryExtractionRun.userId, userId));
      await tx
        .delete(userCharacterMemorySetting)
        .where(eq(userCharacterMemorySetting.userId, userId));
      return;
    case "conversations":
      await tx
        .update(usageLedger)
        .set({
          userId: null,
          conversationId: null,
          attemptId: null,
          backgroundOperationId: null,
          memoryExtractionRunId: null,
          relationshipSummaryVersionId: null,
        })
        .where(eq(usageLedger.userId, userId));
      await tx.delete(conversation).where(eq(conversation.userId, userId));
      return;
    case "audit":
      await deidentifyAudit(tx, userId);
      return;
    case "auth":
      await deidentifyAudit(tx, userId);
      await removePrivateQueueJobs(tx, userId, stage);
      await tx.execute(sql`DELETE FROM verification WHERE strpos(identifier, ${userId}) > 0 OR strpos(value, ${userId}) > 0
        OR strpos(identifier, (SELECT email FROM "user" WHERE id = ${userId})) > 0
        OR strpos(value, (SELECT email FROM "user" WHERE id = ${userId})) > 0`);
      await tx.execute(sql`DELETE FROM rate_limit WHERE strpos(key, ${userId}) > 0
        OR strpos(key, (SELECT email FROM "user" WHERE id = ${userId})) > 0`);
      await tx
        .delete(session)
        .where(
          or(eq(session.userId, userId), eq(session.impersonatedBy, userId)),
        );
      await tx.delete(account).where(eq(account.userId, userId));
      return;
  }
}

export async function processAccountPurgeStage(
  database: Database,
  requestId: string,
  now: Date,
): Promise<"continue" | "complete"> {
  if (!validId(requestId)) throw new Error("PURGE_REQUEST_INVALID");
  const preview = await requestPreview(database, requestId);
  if (!preview) throw new Error("PURGE_REQUEST_INVALID");
  let attemptedStage: string | undefined;
  try {
    return await database.transaction(async (tx) => {
      const request = await lockRequest(tx, requestId, preview.userId);
      if (!request) throw new Error("PURGE_REQUEST_INVALID");
      if (request.status === "complete") return "complete";
      if (!request.userId || !["locked", "purging"].includes(request.status))
        throw new Error("PURGE_NOT_READY");
      const index = STAGES.indexOf(
        request.currentStage as (typeof STAGES)[number],
      );
      if (index < 0) throw new Error("PURGE_STAGE_INVALID");
      attemptedStage = request.currentStage;
      await purgeStage(tx, request.userId, STAGES[index], now);
      if (STAGES[index] === "auth") {
        // Null the FK and complete the content-free tombstone BEFORE deleting auth,
        // in the SAME transaction. An unfinished request cannot survive a user cascade.
        await tx
          .update(accountDeletionRequest)
          .set({
            userId: null,
            status: "complete",
            currentStage: "complete",
            completedAt: now,
            jobId: null,
            errorCategory: null,
            updatedAt: now,
          })
          .where(eq(accountDeletionRequest.id, requestId));
        await tx.delete(user).where(eq(user.id, request.userId));
        return "complete";
      }
      await tx
        .update(accountDeletionRequest)
        .set({
          status: "purging",
          currentStage: STAGES[index + 1],
          attemptCount: 0,
          errorCategory: null,
          updatedAt: now,
        })
        .where(eq(accountDeletionRequest.id, requestId));
      return "continue";
    });
  } catch {
    // Never retain the thrown SQL/provider/body. Failure state is DB-authoritative.
    await database
      .transaction(async (tx) => {
        const request = await lockRequest(tx, requestId, preview.userId);
        if (
          !request ||
          !["locked", "purging"].includes(request.status) ||
          request.currentStage !== attemptedStage
        )
          return;
        const attempts = request.attemptCount + 1;
        await tx
          .update(accountDeletionRequest)
          .set({
            attemptCount: attempts,
            status: attempts >= MAX_FAILURES ? "dead_letter" : "purging",
            errorCategory: "PURGE_STAGE_FAILED",
            updatedAt: now,
          })
          .where(eq(accountDeletionRequest.id, requestId));
      })
      .catch(() => undefined);
    throw new Error("PURGE_STAGE_FAILED");
  }
}

export async function getAccountPurgeState(
  database: Database,
  requestId?: string,
) {
  if (requestId && !validId(requestId)) return null;
  const rows = await database
    .select({
      requestId: accountDeletionRequest.id,
      stage: accountDeletionRequest.currentStage,
      status: accountDeletionRequest.status,
      errorCategory: accountDeletionRequest.errorCategory,
      attemptCount: accountDeletionRequest.attemptCount,
      updatedAt: accountDeletionRequest.updatedAt,
    })
    .from(accountDeletionRequest)
    .where(
      requestId
        ? eq(accountDeletionRequest.id, requestId)
        : inArray(accountDeletionRequest.status, [
            "locked",
            "purging",
            "dead_letter",
          ]),
    )
    .orderBy(asc(accountDeletionRequest.lockedAt))
    .limit(1)
    .catch(() => {
      throw new Error("PURGE_STATE_UNAVAILABLE");
    });
  const state = rows[0];
  if (!state || !validId(state.requestId)) return null;
  return {
    ...state,
    stage: [...STAGES, "complete"].includes(state.stage)
      ? state.stage
      : "unknown",
    errorCategory: state.errorCategory ? "PURGE_STAGE_FAILED" : null,
  };
}
export async function retryAccountPurge(
  database: Database,
  requestId: string,
  now: Date,
) {
  if (!validId(requestId)) throw new Error("PURGE_REQUEST_INVALID");
  const preview = await requestPreview(database, requestId);
  if (!preview) throw new Error("PURGE_REQUEST_INVALID");
  await database
    .transaction(async (tx) => {
      const request = await lockRequest(tx, requestId, preview.userId);
      if (request?.status !== "dead_letter") return;
      await tx
        .update(accountDeletionRequest)
        .set({
          status: "purging",
          attemptCount: 0,
          errorCategory: null,
          jobId: null,
          updatedAt: now,
        })
        .where(eq(accountDeletionRequest.id, requestId));
    })
    .catch(() => {
      throw new Error("PURGE_STATE_UNAVAILABLE");
    });
}

export async function enqueuePendingAccountPurges(
  database: Database,
  boss: Pick<PgBoss, "send">,
  now: Date,
) {
  const runnable = await database
    .select({
      requestId: accountDeletionRequest.id,
      status: accountDeletionRequest.status,
    })
    .from(accountDeletionRequest)
    .where(inArray(accountDeletionRequest.status, ["locked", "purging"]))
    .orderBy(asc(accountDeletionRequest.lockedAt))
    .limit(50);
  const deadLetters = await database
    .select({ requestId: accountDeletionRequest.id })
    .from(accountDeletionRequest)
    .where(
      and(
        eq(accountDeletionRequest.status, "dead_letter"),
        sql`${accountDeletionRequest.jobId} IS DISTINCT FROM ${accountDeletionRequest.id}`,
      ),
    )
    .orderBy(asc(accountDeletionRequest.lockedAt))
    .limit(50);
  let sent = 0;
  for (const row of [...runnable, ...deadLetters]) {
    const client = await database.$client.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ status: string }>(
        "SELECT status FROM account_deletion_requests WHERE id = $1 AND status IN ('locked', 'purging', 'dead_letter') FOR UPDATE",
        [row.requestId],
      );
      if (locked.rowCount) {
        const dead = locked.rows[0].status === "dead_letter";
        const id = await boss.send(
          dead ? ACCOUNT_PURGE_DEAD_LETTER_QUEUE : ACCOUNT_PURGE_QUEUE,
          { requestId: row.requestId },
          {
            singletonKey: row.requestId,
            ...(dead ? { id: row.requestId } : {}),
            priority: 100,
            db: { executeSql: (text, values) => client.query(text, values) },
          },
        );
        if (id) {
          await client.query(
            "UPDATE account_deletion_requests SET job_id = $2 WHERE id = $1",
            [row.requestId, id],
          );
          if (!dead) sent++;
        } else if (dead) {
          // The fixed dead-letter job ID already exists from an earlier attempt.
          await client.query(
            "UPDATE account_deletion_requests SET job_id = id WHERE id = $1",
            [row.requestId],
          );
        }
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
      throw new Error("PURGE_QUEUE_FAILED");
    } finally {
      client.release();
    }
  }
  void now;
  return sent;
}

export async function registerAccountPurgeWorker(
  database: Database,
  boss: PgBoss,
  logger: {
    error(
      message: string,
      metadata: { requestId?: string; status: string },
    ): void;
  },
) {
  await boss.work<AccountPurgeQueueJob>(ACCOUNT_PURGE_QUEUE, async ([job]) => {
    const requestId = job.data?.requestId;
    if (!validId(requestId)) throw new Error("PURGE_REQUEST_INVALID");
    try {
      while (
        (await processAccountPurgeStage(database, requestId, new Date())) ===
        "continue"
      ) {}
    } catch {
      logger.error("account purge failed", { requestId, status: "failed" });
      throw new Error("PURGE_STAGE_FAILED");
    } finally {
      await enqueuePendingAccountPurges(database, boss, new Date());
    }
  });
  let pending: Promise<unknown> | undefined;
  const reconcile = () =>
    (pending ??= enqueuePendingAccountPurges(database, boss, new Date())
      .catch(() =>
        logger.error("account purge reconciliation failed", {
          status: "failed",
        }),
      )
      .finally(() => {
        pending = undefined;
      }));
  await reconcile();
  const timer = setInterval(() => {
    void reconcile();
  }, 30_000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
