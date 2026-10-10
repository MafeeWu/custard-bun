import "server-only";

import { and, eq, inArray, max, sql } from "drizzle-orm";
import { getRuntimeConfig } from "@/server/config/load-config";
import type { Database } from "@/server/db/client";
import { getDatabase } from "@/server/db/database";
import { safeErrorName } from "@/server/logging/safe-error";
import {
  conversation,
  conversationMessage,
  generationAttempt,
  generationLease,
  characterVersion,
} from "@/server/db/schema";
import type {
  ModelGateway,
  ModelGatewayStreamInput,
} from "@/server/model-gateway/model-contract";
import { ModelGatewayError } from "@/server/model-gateway/model-error";
import { OpenAiCompatibleGateway } from "@/server/model-gateway/openai-compatible-gateway";
import { ChatDomainError, type ChatErrorCode } from "./chat-errors";
import {
  createFailedChatStreamEvent,
  createInterruptedChatStreamEvent,
  type ChatStreamEvent,
  type ChatUsage,
} from "./chat-events";
import { lockUserChatMutation, type ChatTransaction } from "./chat-locks";
import {
  assembleChatPrompt,
  type PromptHistoryMessage,
} from "./prompt-assembler";
import {
  admitGeneration,
  settleGeneration,
  type GenerationSettlementOutcome,
  type ProviderCallSettlement,
} from "./quota-service";
import { createTokenCounter, type TokenCounter } from "./token-counter";
import { getBoss } from "@/server/jobs/boss";
import { ensureQueues } from "@/server/jobs/queues";
import {
  captureExtractionAdmission,
  enqueuePendingExtractionRuns,
} from "@/server/memory/memory-extraction-service";

const CHECKPOINT_INTERVAL_MS = 500;
const CHECKPOINT_BYTES = 1_024;
const LEASE_DURATION_MS = 5 * 60_000;
const PLATFORM_RULES = [
  "Platform rules:",
  "- Be supportive, honest, and respectful.",
  "- Do not encourage dependency or claim to replace human relationships.",
  "- Prioritize immediate safety and human support when someone may be in danger.",
].join("\n");

interface GenerationConfig {
  modelId: string;
  platformRules: string;
  promptTokenBudget: number;
  maxInputCharacters: number;
  maxOutputTokens: number;
  firstTokenTimeoutMs: number;
  requestTimeoutMs: number;
}

interface GenerationLogger {
  error(message: string, metadata?: Record<string, unknown>): void;
}

interface GenerationDependencies {
  gateway: ModelGateway;
  tokenCounter: TokenCounter;
  now: () => Date;
  idFactory: () => string;
  config: GenerationConfig;
  logger: GenerationLogger;
  enqueueExtractionRuns?: () => Promise<unknown>;
  scheduleCheckpoint?: (
    callback: () => Promise<void>,
    milliseconds: number,
  ) => () => void;
}

interface PreparedGeneration {
  attemptId: string;
  conversationId: string;
  leaseOwner: string;
  gatewayInput: Omit<ModelGatewayStreamInput, "signal">;
  estimatedInputTokens: number;
  replay?: ChatStreamEvent;
}

interface AttemptReplay {
  attemptId: string;
  conversationId: string;
  status: "pending" | "streaming" | "complete" | "interrupted" | "failed";
  inputTokens: number | null;
  outputTokens: number | null;
  usageIsEstimated: boolean | null;
  errorCategory: string | null;
  retryable: boolean | null;
}

class SettlementBoundaryError {
  constructor(readonly cause: unknown) {}
}

export interface GenerationService {
  startNewMessage(input: {
    userId: string;
    conversationId: string;
    clientRequestId: string;
    content: string;
    signal: AbortSignal;
  }): AsyncGenerator<ChatStreamEvent, void>;
  retry(input: {
    userId: string;
    conversationId: string;
    clientRequestId: string;
    attemptId: string;
    signal: AbortSignal;
  }): AsyncGenerator<ChatStreamEvent, void>;
  stop(input: { userId: string; attemptId: string }): Promise<void>;
}

function validateContent(content: string, maximum: number): string {
  const normalized = content.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new ChatDomainError(
      "CHAT_VALIDATION",
      "Message content is empty or exceeds the configured limit.",
    );
  }
  return normalized;
}

function storedError(
  code: string | null,
  retryable: boolean | null,
): ChatDomainError {
  const safeCode = isChatErrorCode(code) ? code : "CHAT_INTERNAL";
  return new ChatDomainError(safeCode, "Persisted generation failure.", {
    retryable: retryable ?? false,
  });
}

