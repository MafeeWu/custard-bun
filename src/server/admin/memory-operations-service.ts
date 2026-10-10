import "server-only";

import { and, eq } from "drizzle-orm";
import { recordAdminAudit } from "./audit";
import type { AdminActor } from "./admin-actor";
import { requireAdminWrite } from "./require-admin-write";
import { lockGlobalChatMutation } from "@/server/chat/chat-locks";
import type { Database } from "@/server/db/client";
import {
  accountDeletionRequest,
  adminAuditEvent,
  dataExportJob,
  memoryExtractionRun,
  relationshipSummaryRun,
} from "@/server/db/schema";
import { retryMemoryExtraction } from "@/server/memory/memory-extraction-service";
import { retrySummaryRefresh } from "@/server/memory/relationship-summary-service";
import { retryDataExport } from "@/server/privacy/data-export-service";
import { retryAccountPurge } from "@/server/privacy/account-purge-job";
import { validOperationId, type MemoryOperationType } from "./memory-operations-queries";

export class MemoryOperationAdminError extends Error {
  constructor(readonly code: "RETRY_UNAVAILABLE") {
    super("This operation cannot be retried. Refresh the dashboard.");
    this.name = "MemoryOperationAdminError";
  }
}

export async function retryDeadLetterOperation(
  database: Database,
  actor: AdminActor,
  input: { operationType: MemoryOperationType; operationId: string },
): Promise<void> {
  const unavailable = () => new MemoryOperationAdminError("RETRY_UNAVAILABLE");
  if (!["memory_extraction", "summary_refresh", "data_export", "account_purge"].includes(input.operationType) ||
      typeof input.operationId !== "string" || !validOperationId(input.operationId))
    throw unavailable();

  await database.transaction(async (tx) => {
    await lockGlobalChatMutation(tx);
    await requireAdminWrite(tx, actor);
    // A repeated activation from the same action is a no-op; a new action still
    // requires a terminal operation. The global lock serializes both decisions.
    const [priorAudit] = await tx.select({ id: adminAuditEvent.id })
      .from(adminAuditEvent).where(and(
        eq(adminAuditEvent.actorUserId, actor.userId),
        eq(adminAuditEvent.operationId, actor.operationId),
        eq(adminAuditEvent.action, "memory.operation.retry"),
        eq(adminAuditEvent.targetId, input.operationId),
        eq(adminAuditEvent.targetType, input.operationType),
      )).limit(1);
    if (priorAudit) return;

    let scope: { userId: string; characterId?: string } | undefined;
    let status: string | undefined;
    switch (input.operationType) {
      case "memory_extraction": {
        const [run] = await tx.select({
          userId: memoryExtractionRun.userId, characterId: memoryExtractionRun.characterId,
          status: memoryExtractionRun.status,
        }).from(memoryExtractionRun).where(eq(memoryExtractionRun.id, input.operationId)).limit(1);
        scope = run; status = run?.status;
        if (status !== "failed" && status !== "dead_letter") throw unavailable();
        break;
      }
      case "summary_refresh": {
        const [run] = await tx.select({
          userId: relationshipSummaryRun.userId, characterId: relationshipSummaryRun.characterId,
          status: relationshipSummaryRun.status,
        }).from(relationshipSummaryRun).where(eq(relationshipSummaryRun.id, input.operationId)).limit(1);
        scope = run; status = run?.status;
        if (status !== "failed" && status !== "dead_letter") throw unavailable();
        break;
      }
      case "data_export": {
        const [job] = await tx.select({ userId: dataExportJob.userId, status: dataExportJob.status })
          .from(dataExportJob).where(eq(dataExportJob.id, input.operationId)).limit(1);
        scope = job; status = job?.status;
        if (status !== "failed") throw unavailable();
        break;
      }
      case "account_purge": {
        const [request] = await tx.select({ status: accountDeletionRequest.status })
          .from(accountDeletionRequest).where(eq(accountDeletionRequest.id, input.operationId)).limit(1);
        status = request?.status;
        if (status !== "dead_letter") throw unavailable();
        break;
      }
    }
    try {
      // Owning services perform the user/epoch/relationship checks and the
      // transition under their canonical locks; no content enters this service.
      const ownerDatabase = tx as unknown as Database;
      switch (input.operationType) {
        case "memory_extraction":
          await retryMemoryExtraction(ownerDatabase, {
            userId: scope!.userId, characterId: scope!.characterId!, runId: input.operationId,
            administrativeRetry: true,
          });
          break;
        case "summary_refresh":
          await retrySummaryRefresh(ownerDatabase, {
            userId: scope!.userId, characterId: scope!.characterId!, operationId: input.operationId,
            administrativeRetry: true,
          });
          break;
        case "data_export":
          await retryDataExport(ownerDatabase, {
            userId: scope!.userId, exportId: input.operationId, now: new Date(),
          });
          break;
        case "account_purge":
          await retryAccountPurge(ownerDatabase, input.operationId, new Date());
          break;
      }
    } catch {
      throw unavailable();
    }
    await recordAdminAudit(tx, { ...actor, label: "administrator" }, {
      action: "memory.operation.retry",
      targetType: input.operationType,
      targetId: input.operationId,
      metadata: {
        operationType: input.operationType,
        operationId: input.operationId,
        previousState: status!,
        nextState: input.operationType === "account_purge" ? "purging" : "pending",
      },
    });
  });
}
