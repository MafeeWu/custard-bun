import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import { characterContentDigest } from "@/server/characters/content-digest";
import type { TokenCounter } from "@/server/chat/token-counter";
import type { Database } from "@/server/db/client";
import {
  character,
  characterVersion,
  chatSettings,
  conversation,
  conversationMessage,
  generationAttempt,
  memorySettings,
  user,
} from "@/server/db/schema";
import type { MemoryCandidate } from "@/server/memory/memory-contracts";
import { captureExtractionAdmission } from "@/server/memory/memory-extraction-service";
import type {
  ModelGateway,
  StructuredCompletionInput,
  StructuredCompletionResult,
} from "@/server/model-gateway/model-contract";

export const extractionNow = new Date("2026-10-10T08:00:00Z");
const content = {
  displayName: "Mira",
  avatarPath: "/characters/mira.svg",
  shortDescription: "A companion.",
  longDescription: "A kind companion.",
  personalityPrinciples: ["Listen."],
  speakingStyle: "Warm.",
  responseRhythm: "Short.",
  relationshipBoundaries: ["Respect autonomy."],
  openingMessage: "Hello.",
  exampleConversations: [{ user: "Hi.", assistant: "Hello." }],
  generationParameters: { temperature: 0.7, topP: 0.9, maxOutputTokens: 80 },
  safetyAdditions: ["Stay safe."],
};

export const extractionCounter: TokenCounter = {
  estimateText: (text) => Math.ceil(text.length / 4),
  estimateMessages: (messages) =>
    messages.reduce(
      (sum, message) => sum + Math.ceil(message.content.length / 4),
      0,
    ),
  withSafetyMargin: (tokens) => Math.ceil(tokens * 1.2),
  free: () => undefined,
};

export async function resetExtractionDatabase(database: Database) {
  await database.execute(sql`
    TRUNCATE chat_settings, memory_settings, characters, "user",
      usage_ledger, background_model_reservations, quota_buckets
    RESTART IDENTITY CASCADE
  `);
  await database.insert(chatSettings).values({
    id: "global",
    userDailyRequestLimit: 10,
    userDailyTokenLimit: 100_000,
    instanceMonthlyRequestLimit: 100,
    instanceMonthlyTokenBudget: 1_000_000,
    maxConcurrentGenerations: 4,
    deploymentDefaultUserDailyRequestLimit: 10,
    deploymentDefaultUserDailyTokenLimit: 100_000,
    deploymentDefaultInstanceMonthlyRequestLimit: 100,
    deploymentDefaultInstanceMonthlyTokenBudget: 1_000_000,
    deploymentDefaultMaxConcurrentGenerations: 4,
  });
  await database.insert(memorySettings).values({
    id: "global",
    enabled: true,
    deploymentDefaultEnabled: true,
    createdAt: new Date(extractionNow.getTime() - 1_000),
  });
}

export async function extractionFixture(database: Database) {
  const userId = randomUUID();
  const characterId = randomUUID();
  const characterVersionId = randomUUID();
  const conversationId = randomUUID();
  await database.insert(user).values({
    id: userId,
    name: "Memory User",
    role: "user",
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  await database
    .insert(character)
    .values({ id: characterId, slug: characterId });
  await database.insert(characterVersion).values({
    id: characterVersionId,
    characterId,
    versionNumber: 1,
    ...content,
    contentDigest: characterContentDigest(content),
    publishedAt: extractionNow,
  });
  await database
    .update(character)
    .set({ defaultVersionId: characterVersionId })
    .where(eq(character.id, characterId));
  await database.insert(conversation).values({
    id: conversationId,
    userId,
    characterId,
    characterVersionId,
  });
  return { userId, characterId, conversationId, characterVersionId };
}

export async function extractionAttempt(
  database: Database,
  fixture: { userId: string; conversationId: string },
  sequence = 1,
  userContent = "I prefer green tea.",
  status: typeof generationAttempt.$inferSelect.status = "complete",
) {
  const extractionMemoryEpoch = await database.transaction((tx) =>
    captureExtractionAdmission(tx, fixture),
  );
  const sourceMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const attemptId = randomUUID();
  await database.insert(conversationMessage).values([
    {
      id: sourceMessageId,
      conversationId: fixture.conversationId,
      sequence,
      role: "user",
      kind: "user",
      content: userContent,
      createdAt: extractionNow,
    },
    {
      id: assistantMessageId,
      conversationId: fixture.conversationId,
      sequence: sequence + 1,
      role: "assistant",
      kind: "generated",
      inReplyTo: sourceMessageId,
      createdAt: extractionNow,
    },
  ]);
  await database.insert(generationAttempt).values({
    id: attemptId,
    userId: fixture.userId,
    assistantMessageId,
    attemptNumber: 1,
    extractionMemoryEpoch,
    status,
    content: "I'll remember your preference.",
    modelId: "test-model",
    createdAt: extractionNow,
    completedAt:
      status === "pending" || status === "streaming" ? null : extractionNow,
  });
  return { attemptId, sourceMessageId, assistantMessageId };
}

export function extractionCandidate(
  sourceMessageId: string,
  overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
  return {
    type: "preference",
    content: "Likes green tea.",
    sourceMessageId,
    explicitness: "direct",
    sensitivity: "ordinary",
    userExplicitlyAskedToRemember: false,
    confidence: 80,
    importance: 70,
    ...overrides,
  };
}

export function extractionGateway(
  handler: (
    input: StructuredCompletionInput,
  ) => Promise<StructuredCompletionResult>,
): ModelGateway {
  return {
    async *stream() {
      throw new Error("Extraction must not stream.");
    },
    completeStructured: handler,
  };
}

export function extractionResult(
  candidates: unknown,
): StructuredCompletionResult {
  return {
    content: JSON.stringify({ candidates }),
    modelId: "test-model",
    providerRequestIds: ["private-provider-request-id"],
    inputTokens: 13,
    outputTokens: 7,
    latencyMs: 10,
  };
}

export async function waitForExtractionLock(database: Database, name: string) {
  let query = "";
  await expect
    .poll(
      async () => {
        const result = await database.$client.query<{ query: string }>(
          "SELECT query FROM pg_stat_activity WHERE application_name = $1 AND state = 'active' AND wait_event_type = 'Lock'",
          [name],
        );
        query = result.rows[0]?.query ?? "";
        return query.length > 0;
      },
      { timeout: 3_000 },
    )
    .toBe(true);
  return query;
}