function isChatErrorCode(value: string | null): value is ChatErrorCode {
  return (
    value !== null &&
    [
      "CHAT_VALIDATION",
      "CHAT_NOT_FOUND",
      "CHAT_READ_ONLY",
      "CHAT_GENERATION_IN_PROGRESS",
      "CHAT_USER_REQUEST_QUOTA",
      "CHAT_USER_TOKEN_QUOTA",
      "CHAT_INSTANCE_REQUEST_BUDGET",
      "CHAT_INSTANCE_TOKEN_BUDGET",
      "CHAT_INSTANCE_CONCURRENCY",
      "CHAT_PROVIDER_AUTH",
      "CHAT_PROVIDER_RATE_LIMIT",
      "CHAT_PROVIDER_TIMEOUT",
      "CHAT_PROVIDER_PROTOCOL",
      "CHAT_STREAM_INTERRUPTED",
      "CHAT_INTERNAL",
    ].includes(value)
  );
}

function replayEvent(replay: AttemptReplay): ChatStreamEvent | undefined {
  if (replay.status === "pending" || replay.status === "streaming") {
    throw new ChatDomainError(
      "CHAT_GENERATION_IN_PROGRESS",
      "This request is already generating a response.",
      {
        retryable: true,
        metadata: {
          attemptId: replay.attemptId,
          conversationId: replay.conversationId,
        },
      },
    );
  }
  if (replay.status === "complete") {
    return {
      type: "completed",
      attemptId: replay.attemptId,
      usage: {
        inputTokens: replay.inputTokens ?? 0,
        outputTokens: replay.outputTokens ?? 0,
        estimated: replay.usageIsEstimated ?? true,
      },
    };
  }
  const error = storedError(replay.errorCategory, replay.retryable);
  return replay.status === "interrupted"
    ? createInterruptedChatStreamEvent(replay.attemptId, error)
    : createFailedChatStreamEvent(replay.attemptId, error);
}

async function findReplay(
  transaction: ChatTransaction,
  input: {
    userId: string;
    conversationId: string;
    clientRequestId: string;
  },
): Promise<AttemptReplay | undefined> {
  const [row] = await transaction
    .select({
      attemptId: generationAttempt.id,
      conversationId: conversation.id,
      status: generationAttempt.status,
      inputTokens: generationAttempt.inputTokens,
      outputTokens: generationAttempt.outputTokens,
      usageIsEstimated: generationAttempt.usageIsEstimated,
      errorCategory: generationAttempt.errorCategory,
      retryable: generationAttempt.retryable,
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
        eq(generationAttempt.clientRequestId, input.clientRequestId),
        eq(generationAttempt.userId, input.userId),
        eq(conversation.userId, input.userId),
      ),
    )
    .limit(1);
  return row;
}

