// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  character,
  characterVersion,
  chatSettings,
  conversation,
  conversationMessage,
  generationAttempt,
  quotaBucket,
  usageLedger,
  user,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import { getUsageDashboard } from "./usage-queries";

const database = createDatabase(testDatabaseUrl());
const now = new Date("2026-10-09T14:00:00Z");
const secretPhrase = "SECRET TRANSCRIPT PHRASE 91c64";

beforeEach(async () => {
  await database.execute(sql`
    TRUNCATE TABLE
      admin_audit_events,
      usage_ledger,
      quota_reservations,
      generation_leases,
      quota_buckets,
      user_chat_quota_overrides,
      chat_settings,
      generation_attempts,
      conversation_messages,
      conversations,
      character_drafts,
      character_versions,
      characters,
      session,
      account,
      "user"
    RESTART IDENTITY CASCADE
  `);
  await database.insert(chatSettings).values({
    id: "global",
    revision: 1,
    userDailyRequestLimit: 100,
    userDailyTokenLimit: 10_000,
    instanceMonthlyRequestLimit: 1_000,
    instanceMonthlyTokenBudget: 100_000,
    maxConcurrentGenerations: 4,
    deploymentDefaultUserDailyRequestLimit: 100,
    deploymentDefaultUserDailyTokenLimit: 10_000,
    deploymentDefaultInstanceMonthlyRequestLimit: 1_000,
    deploymentDefaultInstanceMonthlyTokenBudget: 100_000,
    deploymentDefaultMaxConcurrentGenerations: 4,
  });
});

afterAll(async () => {
  await database.$client.end();
});

