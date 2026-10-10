import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { ChatDomainError } from "@/server/chat/chat-errors";
import {
  lockGlobalChatMutation,
  lockUserChatMutation,
  type ChatTransaction,
} from "@/server/chat/chat-locks";
import {
  lockExistingQuotaBucket,
  lockInstanceQuotaBucket,
} from "@/server/chat/quota-service";
import type { Database } from "@/server/db/client";
import {
  backgroundModelReservation,
  chatSettings,
  quotaBucket,
  usageLedger,
} from "@/server/db/schema";
import { MemoryDomainError } from "./memory-errors";

type BackgroundWorkloadType = "memory_extraction" | "summary_refresh";
type BackgroundOutcome = "complete" | "failed" | "cancelled";

function requireNonnegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MemoryDomainError(
      "MEMORY_VALIDATION",
      `${field} must be a nonnegative safe integer.`,
      { metadata: { field } },
    );
  }
}

function instanceBucketId(periodStart: Date): string {
  return `instance:global:${periodStart.toISOString()}`;
}

function settlementConflict(): MemoryDomainError {
  return new MemoryDomainError(
    "MEMORY_INTERNAL",
    "Background model work has already been settled differently.",
    { retryable: false },
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function settlementFingerprint(input: {
  outcome: BackgroundOutcome;
  modelId: string;
  providerRequestIds: string[];
  consumedInputTokens: number;
  consumedOutputTokens: number;
  usageIsEstimated: boolean;
  latencyMs: number;
  errorCategory?: string;
}): string {
  if (!Array.isArray(input.providerRequestIds)) {
    throw new MemoryDomainError(
      "MEMORY_VALIDATION",
      "providerRequestIds must be an array.",
      { metadata: { field: "providerRequestIds" } },
    );
  }
  const providerIdentity = input.providerRequestIds.map((requestId, index) => {
    if (typeof requestId !== "string" || requestId.length > 1_024) {
      throw new MemoryDomainError(
        "MEMORY_VALIDATION",
        "providerRequestIds must contain bounded strings.",
        { metadata: { field: "providerRequestIds", index } },
      );
    }
    return digest(requestId);
  });

  return digest(
    JSON.stringify({
      version: 1,
      outcome: input.outcome,
      modelId: input.modelId,
      providerIdentity,
      consumedInputTokens: input.consumedInputTokens,
      consumedOutputTokens: input.consumedOutputTokens,
      usageIsEstimated: input.usageIsEstimated,
      latencyMs: input.latencyMs,
      errorCategory: input.errorCategory ?? null,
    }),
  );
}

export async function admitBackgroundModelWork(
  transaction: ChatTransaction,
  input: {
    userId: string;
    operationId: string;
    workloadType: BackgroundWorkloadType;
    estimatedTokens: number;
    now: Date;
  },
): Promise<{ reservationId: string }> {
  requireNonnegativeInteger(input.estimatedTokens, "estimatedTokens");
  await lockUserChatMutation(transaction, input.userId);

  const [settings] = await transaction
    .select({
      instanceMonthlyTokenBudget: chatSettings.instanceMonthlyTokenBudget,
    })
    .from(chatSettings)
    .where(eq(chatSettings.id, "global"))
    .limit(1);
  if (!settings) {
    throw new ChatDomainError(
      "CHAT_INTERNAL",
      "Chat settings are not initialized.",
    );
  }

  const bucket = await lockInstanceQuotaBucket(transaction, input.now);
  if (
    bucket.consumedTokens +
      bucket.reservedTokens +
      input.estimatedTokens >
    settings.instanceMonthlyTokenBudget
  ) {
    throw new ChatDomainError(
      "CHAT_INSTANCE_TOKEN_BUDGET",
      "Token quota exhausted.",
      { retryable: true, resetAt: bucket.periodEnd },
    );
  }

  const reservationId = randomUUID();
  await transaction
    .update(quotaBucket)
    .set({
      reservedTokens: sql`${quotaBucket.reservedTokens} + ${input.estimatedTokens}`,
      updatedAt: input.now,
    })
    .where(eq(quotaBucket.id, bucket.id));
  await transaction.insert(backgroundModelReservation).values({
    id: reservationId,
    operationId: input.operationId,
    workloadType: input.workloadType,
    periodStart: bucket.periodStart,
    periodEnd: bucket.periodEnd,
    reservedTokens: input.estimatedTokens,
    createdAt: input.now,
  });

  return { reservationId };
}

export async function settleBackgroundModelWork(
  database: Database,
  input: {
    operationId: string;
    outcome: BackgroundOutcome;
    modelId: string;
    providerRequestIds: string[];
    inputTokens?: number;
    outputTokens?: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    latencyMs: number;
    errorCategory?: string;
    now: Date;
  },
): Promise<void> {
  requireNonnegativeInteger(input.estimatedInputTokens, "estimatedInputTokens");
  requireNonnegativeInteger(
    input.estimatedOutputTokens,
    "estimatedOutputTokens",
  );
  requireNonnegativeInteger(input.latencyMs, "latencyMs");
  if (input.inputTokens !== undefined) {
    requireNonnegativeInteger(input.inputTokens, "inputTokens");
  }
  if (input.outputTokens !== undefined) {
    requireNonnegativeInteger(input.outputTokens, "outputTokens");
  }

  await database.transaction(async (transaction) => {
    await lockGlobalChatMutation(transaction);
    const [preview] = await transaction
      .select()
      .from(backgroundModelReservation)
      .where(eq(backgroundModelReservation.operationId, input.operationId))
      .limit(1);
    if (!preview) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Background model reservation was not found.",
      );
    }

    const bucket = await lockExistingQuotaBucket(
      transaction,
      instanceBucketId(preview.periodStart),
    );
    if (!bucket) {
      throw new MemoryDomainError(
        "MEMORY_INTERNAL",
        "Background model quota bucket is missing.",
      );
    }
    const [reservation] = await transaction
      .select()
      .from(backgroundModelReservation)
      .where(eq(backgroundModelReservation.id, preview.id))
      .for("update")
      .limit(1);
    if (!reservation) {
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Background model reservation was not found.",
      );
    }

    const usageIsEstimated =
      input.inputTokens === undefined || input.outputTokens === undefined;
    const consumedInputTokens =
      input.inputTokens ?? input.estimatedInputTokens;
    const consumedOutputTokens =
      input.outputTokens ?? input.estimatedOutputTokens;
    const fingerprint = settlementFingerprint({
      outcome: input.outcome,
      modelId: input.modelId,
      providerRequestIds: input.providerRequestIds,
      consumedInputTokens,
      consumedOutputTokens,
      usageIsEstimated,
      latencyMs: input.latencyMs,
      errorCategory: input.errorCategory,
    });
    const [existingLedger] = await transaction
      .select()
      .from(usageLedger)
      .where(eq(usageLedger.backgroundOperationId, input.operationId))
      .limit(1);

    if (reservation.settledAt) {
      if (
        existingLedger &&
        reservation.settlementFingerprint === fingerprint &&
        reservation.consumedInputTokens === consumedInputTokens &&
        reservation.consumedOutputTokens === consumedOutputTokens &&
        existingLedger.workloadType === reservation.workloadType &&
        existingLedger.inputTokens === consumedInputTokens &&
        existingLedger.outputTokens === consumedOutputTokens &&
        existingLedger.usageIsEstimated === usageIsEstimated &&
        existingLedger.modelId === input.modelId &&
        existingLedger.outcome === input.outcome &&
        existingLedger.errorCategory === (input.errorCategory ?? null) &&
        existingLedger.latencyMs === input.latencyMs
      ) {
        return;
      }
      throw settlementConflict();
    }
    if (existingLedger) {
      throw settlementConflict();
    }

    const consumedTokens = consumedInputTokens + consumedOutputTokens;
    await transaction
      .update(quotaBucket)
      .set({
        reservedTokens: sql`${quotaBucket.reservedTokens} - ${reservation.reservedTokens}`,
        consumedTokens: sql`${quotaBucket.consumedTokens} + ${consumedTokens}`,
        updatedAt: input.now,
      })
      .where(eq(quotaBucket.id, bucket.id));

    await transaction.insert(usageLedger).values({
      id: randomUUID(),
      backgroundOperationId: input.operationId,
      memoryExtractionRunId:
        reservation.workloadType === "memory_extraction"
          ? input.operationId
          : null,
      workloadType: reservation.workloadType,
      periodStart: reservation.periodStart,
      periodEnd: reservation.periodEnd,
      userRequestUnits: 0,
      providerCallNumber: 1,
      inputTokens: consumedInputTokens,
      outputTokens: consumedOutputTokens,
      usageIsEstimated,
      modelId: input.modelId,
      outcome: input.outcome,
      errorCategory: input.errorCategory ?? null,
      automaticRetryCount: 0,
      latencyMs: input.latencyMs,
      createdAt: input.now,
    });
    await transaction
      .update(backgroundModelReservation)
      .set({
        consumedInputTokens,
        consumedOutputTokens,
        settlementFingerprint: fingerprint,
        settledAt: input.now,
      })
      .where(eq(backgroundModelReservation.id, reservation.id));
  });
}