async function promptContext(
  transaction: ChatTransaction,
  input: {
    userId: string;
    conversationId: string;
    currentUserMessage: string;
    tokenCounter: TokenCounter;
    config: GenerationConfig;
  },
) {
  const [selectedConversation] = await transaction
    .select({
      id: conversation.id,
      lifecycle: conversation.lifecycle,
      characterVersionId: conversation.characterVersionId,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.id, input.conversationId),
        eq(conversation.userId, input.userId),
      ),
    )
    .limit(1);
  if (!selectedConversation) {
    throw new ChatDomainError("CHAT_NOT_FOUND", "Conversation not found.");
  }
  if (selectedConversation.lifecycle !== "active") {
    throw new ChatDomainError("CHAT_READ_ONLY", "Conversation is read-only.");
  }

  const [character] = await transaction
    .select({
      id: characterVersion.id,
      characterId: characterVersion.characterId,
      versionNumber: characterVersion.versionNumber,
      displayName: characterVersion.displayName,
      avatarPath: characterVersion.avatarPath,
      shortDescription: characterVersion.shortDescription,
      longDescription: characterVersion.longDescription,
      personalityPrinciples: characterVersion.personalityPrinciples,
      speakingStyle: characterVersion.speakingStyle,
      responseRhythm: characterVersion.responseRhythm,
      relationshipBoundaries: characterVersion.relationshipBoundaries,
      openingMessage: characterVersion.openingMessage,
      exampleConversations: characterVersion.exampleConversations,
      generationParameters: characterVersion.generationParameters,
      safetyAdditions: characterVersion.safetyAdditions,
    })
    .from(characterVersion)
    .where(eq(characterVersion.id, selectedConversation.characterVersionId))
    .limit(1);
  if (!character) {
    throw new ChatDomainError(
      "CHAT_INTERNAL",
      "Pinned character version not found.",
    );
  }

  const rows = await transaction
    .select({
      id: conversationMessage.id,
      conversationId: conversationMessage.conversationId,
      userId: conversation.userId,
      sequence: conversationMessage.sequence,
      role: conversationMessage.role,
      kind: conversationMessage.kind,
      content: conversationMessage.content,
      inReplyTo: conversationMessage.inReplyTo,
      attemptId: generationAttempt.id,
      status: generationAttempt.status,
      attemptContent: generationAttempt.content,
      isCurrent: generationAttempt.isCurrent,
    })
    .from(conversationMessage)
    .innerJoin(
      conversation,
      eq(conversation.id, conversationMessage.conversationId),
    )
    .leftJoin(
      generationAttempt,
      eq(generationAttempt.assistantMessageId, conversationMessage.id),
    )
    .where(eq(conversationMessage.conversationId, input.conversationId));

  const history: PromptHistoryMessage[] = [];
  for (const row of rows) {
    if (row.role === "user" && row.kind === "user" && row.content) {
      history.push({
        id: row.id,
        conversationId: row.conversationId,
        userId: row.userId,
        sequence: row.sequence,
        role: "user",
        kind: "user",
        content: row.content,
      });
    } else if (
      row.role === "assistant" &&
      row.kind === "opening" &&
      row.content
    ) {
      history.push({
        id: row.id,
        conversationId: row.conversationId,
        userId: row.userId,
        sequence: row.sequence,
        role: "assistant",
        kind: "opening",
        content: row.content,
      });
    } else if (
      row.role === "assistant" &&
      row.kind === "generated" &&
      row.inReplyTo &&
      row.attemptId &&
      row.status &&
      row.attemptContent !== null &&
      row.isCurrent !== null
    ) {
      history.push({
        id: row.id,
        conversationId: row.conversationId,
        userId: row.userId,
        sequence: row.sequence,
        role: "assistant",
        kind: "generated",
        content: row.attemptContent,
        inReplyTo: row.inReplyTo,
        attemptId: row.attemptId,
        status: row.status,
        isCurrent: row.isCurrent,
      });
    }
  }

  const maxOutputTokens = Math.min(
    character.generationParameters.maxOutputTokens,
    input.config.maxOutputTokens,
  );
  const assembled = assembleChatPrompt({
    character,
    userId: input.userId,
    conversationId: input.conversationId,
    history,
    currentUserMessage: input.currentUserMessage,
    platformRules: input.config.platformRules,
    promptTokenBudget: input.config.promptTokenBudget,
    maxOutputTokens,
    tokenCounter: input.tokenCounter,
  });
  return {
    assembled,
    maxOutputTokens,
    temperature: character.generationParameters.temperature,
    topP: character.generationParameters.topP,
  };
}

function gatewayInput(
  context: Awaited<ReturnType<typeof promptContext>>,
  config: GenerationConfig,
): Omit<ModelGatewayStreamInput, "signal"> {
  return {
    messages: context.assembled.messages,
    modelId: config.modelId,
    temperature: context.temperature,
    topP: context.topP,
    maxOutputTokens: context.maxOutputTokens,
    firstTokenTimeoutMs: config.firstTokenTimeoutMs,
    requestTimeoutMs: config.requestTimeoutMs,
  };
}

function gatewayError(
  error: unknown,
  hasDelta: boolean,
): {
  error: ChatDomainError;
  outcome: "failed" | "interrupted";
} {
  if (!(error instanceof ModelGatewayError)) {
    return {
      error: new ChatDomainError("CHAT_INTERNAL", "Generation failed."),
      outcome: hasDelta ? "interrupted" : "failed",
    };
  }
  if (
    hasDelta ||
    error.category === "cancelled" ||
    error.category === "interrupted"
  ) {
    return {
      error: new ChatDomainError(
        "CHAT_STREAM_INTERRUPTED",
        "Generation was interrupted.",
        { retryable: true },
      ),
      outcome: "interrupted",
    };
  }
  if (error.category === "authentication") {
    return {
      error: new ChatDomainError(
        "CHAT_PROVIDER_AUTH",
        "Provider authentication failed.",
      ),
      outcome: "failed",
    };
  }
  if (error.category === "rate_limit") {
    return {
      error: new ChatDomainError(
        "CHAT_PROVIDER_RATE_LIMIT",
        "Provider rate limit.",
        {
          retryable: true,
          ...(error.retryAfterMs !== undefined
            ? { resetAt: new Date(Date.now() + error.retryAfterMs) }
            : {}),
        },
      ),
      outcome: "failed",
    };
  }
  if (
    error.category === "first_token_timeout" ||
    error.category === "total_timeout"
  ) {
    return {
      error: new ChatDomainError("CHAT_PROVIDER_TIMEOUT", "Provider timeout.", {
        retryable: true,
      }),
      outcome: "failed",
    };
  }
  if (error.category === "protocol") {
    return {
      error: new ChatDomainError(
        "CHAT_PROVIDER_PROTOCOL",
        "Provider protocol failure.",
      ),
      outcome: "failed",
    };
  }
  return {
    error: new ChatDomainError("CHAT_INTERNAL", "Provider failure.", {
      retryable: error.retryable,
    }),
    outcome: "failed",
  };
}