test("returns current aggregate numeric usage without exposing transcript data", async () => {
  await database.insert(user).values({
    id: "ordinary-1",
    name: "Ordinary",
    email: "ordinary@example.com",
    emailVerified: true,
    role: "user",
  });
  await database.insert(character).values({
    id: "character-1",
    slug: "listener",
  });
  await database.insert(characterVersion).values({
    id: "version-1",
    characterId: "character-1",
    versionNumber: 1,
    displayName: "Listener",
    avatarPath: "/listener.png",
    shortDescription: "Short",
    longDescription: "Long",
    personalityPrinciples: ["Kind"],
    speakingStyle: "Warm",
    responseRhythm: "Measured",
    relationshipBoundaries: ["No dependency"],
    openingMessage: "Hello",
    exampleConversations: [],
    generationParameters: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 100,
    },
    safetyAdditions: [],
    contentDigest: "a".repeat(64),
    publishedBy: "admin@example.com",
    publishedAt: now,
  });
  await database
    .update(character)
    .set({ defaultVersionId: "version-1" })
    .where(eq(character.id, "character-1"));
  await database.insert(conversation).values({
    id: "conversation-secret",
    userId: "ordinary-1",
    characterId: "character-1",
    characterVersionId: "version-1",
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  });
  await database.insert(conversationMessage).values({
    id: "message-secret",
    conversationId: "conversation-secret",
    sequence: 1,
    role: "user",
    kind: "user",
    content: secretPhrase,
    clientRequestId: "request-secret",
    createdAt: now,
  });
  await database.insert(conversationMessage).values({
    id: "assistant-message-active",
    conversationId: "conversation-secret",
    sequence: 2,
    role: "assistant",
    kind: "generated",
    inReplyTo: "message-secret",
    createdAt: now,
  });
  await database.insert(generationAttempt).values({
    id: "attempt-active",
    userId: "ordinary-1",
    assistantMessageId: "assistant-message-active",
    clientRequestId: "attempt-active-request",
    attemptNumber: 1,
    status: "streaming",
    content: "",
    modelId: "model-a",
    leaseExpiresAt: new Date("2026-10-09T14:05:00Z"),
    leaseOwner: "owner",
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(usageLedger).values([
    {
      id: "ledger-1",
      userId: "ordinary-1",
      conversationId: "conversation-secret",
      periodStart: new Date("2026-10-09T00:00:00Z"),
      periodEnd: new Date("2026-10-10T00:00:00Z"),
      userRequestUnits: 1,
      providerCallNumber: 1,
      inputTokens: 100,
      outputTokens: 20,
      usageIsEstimated: false,
      modelId: "model-a",
      outcome: "complete",
      automaticRetryCount: 0,
      latencyMs: 100,
      createdAt: new Date("2026-10-09T10:00:00Z"),
    },
    {
      id: "ledger-2",
      userId: "ordinary-1",
      conversationId: "conversation-secret",
      periodStart: new Date("2026-10-09T00:00:00Z"),
      periodEnd: new Date("2026-10-10T00:00:00Z"),
      userRequestUnits: 1,
      providerCallNumber: 1,
      inputTokens: 50,
      outputTokens: 10,
      usageIsEstimated: true,
      modelId: "model-b",
      outcome: "failed",
      errorCategory: "provider_unavailable",
      automaticRetryCount: 1,
      latencyMs: 300,
      createdAt: new Date("2026-10-09T11:00:00Z"),
    },
    {
      id: "ledger-3",
      userId: "ordinary-1",
      conversationId: "conversation-secret",
      periodStart: new Date("2026-10-08T00:00:00Z"),
      periodEnd: new Date("2026-10-09T00:00:00Z"),
      userRequestUnits: 1,
      providerCallNumber: 1,
      inputTokens: 25,
      outputTokens: 5,
      usageIsEstimated: false,
      modelId: "model-a",
      outcome: "interrupted",
      errorCategory: "stream_interrupted",
      automaticRetryCount: 2,
      latencyMs: 200,
      createdAt: new Date("2026-10-08T12:00:00Z"),
    },
    {
      id: "ledger-old",
      userId: "ordinary-1",
      conversationId: "conversation-secret",
      periodStart: new Date("2026-09-30T00:00:00Z"),
      periodEnd: new Date("2026-10-01T00:00:00Z"),
      userRequestUnits: 9,
      providerCallNumber: 1,
      inputTokens: 999,
      outputTokens: 999,
      usageIsEstimated: false,
      modelId: "old-model",
      outcome: "complete",
      automaticRetryCount: 0,
      latencyMs: 1,
      createdAt: new Date("2026-09-30T12:00:00Z"),
    },
  ]);
  await database.insert(quotaBucket).values([
    {
      id: "user:ordinary-1:2026-10-09",
      scope: "user",
      userId: "ordinary-1",
      periodStart: new Date("2026-10-09T00:00:00Z"),
      periodEnd: new Date("2026-10-10T00:00:00Z"),
      consumedRequests: 2,
      consumedTokens: 180,
    },
    {
      id: "instance:global:2026-10",
      scope: "instance",
      periodStart: new Date("2026-10-01T00:00:00Z"),
      periodEnd: new Date("2026-11-01T00:00:00Z"),
      consumedRequests: 3,
      consumedTokens: 210,
    },
  ]);
  await database.execute(sql`
    INSERT INTO generation_leases
      (attempt_id, user_id, owner_token, expires_at, created_at, updated_at)
    VALUES
      ('attempt-active', 'ordinary-1', 'owner', ${new Date("2026-10-09T14:05:00Z")}, ${now}, ${now})
  `);

  const dashboard = await getUsageDashboard(database, now);

  expect(dashboard).toEqual({
    userDay: { requests: 2, inputTokens: 150, outputTokens: 30 },
    instanceMonth: { requests: 3, inputTokens: 175, outputTokens: 35 },
    activeGenerations: 1,
    outcomes: { complete: 1, failed: 1, interrupted: 1 },
    failures: [
      { category: "provider_unavailable", count: 1 },
      { category: "stream_interrupted", count: 1 },
    ],
    automaticRetries: 3,
    estimatedUsageRows: 1,
    latencyMs: { p50: 200, p95: 290 },
    modelIds: ["model-a", "model-b"],
  });
  expect(JSON.stringify(dashboard)).not.toContain(secretPhrase);
  expect(Object.keys(dashboard)).not.toContain("messages");
});

test("keeps de-identified totals after account and conversation deletion", async () => {
  await database.insert(user).values({
    id: "ordinary-delete",
    name: "Delete",
    email: "delete@example.com",
    emailVerified: true,
    role: "user",
  });
  await database.insert(usageLedger).values({
    id: "ledger-retained",
    userId: "ordinary-delete",
    periodStart: new Date("2026-10-09T00:00:00Z"),
    periodEnd: new Date("2026-10-10T00:00:00Z"),
    userRequestUnits: 1,
    providerCallNumber: 1,
    inputTokens: 12,
    outputTokens: 3,
    usageIsEstimated: false,
    modelId: "model-retained",
    outcome: "complete",
    createdAt: now,
  });

  await database.delete(user).where(eq(user.id, "ordinary-delete"));

  await expect(getUsageDashboard(database, now)).resolves.toMatchObject({
    userDay: { requests: 1, inputTokens: 12, outputTokens: 3 },
    instanceMonth: { requests: 1, inputTokens: 12, outputTokens: 3 },
  });
});

test("counts generation outcomes once when an automatic retry creates another ledger row", async () => {
  await database.insert(usageLedger).values([
    {
      id: "retry-call-1",
      periodStart: new Date("2026-10-09T00:00:00Z"),
      periodEnd: new Date("2026-10-10T00:00:00Z"),
      userRequestUnits: 1,
      providerCallNumber: 1,
      inputTokens: 10,
      outputTokens: 0,
      usageIsEstimated: false,
      modelId: "model-a",
      outcome: "complete",
      errorCategory: "provider_unavailable",
      automaticRetryCount: 0,
      latencyMs: 100,
      createdAt: now,
    },
    {
      id: "retry-call-2",
      periodStart: new Date("2026-10-09T00:00:00Z"),
      periodEnd: new Date("2026-10-10T00:00:00Z"),
      userRequestUnits: 0,
      providerCallNumber: 2,
      inputTokens: 10,
      outputTokens: 5,
      usageIsEstimated: false,
      modelId: "model-a",
      outcome: "complete",
      automaticRetryCount: 1,
      latencyMs: 200,
      createdAt: now,
    },
  ]);

  await expect(getUsageDashboard(database, now)).resolves.toMatchObject({
    userDay: { requests: 1, inputTokens: 20, outputTokens: 5 },
    outcomes: { complete: 1, failed: 0, interrupted: 0 },
    automaticRetries: 1,
  });
});

test("attributes usage to the reserved UTC period instead of settlement time", async () => {
  await database.insert(usageLedger).values({
    id: "late-settlement",
    periodStart: new Date("2026-10-08T00:00:00Z"),
    periodEnd: new Date("2026-10-09T00:00:00Z"),
    userRequestUnits: 1,
    providerCallNumber: 1,
    inputTokens: 10,
    outputTokens: 5,
    usageIsEstimated: false,
    modelId: "model-a",
    outcome: "complete",
    createdAt: new Date("2026-10-09T00:00:01Z"),
  });

  await expect(getUsageDashboard(database, now)).resolves.toMatchObject({
    userDay: { requests: 0, inputTokens: 0, outputTokens: 0 },
    instanceMonth: { requests: 1, inputTokens: 10, outputTokens: 5 },
  });
});
