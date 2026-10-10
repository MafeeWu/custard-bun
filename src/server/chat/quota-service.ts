import "server-only";

import { randomUUID } from "node:crypto";
import {
  createExtractionRunForCompletedAttempt,
  lockExtractionRelationship,
} from "@/server/memory/memory-extraction-service";
import { settleUserExtractionWorkBeforeDeletion } from "@/server/memory/background-usage-service";
import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import {
  chatSettings,
  conversation,
  conversationMessage,
  generationAttempt,
  generationLease,
  quotaBucket,
  quotaReservation,
  usageLedger,
  user,
  userChatQuotaOverride,
} from "@/server/db/schema";
import { ChatDomainError } from "./chat-errors";
import { lockUserChatMutation, type ChatTransaction } from "./chat-locks";
import { createTokenCounter } from "./token-counter";

const GENERATION_LEASE_DURATION_MS = 5 * 60_000;

interface LimitSettings {
  userDailyRequestLimit: number;
  userDailyTokenLimit: number;
  instanceMonthlyRequestLimit: number;
  instanceMonthlyTokenBudget: number;
  maxConcurrentGenerations: number;
}

interface UserLimitOverride {
  dailyRequestLimit: number | null;
  dailyTokenLimit: number | null;
}

export interface EffectiveGenerationLimits {
  userDailyRequests: number;
  userDailyTokens: number;
  instanceMonthlyRequests: number;
  instanceMonthlyTokens: number;
  maxConcurrentGenerations: number;
}

export interface GenerationAdmission {
  attemptId: string;
  reservationId: string;
  leaseOwner: string;
  effectiveLimits: {
    userDailyRequests: number;
    userDailyTokens: number;
    instanceMonthlyRequests: number;
    instanceMonthlyTokens: number;
  };
}

export interface ProviderCallSettlement {
  callNumber: number;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  errorCategory?: string | null;
  automaticRetryCount?: number;
  latencyMs?: number | null;
}

export interface GenerationSettlement {
  attemptId: string;
  leaseOwner: string;
  outcome: "complete" | "failed" | "interrupted";
  now: Date;
  providerCalls: ProviderCallSettlement[];
  cancellationSignal?: AbortSignal;
  errorCategory?: string | null;
  retryable?: boolean | null;
}

export type GenerationSettlementOutcome = GenerationSettlement["outcome"];

interface Period {
  start: Date;
  end: Date;
}

export interface LockedBucket {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  consumedRequests: number;
  reservedRequests: number;
  consumedTokens: number;
  reservedTokens: number;
}

interface SettlementCall {
  callNumber: number;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  errorCategory: string | null;
  automaticRetryCount: number;
  latencyMs: number | null;
}

interface SettlementRequirements {
  leaseExpiredAtOrBefore?: Date;
}

interface ConversationRecoveryScope {
  userId: string;
  conversationId: string;
}

function expiredLeaseQuery(
  executor: Database | ChatTransaction,
  now: Date,
  scope?: ConversationRecoveryScope,
) {
  return executor
    .select({
      attemptId: generationLease.attemptId,
      ownerToken: generationLease.ownerToken,
    })
    .from(generationLease)
    .innerJoin(
      generationAttempt,
      eq(generationAttempt.id, generationLease.attemptId),
    )
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
        lte(generationLease.expiresAt, now),
        ...(scope
          ? [
              eq(generationLease.userId, scope.userId),
              eq(conversation.userId, scope.userId),
              eq(conversation.id, scope.conversationId),
            ]
          : []),
      ),
    );
}

export function userPeriod(now: Date): Period {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return {
    start,
    end: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    ),
  };
}