export function createGenerationService(
  database: Database,
  dependencies: GenerationDependencies,
): GenerationService {
  const activeControllers = new Map<string, AbortController>();
  const scheduleCheckpoint =
    dependencies.scheduleCheckpoint ??
    ((callback: () => Promise<void>, milliseconds: number) => {
      const timer = setTimeout(() => void callback(), milliseconds);
      timer.unref?.();
      return () => clearTimeout(timer);
    });

  function estimatedOutputTokens(content: string): number {
    return content
      ? dependencies.tokenCounter.withSafetyMargin(
          dependencies.tokenCounter.estimateText(content),
        )
      : 0;
  }

  function writableAttempt(prepared: PreparedGeneration) {
    return and(
      eq(generationAttempt.id, prepared.attemptId),
      eq(generationAttempt.leaseOwner, prepared.leaseOwner),
      inArray(generationAttempt.status, ["pending", "streaming"]),
    );
  }

  async function prepareNew(input: {
    userId: string;
    conversationId: string;
    clientRequestId: string;
    content: string;
  }): Promise<PreparedGeneration> {
    const content = validateContent(
      input.content,
      dependencies.config.maxInputCharacters,
    );
    return database.transaction(async (transaction) => {
      await lockUserChatMutation(transaction, input.userId);
      const replay = await findReplay(transaction, input);
      if (replay) {
        return {
          attemptId: replay.attemptId,
          conversationId: replay.conversationId,
          leaseOwner: "",
          gatewayInput: {} as PreparedGeneration["gatewayInput"],
          estimatedInputTokens: replay.inputTokens ?? 0,
          replay: replayEvent(replay),
        };
      }

      const extractionMemoryEpoch = await captureExtractionAdmission(
        transaction,
        input,
      );
      const context = await promptContext(transaction, {
        userId: input.userId,
        conversationId: input.conversationId,
        currentUserMessage: content,
        tokenCounter: dependencies.tokenCounter,
        config: dependencies.config,
      });
      const [{ sequence }] = await transaction
        .select({ sequence: max(conversationMessage.sequence) })
        .from(conversationMessage)
        .where(eq(conversationMessage.conversationId, input.conversationId));
      const userMessageId = dependencies.idFactory();
      const assistantMessageId = dependencies.idFactory();
      const attemptId = dependencies.idFactory();
      const now = dependencies.now();
      await transaction.insert(conversationMessage).values([
        {
          id: userMessageId,
          conversationId: input.conversationId,
          sequence: Number(sequence ?? 0) + 1,
          role: "user",
          kind: "user",
          content,
          clientRequestId: input.clientRequestId,
          createdAt: now,
        },
        {
          id: assistantMessageId,
          conversationId: input.conversationId,
          sequence: Number(sequence ?? 0) + 2,
          role: "assistant",
          kind: "generated",
          inReplyTo: userMessageId,
          createdAt: now,
        },
      ]);
      await transaction.insert(generationAttempt).values({
        id: attemptId,
        userId: input.userId,
        assistantMessageId,
        clientRequestId: input.clientRequestId,
        attemptNumber: 1,
        extractionMemoryEpoch,
        modelId: dependencies.config.modelId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const admission = await admitGeneration(transaction, {
        userId: input.userId,
        conversationId: input.conversationId,
        assistantMessageId,
        estimatedInputTokens: context.assembled.estimatedInputTokens,
        maxOutputTokens: context.maxOutputTokens,
        now,
      });
      await transaction
        .update(conversation)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(conversation.id, input.conversationId));
      return {
        attemptId,
        conversationId: input.conversationId,
        leaseOwner: admission.leaseOwner,
        gatewayInput: gatewayInput(context, dependencies.config),
        estimatedInputTokens: context.assembled.estimatedInputTokens,
      };
    });
  }

  async function prepareRetry(input: {
    userId: string;
    conversationId: string;
    clientRequestId: string;
    attemptId: string;
  }): Promise<PreparedGeneration> {
    return database.transaction(async (transaction) => {
      await lockUserChatMutation(transaction, input.userId);
      const replay = await findReplay(transaction, input);
      if (replay) {
        return {
          attemptId: replay.attemptId,
          conversationId: replay.conversationId,
          leaseOwner: "",
          gatewayInput: {} as PreparedGeneration["gatewayInput"],
          estimatedInputTokens: replay.inputTokens ?? 0,
          replay: replayEvent(replay),
        };
      }

      const extractionMemoryEpoch = await captureExtractionAdmission(
        transaction,
        input,
      );
      const [current] = await transaction
        .select({
          id: generationAttempt.id,
          assistantMessageId: generationAttempt.assistantMessageId,
          attemptNumber: generationAttempt.attemptNumber,
          status: generationAttempt.status,
          isCurrent: generationAttempt.isCurrent,
          extractionMemoryEpoch: generationAttempt.extractionMemoryEpoch,
          userMessageId: conversationMessage.inReplyTo,
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
            eq(generationAttempt.id, input.attemptId),
            eq(conversation.id, input.conversationId),
            eq(conversation.userId, input.userId),
          ),
        )
        .for("update", { of: generationAttempt })
        .limit(1);
      if (
        !current ||
        !current.isCurrent ||
        (current.status !== "failed" && current.status !== "interrupted") ||
        !current.userMessageId
      ) {
        throw new ChatDomainError(
          "CHAT_NOT_FOUND",
          "Retryable attempt not found.",
        );
      }
      const [userMessage] = await transaction
        .select({ content: conversationMessage.content })
        .from(conversationMessage)
        .where(eq(conversationMessage.id, current.userMessageId))
        .limit(1);
      if (!userMessage?.content) {
        throw new ChatDomainError(
          "CHAT_NOT_FOUND",
          "Retry source message not found.",
        );
      }

      const context = await promptContext(transaction, {
        userId: input.userId,
        conversationId: input.conversationId,
        currentUserMessage: userMessage.content,
        tokenCounter: dependencies.tokenCounter,
        config: dependencies.config,
      });
      const attemptId = dependencies.idFactory();
      const now = dependencies.now();
      await transaction
        .update(generationAttempt)
        .set({ isCurrent: false, updatedAt: now })
        .where(eq(generationAttempt.id, current.id));
      await transaction.insert(generationAttempt).values({
        id: attemptId,
        userId: input.userId,
        assistantMessageId: current.assistantMessageId,
        clientRequestId: input.clientRequestId,
        attemptNumber: current.attemptNumber + 1,
        extractionMemoryEpoch:
          current.extractionMemoryEpoch === extractionMemoryEpoch
            ? extractionMemoryEpoch
            : null,
        modelId: dependencies.config.modelId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const admission = await admitGeneration(transaction, {
        userId: input.userId,
        conversationId: input.conversationId,
        assistantMessageId: current.assistantMessageId,
        estimatedInputTokens: context.assembled.estimatedInputTokens,
        maxOutputTokens: context.maxOutputTokens,
        now,
      });
      return {
        attemptId,
        conversationId: input.conversationId,
        leaseOwner: admission.leaseOwner,
        gatewayInput: gatewayInput(context, dependencies.config),
        estimatedInputTokens: context.assembled.estimatedInputTokens,
      };
    });
  }

  async function checkpoint(
    prepared: PreparedGeneration,
    content: string,
    now: Date,
  ): Promise<boolean> {
    return database.transaction(async (transaction) => {
      const [attempt] = await transaction
        .select({
          cancelRequestedAt: generationAttempt.cancelRequestedAt,
          leaseOwner: generationAttempt.leaseOwner,
          usageIsEstimated: generationAttempt.usageIsEstimated,
        })
        .from(generationAttempt)
        .where(writableAttempt(prepared))
        .for("update")
        .limit(1);
      if (
        !attempt ||
        attempt.cancelRequestedAt ||
        attempt.leaseOwner !== prepared.leaseOwner
      ) {
        return false;
      }
      const [lease] = await transaction
        .select({ attemptId: generationLease.attemptId })
        .from(generationLease)
        .where(
          and(
            eq(generationLease.attemptId, prepared.attemptId),
            eq(generationLease.ownerToken, prepared.leaseOwner),
          ),
        )
        .for("update")
        .limit(1);
      if (!lease) {
        return false;
      }
      const result = await transaction
        .update(generationAttempt)
        .set({
          content,
          status: "streaming",
          checkpointedAt: now,
          updatedAt: now,
          ...(attempt.usageIsEstimated !== false
            ? {
                outputTokens: estimatedOutputTokens(content),
                usageIsEstimated: true,
              }
            : {}),
        })
        .where(writableAttempt(prepared))
        .returning({ id: generationAttempt.id });
      if (result.length === 0) {
        return false;
      }
      await transaction
        .update(generationLease)
        .set({
          expiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
          updatedAt: now,
        })
        .where(
          and(
            eq(generationLease.attemptId, prepared.attemptId),
            eq(generationLease.ownerToken, prepared.leaseOwner),
          ),
        );
      return true;
    });
  }

  async function attemptCanContinue(
    attemptId: string,
    leaseOwner: string,
  ): Promise<boolean> {
    const [attempt] = await database
      .select({
        cancelRequestedAt: generationAttempt.cancelRequestedAt,
        leaseOwner: generationAttempt.leaseOwner,
      })
      .from(generationAttempt)
      .where(eq(generationAttempt.id, attemptId))
      .limit(1);
    return Boolean(
      attempt &&
      !attempt.cancelRequestedAt &&
      attempt.leaseOwner === leaseOwner,
    );
  }

  async function persistProviderRequestId(
    prepared: PreparedGeneration,
    requestId: string,
  ) {
    await database
      .update(generationAttempt)
      .set({ providerRequestId: requestId, updatedAt: dependencies.now() })
      .where(writableAttempt(prepared));
  }

  async function flushContent(
    prepared: PreparedGeneration,
    content: string,
    firstTokenAt?: Date,
  ) {
    await database
      .update(generationAttempt)
      .set({
        content,
        outputTokens: sql`CASE WHEN ${generationAttempt.usageIsEstimated} = FALSE
          THEN ${generationAttempt.outputTokens} ELSE ${estimatedOutputTokens(content)} END`,
        ...(content
          ? {
              status: "streaming" as const,
              firstTokenAt,
              checkpointedAt: dependencies.now(),
            }
          : {}),
        updatedAt: dependencies.now(),
      })
      .where(writableAttempt(prepared));
  }

  function providerCall(
    callNumber: number,
    prepared: PreparedGeneration,
  ): ProviderCallSettlement {
    return {
      callNumber,
      modelId: dependencies.config.modelId,
      estimatedInputTokens: prepared.estimatedInputTokens,
      estimatedOutputTokens: 0,
      automaticRetryCount: Math.max(0, callNumber - 1),
    };
  }

  async function settlePrepared(
    prepared: PreparedGeneration,
    input: Parameters<typeof settleGeneration>[1],
    protectFromGatewayCatch: boolean,
  ): Promise<GenerationSettlementOutcome | undefined> {
    try {
      return await settleGeneration(database, input);
    } catch (error) {
      dependencies.logger.error("generation settlement failed", {
        attemptId: prepared.attemptId,
        conversationId: prepared.conversationId,
        name: safeErrorName(error),
      });
      if (protectFromGatewayCatch) {
        throw new SettlementBoundaryError(error);
      }
      throw error;
    }
  }

  async function* run(
    prepare: () => Promise<PreparedGeneration>,
    browserSignal: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent, void> {
    const prepared = await prepare();
    if (prepared.replay) {
      yield prepared.replay;
      return;
    }

    const localController = new AbortController();
    activeControllers.set(prepared.attemptId, localController);
    const signal = AbortSignal.any([browserSignal, localController.signal]);
    let content = "";
    let firstTokenAt: Date | undefined;
    let checkpointAt = dependencies.now();
    let checkpointBytes = 0;
    let usage: ChatUsage | undefined;
    let currentCall: ProviderCallSettlement | undefined;
    const providerCalls: ProviderCallSettlement[] = [];
    let settlementStarted = false;
    let finishing = false;
    let cancelCheckpointTimer: (() => void) | undefined;
    let checkpointQueue = Promise.resolve();
    let checkpointFailure: unknown;

    function cancelTimer() {
      cancelCheckpointTimer?.();
      cancelCheckpointTimer = undefined;
    }

    function enqueueCheckpoint(): Promise<void> {
      cancelTimer();
      const operation = checkpointQueue.then(async () => {
        if (finishing || Buffer.byteLength(content) === checkpointBytes) {
          return;
        }
        const snapshot = content;
        const now = dependencies.now();
        if (!(await checkpoint(prepared, snapshot, now))) {
          throw new ModelGatewayError("cancelled");
        }
        checkpointAt = now;
        checkpointBytes = Buffer.byteLength(snapshot);
      });
      checkpointQueue = operation.catch((error) => {
        checkpointFailure = error;
        localController.abort();
      });
      return operation;
    }

    function deferCheckpoint() {
      if (
        finishing ||
        cancelCheckpointTimer ||
        Buffer.byteLength(content) === checkpointBytes
      ) {
        return;
      }
      cancelCheckpointTimer = scheduleCheckpoint(
        async () => {
          await enqueueCheckpoint().catch(() => undefined);
        },
        Math.max(
          0,
          CHECKPOINT_INTERVAL_MS -
            (dependencies.now().getTime() - checkpointAt.getTime()),
        ),
      );
    }

    async function drainCheckpoints() {
      finishing = true;
      cancelTimer();
      await checkpointQueue;
    }

    try {
      if (signal.aborted) {
        throw new ModelGatewayError("cancelled");
      }
      yield { type: "started", attemptId: prepared.attemptId };
      if (signal.aborted) {
        throw new ModelGatewayError("cancelled");
      }
      for await (const event of dependencies.gateway.stream({
        ...prepared.gatewayInput,
        signal,
      })) {
        if (
          signal.aborted ||
          !(await attemptCanContinue(prepared.attemptId, prepared.leaseOwner))
        ) {
          localController.abort();
          throw new ModelGatewayError("cancelled");
        }
        if (event.type === "provider-call") {
          currentCall = providerCall(event.callNumber, prepared);
          providerCalls.push(currentCall);
          continue;
        }
        if (event.type === "request-id") {
          await persistProviderRequestId(prepared, event.requestId);
          continue;
        }
        if (event.type === "usage") {
          usage = {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            estimated: false,
          };
          if (currentCall) {
            currentCall.inputTokens = event.inputTokens;
            currentCall.outputTokens = event.outputTokens;
          }
          await database
            .update(generationAttempt)
            .set({
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              usageIsEstimated: false,
              updatedAt: dependencies.now(),
            })
            .where(writableAttempt(prepared));
          continue;
        }

        const now = dependencies.now();
        firstTokenAt ??= now;
        content += event.text;
        if (content.length === event.text.length) {
          await database
            .update(generationAttempt)
            .set({
              status: "streaming",
              firstTokenAt,
              updatedAt: now,
            })
            .where(writableAttempt(prepared));
        }
        const contentBytes = Buffer.byteLength(content);
        if (
          now.getTime() - checkpointAt.getTime() >= CHECKPOINT_INTERVAL_MS ||
          contentBytes - checkpointBytes >= CHECKPOINT_BYTES
        ) {
          await enqueueCheckpoint();
        }
        deferCheckpoint();
        yield {
          type: "delta",
          attemptId: prepared.attemptId,
          text: event.text,
        };
      }

      await drainCheckpoints();
      if (checkpointFailure) {
        throw checkpointFailure;
      }
      if (
        !(await attemptCanContinue(prepared.attemptId, prepared.leaseOwner))
      ) {
        localController.abort();
        throw new ModelGatewayError("cancelled");
      }
      await flushContent(prepared, content, firstTokenAt);
      usage ??= {
        inputTokens: prepared.estimatedInputTokens,
        outputTokens: dependencies.tokenCounter.withSafetyMargin(
          dependencies.tokenCounter.estimateText(content),
        ),
        estimated: true,
      };
      if (currentCall && currentCall.inputTokens === undefined) {
        currentCall.estimatedOutputTokens = usage.outputTokens;
      }
      settlementStarted = true;
      const committedOutcome = await settlePrepared(
        prepared,
        {
          attemptId: prepared.attemptId,
          leaseOwner: prepared.leaseOwner,
          outcome: "complete",
          now: dependencies.now(),
          providerCalls,
          cancellationSignal: signal,
        },
        true,
      );
      if (committedOutcome !== "complete") {
        yield createInterruptedChatStreamEvent(
          prepared.attemptId,
          new ChatDomainError(
            "CHAT_STREAM_INTERRUPTED",
            "Generation was cancelled before completion.",
            { retryable: true },
          ),
        );
        return;
      }
      if (dependencies.enqueueExtractionRuns) {
        let timeout: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            dependencies.enqueueExtractionRuns(),
            new Promise<void>((resolve) => {
              timeout = setTimeout(resolve, 2_000);
            }),
          ]);
        } catch (error) {
          dependencies.logger.error("memory enqueue failed", {
            name: safeErrorName(error),
          });
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      }
      yield {
        type: "completed",
        attemptId: prepared.attemptId,
        usage,
      };
    } catch (error) {
      await drainCheckpoints();
      if (error instanceof SettlementBoundaryError) {
        throw error.cause;
      }
      await flushContent(prepared, content, firstTokenAt);
      const terminal = gatewayError(
        checkpointFailure ?? error,
        content.length > 0,
      );
      if (currentCall && currentCall.inputTokens === undefined) {
        currentCall.estimatedOutputTokens =
          dependencies.tokenCounter.withSafetyMargin(
            dependencies.tokenCounter.estimateText(content),
          );
        currentCall.errorCategory = terminal.error.code;
      }
      settlementStarted = true;
      const committedOutcome = await settlePrepared(
        prepared,
        {
          attemptId: prepared.attemptId,
          leaseOwner: prepared.leaseOwner,
          outcome: terminal.outcome,
          now: dependencies.now(),
          providerCalls,
          cancellationSignal: signal,
          errorCategory: terminal.error.code,
          retryable: terminal.error.retryable,
        },
        false,
      );
      const interrupted = committedOutcome !== "failed";
      const committedError = interrupted
        ? new ChatDomainError(
            "CHAT_STREAM_INTERRUPTED",
            "Generation was cancelled before completion.",
            { retryable: true },
          )
        : terminal.error;
      yield interrupted
        ? createInterruptedChatStreamEvent(prepared.attemptId, committedError)
        : createFailedChatStreamEvent(prepared.attemptId, committedError);
    } finally {
      try {
        await drainCheckpoints();
        if (!settlementStarted) {
          localController.abort();
          await flushContent(prepared, content, firstTokenAt);
          if (currentCall && currentCall.inputTokens === undefined) {
            currentCall.estimatedOutputTokens =
              dependencies.tokenCounter.withSafetyMargin(
                dependencies.tokenCounter.estimateText(content),
              );
            currentCall.errorCategory = "CHAT_STREAM_INTERRUPTED";
          }
          settlementStarted = true;
          await settlePrepared(
            prepared,
            {
              attemptId: prepared.attemptId,
              leaseOwner: prepared.leaseOwner,
              outcome: "interrupted",
              now: dependencies.now(),
              providerCalls,
              cancellationSignal: signal,
              errorCategory: "CHAT_STREAM_INTERRUPTED",
              retryable: true,
            },
            false,
          );
        }
      } finally {
        if (activeControllers.get(prepared.attemptId) === localController) {
          activeControllers.delete(prepared.attemptId);
        }
      }
    }
  }

  return {
    startNewMessage(input) {
      return run(
        () =>
          prepareNew({
            userId: input.userId,
            conversationId: input.conversationId,
            clientRequestId: input.clientRequestId,
            content: input.content,
          }),
        input.signal,
      );
    },

    retry(input) {
      return run(
        () =>
          prepareRetry({
            userId: input.userId,
            conversationId: input.conversationId,
            clientRequestId: input.clientRequestId,
            attemptId: input.attemptId,
          }),
        input.signal,
      );
    },

    async stop(input) {
      const now = dependencies.now();
      const stopped = await database.transaction(async (transaction) => {
        await lockUserChatMutation(transaction, input.userId);
        const [row] = await transaction
          .update(generationAttempt)
          .set({ cancelRequestedAt: now, updatedAt: now })
          .from(conversationMessage)
          .innerJoin(
            conversation,
            eq(conversation.id, conversationMessage.conversationId),
          )
          .where(
            and(
              eq(generationAttempt.id, input.attemptId),
              eq(generationAttempt.assistantMessageId, conversationMessage.id),
              eq(conversation.userId, input.userId),
              inArray(generationAttempt.status, ["pending", "streaming"]),
            ),
          )
          .returning({ id: generationAttempt.id });
        return row;
      });
      if (!stopped) {
        throw new ChatDomainError(
          "CHAT_NOT_FOUND",
          "Active attempt not found.",
        );
      }
      activeControllers.get(input.attemptId)?.abort();
    },
  };
}

let generationServicePromise: Promise<GenerationService> | undefined;

async function initializeGenerationService(): Promise<GenerationService> {
  const [database, config] = await Promise.all([
    getDatabase(),
    getRuntimeConfig(),
  ]);
  return createGenerationService(database, {
    gateway: new OpenAiCompatibleGateway(config.secret.model),
    tokenCounter: createTokenCounter(config.secret.model.modelId),
    now: () => new Date(),
    idFactory: () => crypto.randomUUID(),
    config: {
      modelId: config.secret.model.modelId,
      platformRules: PLATFORM_RULES,
      promptTokenBudget: config.public.chat.promptTokenBudget,
      maxInputCharacters: config.public.chat.maxInputCharacters,
      maxOutputTokens: config.public.chat.maxOutputTokens,
      firstTokenTimeoutMs: config.public.chat.firstTokenTimeoutMs,
      requestTimeoutMs: config.public.chat.requestTimeoutMs,
    },
    logger: console,
    enqueueExtractionRuns: async () => {
      const boss = await getBoss(config.secret.databaseUrl);
      await ensureQueues(boss);
      return enqueuePendingExtractionRuns(database, boss, new Date());
    },
  });
}

export function getGenerationService(): Promise<GenerationService> {
  generationServicePromise ??= initializeGenerationService();
  return generationServicePromise;
}