export function instancePeriod(now: Date): Period {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    start,
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export function resolveEffectiveLimits(
  settings: LimitSettings,
  override?: UserLimitOverride,
): EffectiveGenerationLimits {
  return {
    userDailyRequests:
      override?.dailyRequestLimit ?? settings.userDailyRequestLimit,
    userDailyTokens: override?.dailyTokenLimit ?? settings.userDailyTokenLimit,
    instanceMonthlyRequests: settings.instanceMonthlyRequestLimit,
    instanceMonthlyTokens: settings.instanceMonthlyTokenBudget,
    maxConcurrentGenerations: settings.maxConcurrentGenerations,
  };
}

function bucketId(
  scope: "user" | "instance",
  periodStart: Date,
  userId?: string,
) {
  return `${scope}:${userId ?? "global"}:${periodStart.toISOString()}`;
}

async function lockBucket(
  transaction: ChatTransaction,
  input: {
    scope: "user" | "instance";
    userId?: string;
    period: Period;
  },
): Promise<LockedBucket> {
  const id = bucketId(input.scope, input.period.start, input.userId);
  await transaction
    .insert(quotaBucket)
    .values({
      id,
      scope: input.scope,
      userId: input.userId,
      periodStart: input.period.start,
      periodEnd: input.period.end,
    })
    .onConflictDoNothing();

  const identity =
    input.scope === "user"
      ? and(
          eq(quotaBucket.scope, "user"),
          eq(quotaBucket.userId, input.userId!),
          eq(quotaBucket.periodStart, input.period.start),
        )
      : and(
          eq(quotaBucket.scope, "instance"),
          isNull(quotaBucket.userId),
          eq(quotaBucket.periodStart, input.period.start),
        );
  const [bucket] = await transaction
    .select({
      id: quotaBucket.id,
      periodStart: quotaBucket.periodStart,
      periodEnd: quotaBucket.periodEnd,
      consumedRequests: quotaBucket.consumedRequests,
      reservedRequests: quotaBucket.reservedRequests,
      consumedTokens: quotaBucket.consumedTokens,
      reservedTokens: quotaBucket.reservedTokens,
    })
    .from(quotaBucket)
    .where(identity)
    .for("update")
    .limit(1);

  if (!bucket) {
    throw new ChatDomainError("CHAT_INTERNAL", "Quota bucket was not created.");
  }
  return bucket;
}

async function lockExistingBucket(
  transaction: ChatTransaction,
  id: string,
): Promise<LockedBucket | undefined> {
  const [bucket] = await transaction
    .select({
      id: quotaBucket.id,
      periodStart: quotaBucket.periodStart,
      periodEnd: quotaBucket.periodEnd,
      consumedRequests: quotaBucket.consumedRequests,
      reservedRequests: quotaBucket.reservedRequests,
      consumedTokens: quotaBucket.consumedTokens,
      reservedTokens: quotaBucket.reservedTokens,
    })
    .from(quotaBucket)
    .where(eq(quotaBucket.id, id))
    .for("update")
    .limit(1);
  return bucket;
}

export async function lockInstanceQuotaBucket(
  transaction: ChatTransaction,
  now: Date,
): Promise<LockedBucket> {
  return lockBucket(transaction, {
    scope: "instance",
    period: instancePeriod(now),
  });
}

export async function lockExistingQuotaBucket(
  transaction: ChatTransaction,
  id: string,
): Promise<LockedBucket | undefined> {
  return lockExistingBucket(transaction, id);
}

function requireCapacity(
  bucket: LockedBucket,
  limits: { requests: number; tokens: number },
  reservedTokens: number,
  codes: {
    requests: "CHAT_USER_REQUEST_QUOTA" | "CHAT_INSTANCE_REQUEST_BUDGET";
    tokens: "CHAT_USER_TOKEN_QUOTA" | "CHAT_INSTANCE_TOKEN_BUDGET";
  },
) {
  if (bucket.consumedRequests + bucket.reservedRequests + 1 > limits.requests) {
    throw new ChatDomainError(codes.requests, "Request quota exhausted.", {
      retryable: true,
      resetAt: bucket.periodEnd,
    });
  }
  if (
    bucket.consumedTokens + bucket.reservedTokens + reservedTokens >
    limits.tokens
  ) {
    throw new ChatDomainError(codes.tokens, "Token quota exhausted.", {
      retryable: true,
      resetAt: bucket.periodEnd,
    });
  }
}

function normalizeSettlementCalls(
  providerCalls: ProviderCallSettlement[],
  fallback: {
    modelId: string;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
  },
): SettlementCall[] {
  const calls =
    providerCalls.length > 0
      ? providerCalls
      : [
          {
            callNumber: 1,
            modelId: fallback.modelId,
            estimatedInputTokens: fallback.estimatedInputTokens,
            estimatedOutputTokens: fallback.estimatedOutputTokens,
          },
        ];

  return calls.map((call) => {
    const estimated =
      call.inputTokens === undefined || call.outputTokens === undefined;
    return {
      callNumber: call.callNumber,
      modelId: call.modelId,
      inputTokens: call.inputTokens ?? call.estimatedInputTokens,
      outputTokens: call.outputTokens ?? call.estimatedOutputTokens,
      estimated,
      errorCategory: call.errorCategory ?? null,
      automaticRetryCount: call.automaticRetryCount ?? 0,
      latencyMs: call.latencyMs ?? null,
    };
  });
}

async function settleLockedGeneration(
  transaction: ChatTransaction,
  input: GenerationSettlement,
  knownReservation?: typeof quotaReservation.$inferSelect,
  requirements?: SettlementRequirements,
): Promise<GenerationSettlementOutcome | undefined> {
  const reservationPreview = (
    await transaction
      .select()
      .from(quotaReservation)
      .where(
        knownReservation
          ? eq(quotaReservation.id, knownReservation.id)
          : eq(quotaReservation.attemptId, input.attemptId),
      )
      .limit(1)
  )[0];
  if (!reservationPreview || reservationPreview.status !== "active") {
    return undefined;
  }

  const [sourceConversation] =
    input.outcome === "complete"
      ? await transaction
          .select({
            id: conversation.id,
            characterId: conversation.characterId,
          })
          .from(conversation)
          .where(
            and(
              eq(conversation.id, reservationPreview.conversationId),
              eq(conversation.userId, reservationPreview.userId),
            ),
          )
          .limit(1)
      : [];
  if (sourceConversation) {
    await lockExtractionRelationship(transaction, {
      userId: reservationPreview.userId,
      characterId: sourceConversation.characterId,
    });
  }

  const instanceBucket = await lockExistingBucket(
    transaction,
    reservationPreview.instanceBucketId,
  );
  const userBucket = await lockExistingBucket(
    transaction,
    reservationPreview.userBucketId,
  );
  if (!instanceBucket || !userBucket) {
    throw new ChatDomainError("CHAT_INTERNAL", "Quota bucket is missing.");
  }

  const [reservation] = await transaction
    .select()
    .from(quotaReservation)
    .where(eq(quotaReservation.id, reservationPreview.id))
    .for("update")
    .limit(1);
  if (!reservation || reservation.status !== "active") {
    return undefined;
  }

  const [attempt] = await transaction
    .select()
    .from(generationAttempt)
    .where(eq(generationAttempt.id, input.attemptId))
    .for("update")
    .limit(1);
  if (!attempt) {
    return undefined;
  }

  const [lease] = await transaction
    .select()
    .from(generationLease)
    .where(eq(generationLease.attemptId, input.attemptId))
    .for("update")
    .limit(1);
  if (requirements?.leaseExpiredAtOrBefore) {
    if (
      !lease ||
      lease.ownerToken !== input.leaseOwner ||
      lease.expiresAt > requirements.leaseExpiredAtOrBefore
    ) {
      return undefined;
    }
  } else if (lease && lease.ownerToken !== input.leaseOwner) {
    throw new ChatDomainError(
      "CHAT_INTERNAL",
      "Generation lease owner does not match.",
    );
  }
  if (
    attempt.status === "complete" ||
    attempt.status === "failed" ||
    attempt.status === "interrupted"
  ) {
    return attempt.status;
  }
  const signalAborted = input.cancellationSignal?.aborted ?? false;
  const cancellationRequested =
    Boolean(attempt.cancelRequestedAt) || signalAborted;
  if (signalAborted && !attempt.cancelRequestedAt) {
    await transaction
      .update(generationAttempt)
      .set({ cancelRequestedAt: input.now, updatedAt: input.now })
      .where(eq(generationAttempt.id, input.attemptId));
  }
  const committedOutcome =
    cancellationRequested && input.outcome !== "interrupted"
      ? "interrupted"
      : input.outcome;
  if (
    input.outcome === "complete" &&
    (!lease || lease.ownerToken !== input.leaseOwner)
  ) {
    return undefined;
  }
  const committedErrorCategory =
    committedOutcome === input.outcome
      ? (input.errorCategory ?? null)
      : "CHAT_STREAM_INTERRUPTED";
  const committedRetryable =
    committedOutcome === input.outcome ? (input.retryable ?? null) : true;

  let fallbackOutputTokens = attempt.outputTokens ?? 0;
  if (
    input.providerCalls.length === 0 &&
    attempt.usageIsEstimated !== false &&
    attempt.content
  ) {
    const counter = createTokenCounter(attempt.modelId);
    try {
      fallbackOutputTokens = Math.max(
        fallbackOutputTokens,
        counter.withSafetyMargin(counter.estimateText(attempt.content)),
      );
    } finally {
      counter.free();
    }
  }
  const durableProviderUsage =
    input.providerCalls.length === 0 &&
    attempt.usageIsEstimated === false &&
    attempt.inputTokens !== null &&
    attempt.outputTokens !== null
      ? [
          {
            callNumber: 1,
            modelId: attempt.modelId,
            inputTokens: attempt.inputTokens,
            outputTokens: attempt.outputTokens,
            estimatedInputTokens: attempt.inputTokens,
            estimatedOutputTokens: attempt.outputTokens,
          },
        ]
      : input.providerCalls;
  const calls = normalizeSettlementCalls(durableProviderUsage, {
    modelId: attempt.modelId,
    estimatedInputTokens: attempt.inputTokens ?? reservation.reservedTokens,
    estimatedOutputTokens: fallbackOutputTokens,
  });
  const settledInputTokens = calls.reduce(
    (total, call) => total + call.inputTokens,
    0,
  );
  const settledOutputTokens = calls.reduce(
    (total, call) => total + call.outputTokens,
    0,
  );
  const settledTokens = settledInputTokens + settledOutputTokens;
  const usageIsEstimated = calls.some((call) => call.estimated);
  const providerRetryCount = calls.reduce(
    (maximum, call) => Math.max(maximum, call.automaticRetryCount),
    0,
  );

  for (const bucket of [instanceBucket, userBucket]) {
    await transaction
      .update(quotaBucket)
      .set({
        reservedRequests: sql`${quotaBucket.reservedRequests} - ${reservation.requestUnits}`,
        reservedTokens: sql`${quotaBucket.reservedTokens} - ${reservation.reservedTokens}`,
        consumedRequests: sql`${quotaBucket.consumedRequests} + ${reservation.requestUnits}`,
        consumedTokens: sql`${quotaBucket.consumedTokens} + ${settledTokens}`,
        updatedAt: input.now,
      })
      .where(eq(quotaBucket.id, bucket.id));
  }

  await transaction.insert(usageLedger).values(
    calls.map((call, index) => ({
      id: randomUUID(),
      userId: reservation.userId,
      conversationId: reservation.conversationId,
      attemptId: reservation.attemptId,
      periodStart: userBucket.periodStart,
      periodEnd: userBucket.periodEnd,
      userRequestUnits: index === 0 ? reservation.requestUnits : 0,
      providerCallNumber: call.callNumber,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      usageIsEstimated: call.estimated,
      modelId: call.modelId,
      outcome: committedOutcome,
      errorCategory: call.errorCategory ?? committedErrorCategory,
      automaticRetryCount: call.automaticRetryCount,
      latencyMs: call.latencyMs,
      createdAt: input.now,
    })),
  );

  await transaction
    .update(quotaReservation)
    .set({
      status: "settled",
      settledInputTokens,
      settledOutputTokens,
      usageIsEstimated,
      settledAt: input.now,
    })
    .where(eq(quotaReservation.id, reservation.id));

  if (lease) {
    await transaction
      .delete(generationLease)
      .where(
        and(
          eq(generationLease.attemptId, input.attemptId),
          eq(generationLease.ownerToken, input.leaseOwner),
        ),
      );
  }

  await transaction
    .update(generationAttempt)
    .set({
      status: committedOutcome,
      inputTokens: settledInputTokens,
      outputTokens: settledOutputTokens,
      usageIsEstimated,
      errorCategory: committedErrorCategory,
      retryable: committedRetryable,
      providerRetryCount,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(generationAttempt.id, input.attemptId));

  if (committedOutcome === "complete") {
    if (sourceConversation)
      await createExtractionRunForCompletedAttempt(transaction, {
        attemptId: input.attemptId,
        userId: reservation.userId,
        characterId: sourceConversation.characterId,
        conversationId: sourceConversation.id,
        now: input.now,
      });
  }

  return committedOutcome;
}

async function reconcileExpiredWithinAdmission(
  transaction: ChatTransaction,
  now: Date,
  scope?: ConversationRecoveryScope,
): Promise<void> {
  const expired = await expiredLeaseQuery(transaction, now, scope);

  for (const lease of expired) {
    await settleLockedGeneration(
      transaction,
      {
        attemptId: lease.attemptId,
        leaseOwner: lease.ownerToken,
        outcome: "interrupted",
        now,
        providerCalls: [],
        errorCategory: "CHAT_STREAM_INTERRUPTED",
        retryable: true,
      },
      undefined,
      {
        leaseExpiredAtOrBefore: now,
      },
    );
  }
}

export async function reconcileExpiredConversationInTransaction(
  transaction: ChatTransaction,
  input: ConversationRecoveryScope,
  now: Date,
): Promise<void> {
  await lockUserChatMutation(transaction, input.userId);
  await reconcileExpiredWithinAdmission(transaction, now, input);
}

export async function admitGeneration(
  transaction: ChatTransaction,
  input: {
    userId: string;
    conversationId: string;
    assistantMessageId: string;
    estimatedInputTokens: number;
    maxOutputTokens: number;
    now: Date;
  },
): Promise<GenerationAdmission> {
  await lockUserChatMutation(transaction, input.userId);

  const [userRow] = await transaction
    .select({ id: user.id, banned: user.banned })
    .from(user)
    .where(eq(user.id, input.userId))
    .for("update")
    .limit(1);
  if (!userRow) {
    throw new ChatDomainError("CHAT_NOT_FOUND", "User not found.");
  }
  if (userRow.banned) {
    throw new ChatDomainError("CHAT_READ_ONLY", "This account is disabled.");
  }

  const [settings] = await transaction
    .select()
    .from(chatSettings)
    .where(eq(chatSettings.id, "global"))
    .limit(1);
  if (!settings) {
    throw new ChatDomainError(
      "CHAT_INTERNAL",
      "Chat settings are not initialized.",
    );
  }

  const [override] = await transaction
    .select({
      dailyRequestLimit: userChatQuotaOverride.dailyRequestLimit,
      dailyTokenLimit: userChatQuotaOverride.dailyTokenLimit,
    })
    .from(userChatQuotaOverride)
    .where(eq(userChatQuotaOverride.userId, input.userId))
    .limit(1);
  const effectiveLimits = resolveEffectiveLimits(settings, override);
  const reservedTokens = input.estimatedInputTokens + input.maxOutputTokens;
  let instanceBucket = await lockBucket(transaction, {
    scope: "instance",
    period: instancePeriod(input.now),
  });
  let userBucket = await lockBucket(transaction, {
    scope: "user",
    userId: input.userId,
    period: userPeriod(input.now),
  });

  await reconcileExpiredWithinAdmission(transaction, input.now);
  const [existingUserLease] = await transaction
    .select()
    .from(generationLease)
    .where(eq(generationLease.userId, input.userId))
    .limit(1);

  instanceBucket =
    (await lockExistingBucket(transaction, instanceBucket.id)) ??
    instanceBucket;
  userBucket =
    (await lockExistingBucket(transaction, userBucket.id)) ?? userBucket;

  if (existingUserLease && existingUserLease.expiresAt > input.now) {
    throw new ChatDomainError(
      "CHAT_GENERATION_IN_PROGRESS",
      "A generation is already active for this user.",
      { retryable: true },
    );
  }

  requireCapacity(
    instanceBucket,
    {
      requests: effectiveLimits.instanceMonthlyRequests,
      tokens: effectiveLimits.instanceMonthlyTokens,
    },
    reservedTokens,
    {
      requests: "CHAT_INSTANCE_REQUEST_BUDGET",
      tokens: "CHAT_INSTANCE_TOKEN_BUDGET",
    },
  );
  requireCapacity(
    userBucket,
    {
      requests: effectiveLimits.userDailyRequests,
      tokens: effectiveLimits.userDailyTokens,
    },
    reservedTokens,
    {
      requests: "CHAT_USER_REQUEST_QUOTA",
      tokens: "CHAT_USER_TOKEN_QUOTA",
    },
  );

  const [{ activeLeaseCount }] = await transaction
    .select({
      activeLeaseCount: sql<number>`COUNT(*)::integer`,
    })
    .from(generationLease)
    .where(gt(generationLease.expiresAt, input.now));
  if (activeLeaseCount >= effectiveLimits.maxConcurrentGenerations) {
    throw new ChatDomainError(
      "CHAT_INSTANCE_CONCURRENCY",
      "The instance generation limit has been reached.",
      { retryable: true },
    );
  }

  const [conversationRow] = await transaction
    .select({
      id: conversation.id,
      lifecycle: conversation.lifecycle,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.id, input.conversationId),
        eq(conversation.userId, input.userId),
      ),
    )
    .for("update", { of: conversation })
    .limit(1);
  if (!conversationRow) {
    throw new ChatDomainError("CHAT_NOT_FOUND", "Conversation not found.");
  }
  if (conversationRow.lifecycle !== "active") {
    throw new ChatDomainError("CHAT_READ_ONLY", "Conversation is read-only.");
  }

  const [attempt] = await transaction
    .select({
      id: generationAttempt.id,
      status: generationAttempt.status,
      isCurrent: generationAttempt.isCurrent,
    })
    .from(generationAttempt)
    .innerJoin(
      conversationMessage,
      eq(conversationMessage.id, generationAttempt.assistantMessageId),
    )
    .where(
      and(
        eq(generationAttempt.assistantMessageId, input.assistantMessageId),
        eq(generationAttempt.isCurrent, true),
        eq(conversationMessage.conversationId, input.conversationId),
        eq(conversationMessage.kind, "generated"),
      ),
    )
    .for("update", { of: generationAttempt })
    .limit(1);
  if (
    !attempt ||
    !attempt.isCurrent ||
    (attempt.status !== "pending" && attempt.status !== "streaming")
  ) {
    throw new ChatDomainError(
      "CHAT_NOT_FOUND",
      "Current generation attempt not found.",
    );
  }

  const reservationId = randomUUID();
  const leaseOwner = randomUUID();
  const leaseExpiresAt = new Date(
    input.now.getTime() + GENERATION_LEASE_DURATION_MS,
  );

  for (const bucket of [instanceBucket, userBucket]) {
    await transaction
      .update(quotaBucket)
      .set({
        reservedRequests: sql`${quotaBucket.reservedRequests} + 1`,
        reservedTokens: sql`${quotaBucket.reservedTokens} + ${reservedTokens}`,
        updatedAt: input.now,
      })
      .where(eq(quotaBucket.id, bucket.id));
  }
  await transaction.insert(quotaReservation).values({
    id: reservationId,
    userId: input.userId,
    conversationId: input.conversationId,
    attemptId: attempt.id,
    userBucketId: userBucket.id,
    instanceBucketId: instanceBucket.id,
    reservedTokens,
    createdAt: input.now,
  });
  await transaction.insert(generationLease).values({
    attemptId: attempt.id,
    userId: input.userId,
    ownerToken: leaseOwner,
    expiresAt: leaseExpiresAt,
    createdAt: input.now,
    updatedAt: input.now,
  });
  await transaction
    .update(generationAttempt)
    .set({
      leaseOwner,
      leaseExpiresAt,
      inputTokens: input.estimatedInputTokens,
      outputTokens: 0,
      usageIsEstimated: true,
      updatedAt: input.now,
    })
    .where(eq(generationAttempt.id, attempt.id));

  return {
    attemptId: attempt.id,
    reservationId,
    leaseOwner,
    effectiveLimits: {
      userDailyRequests: effectiveLimits.userDailyRequests,
      userDailyTokens: effectiveLimits.userDailyTokens,
      instanceMonthlyRequests: effectiveLimits.instanceMonthlyRequests,
      instanceMonthlyTokens: effectiveLimits.instanceMonthlyTokens,
    },
  };
}

export async function settleGeneration(
  database: Database,
  input: GenerationSettlement,
): Promise<GenerationSettlementOutcome | undefined> {
  return database.transaction(async (transaction) => {
    const [preview] = await transaction
      .select()
      .from(quotaReservation)
      .where(eq(quotaReservation.attemptId, input.attemptId))
      .limit(1);
    if (!preview || preview.status !== "active") {
      return undefined;
    }

    await lockUserChatMutation(transaction, preview.userId);
    return settleLockedGeneration(transaction, input, preview);
  });
}

export async function reconcileExpiredLeases(
  database: Database,
  now: Date,
  scope?: ConversationRecoveryScope,
): Promise<number> {
  const expired = await expiredLeaseQuery(database, now, scope);
  let reconciled = 0;

  for (const lease of expired) {
    const didSettle = await database.transaction(async (transaction) => {
      const [preview] = await transaction
        .select()
        .from(quotaReservation)
        .where(eq(quotaReservation.attemptId, lease.attemptId))
        .limit(1);
      if (!preview || preview.status !== "active") {
        return undefined;
      }
      if (
        scope &&
        (preview.userId !== scope.userId ||
          preview.conversationId !== scope.conversationId)
      ) {
        return undefined;
      }
      await lockUserChatMutation(transaction, preview.userId);
      return settleLockedGeneration(
        transaction,
        {
          attemptId: lease.attemptId,
          leaseOwner: lease.ownerToken,
          outcome: "interrupted",
          now,
          providerCalls: [],
          errorCategory: "CHAT_STREAM_INTERRUPTED",
          retryable: true,
        },
        preview,
        {
          leaseExpiredAtOrBefore: now,
        },
      );
    });
    if (didSettle !== undefined) {
      reconciled += 1;
    }
  }

  return reconciled;
}

export async function deleteUserWithGenerationSettlement(
  database: Database,
  userId: string,
  now: Date,
): Promise<void> {
  await database.transaction(async (transaction) => {
    await lockUserChatMutation(transaction, userId);

    const reservations = await transaction
      .select()
      .from(quotaReservation)
      .where(
        and(
          eq(quotaReservation.userId, userId),
          eq(quotaReservation.status, "active"),
        ),
      );

    for (const reservation of reservations) {
      const [lease] = await transaction
        .select({ ownerToken: generationLease.ownerToken })
        .from(generationLease)
        .where(eq(generationLease.attemptId, reservation.attemptId))
        .limit(1);
      const [attempt] = await transaction
        .select({ leaseOwner: generationAttempt.leaseOwner })
        .from(generationAttempt)
        .where(eq(generationAttempt.id, reservation.attemptId))
        .limit(1);

      await settleLockedGeneration(
        transaction,
        {
          attemptId: reservation.attemptId,
          leaseOwner: lease?.ownerToken ?? attempt?.leaseOwner ?? "",
          outcome: "interrupted",
          now,
          providerCalls: [],
          errorCategory: "CHAT_STREAM_INTERRUPTED",
          retryable: false,
        },
        reservation,
      );
    }

    await transaction
      .update(usageLedger)
      .set({
        userId: null,
        conversationId: null,
        attemptId: null,
      })
      .where(eq(usageLedger.userId, userId));
    await settleUserExtractionWorkBeforeDeletion(transaction, { userId, now });
    await transaction.delete(user).where(eq(user.id, userId));
  });
}
