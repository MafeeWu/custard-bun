// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { characterContentDigest } from "@/server/characters/content-digest";
import { ChatDomainError } from "@/server/chat/chat-errors";
import type { TokenCounter } from "@/server/chat/token-counter";
import { createDatabase } from "@/server/db/client";
import {
  character,
  characterVersion,
  chatSettings,
  conversation,
  conversationMessage,
  generationAttempt,
  generationLease,
  quotaReservation,
  usageLedger,
  user,
} from "@/server/db/schema";
import type {
  GatewayStreamEvent,
  ModelGateway,
  ModelGatewayStreamInput,
} from "@/server/model-gateway/model-contract";
import { ModelGatewayError } from "@/server/model-gateway/model-error";
import { testDatabaseUrl } from "@/test/database-target";
import {
  createGenerationService,
  type GenerationService,
} from "./generation-service";
import {
  deleteUserWithGenerationSettlement,
  reconcileExpiredLeases,
} from "./quota-service";

const database = createDatabase(testDatabaseUrl());
const baseNow = new Date("2026-10-09T12:00:00.000Z");

const characterContent = {
  displayName: "Mira",
  avatarPath: "/characters/mira.svg",
  shortDescription: "A calm companion.",
  longDescription: "A calm companion who listens carefully.",
  personalityPrinciples: ["Listen first."],
  speakingStyle: "Warm and direct.",
  responseRhythm: "Short paragraphs.",
  relationshipBoundaries: ["Do not encourage dependency."],
  openingMessage: "What would you like to talk about?",
  exampleConversations: [
    { user: "Hello", assistant: "Hello. How are you feeling?" },
  ],
  generationParameters: {
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: 80,
  },
  safetyAdditions: ["Use grounding language."],
};

const tokenCounter: TokenCounter = {
  estimateText: (value) => Math.max(1, Math.ceil(value.length / 4)),
  estimateMessages: (messages) =>
    messages.reduce((total, message) => total + message.content.length, 0),
  withSafetyMargin: (tokens) => Math.ceil(tokens * 1.2),
  free: () => undefined,
};

class FakeGateway implements ModelGateway {
  readonly inputs: ModelGatewayStreamInput[] = [];

  constructor(
    private readonly handler: (
      input: ModelGatewayStreamInput,
    ) => AsyncGenerator<GatewayStreamEvent, void>,
  ) {}

  stream(input: ModelGatewayStreamInput) {
    this.inputs.push(input);
    return this.handler(input);
  }
}

beforeEach(async () => {
  await database.execute(
    sql.raw(`
      TRUNCATE TABLE
        usage_ledger,
        generation_leases,
        quota_reservations,
        quota_buckets,
        user_chat_quota_overrides,
        chat_settings,
        generation_attempts,
        conversation_messages,
        conversations,
        character_drafts,
        character_versions,
        characters,
        "user"
      RESTART IDENTITY CASCADE
    `),
  );
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
});

afterAll(async () => {
  await database.$client.end();
});

async function insertUser(options: { banned?: boolean } = {}) {
  const id = randomUUID();
  await database.insert(user).values({
    id,
    name: "Chat User",
    email: `${id}@example.com`,
    emailVerified: true,
    banned: options.banned ?? false,
  });
  return id;
}

async function insertConversation(userId: string) {
  const characterId = randomUUID();
  const versionId = randomUUID();
  const conversationId = randomUUID();
  await database.insert(character).values({
    id: characterId,
    slug: randomUUID(),
  });
  await database.insert(characterVersion).values({
    id: versionId,
    characterId,
    versionNumber: 1,
    ...characterContent,
    contentDigest: characterContentDigest(characterContent),
    publishedAt: baseNow,
  });
  await database
    .update(character)
    .set({ defaultVersionId: versionId })
    .where(eq(character.id, characterId));
  await database.insert(conversation).values({
    id: conversationId,
    userId,
    characterId,
    characterVersionId: versionId,
    createdAt: baseNow,
    updatedAt: baseNow,
    lastMessageAt: baseNow,
  });
  await database.insert(conversationMessage).values({
    id: randomUUID(),
    conversationId,
    sequence: 1,
    role: "assistant",
    kind: "opening",
    content: characterContent.openingMessage,
    createdAt: baseNow,
  });
  return conversationId;
}

function serviceWith(
  gateway: ModelGateway,
  options: {
    now?: () => Date;
    logger?: { error(message: string, metadata?: Record<string, unknown>): void };
  } = {},
): GenerationService {
  return createGenerationService(database, {
    gateway,
    tokenCounter,
    now: options.now ?? (() => baseNow),
    idFactory: () => randomUUID(),
    config: {
      modelId: "test-model",
      platformRules: "Platform rules:\n- Stay safe.",
      promptTokenBudget: 4_000,
      maxInputCharacters: 10_000,
      maxOutputTokens: 100,
      firstTokenTimeoutMs: 5_000,
      requestTimeoutMs: 30_000,
    },
    logger: options.logger ?? { error: vi.fn() },
  });
}

async function collect(
  stream: AsyncGenerator<unknown, void>,
): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function successfulGateway(events?: GatewayStreamEvent[]) {
  return new FakeGateway(async function* () {
    for (const event of events ?? [
      { type: "provider-call", callNumber: 1 },
      { type: "request-id", requestId: "provider-request-1" },
      { type: "delta", text: "Hello" },
      {
        type: "usage",
        inputTokens: 12,
        outputTokens: 3,
        estimated: false,
      },
    ]) {
      yield event;
    }
  });
}

describe("GenerationService", () => {
  test("commits the turn, reservation, and lease before provider contact and completes with provider usage", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    let rowsAtProviderStart:
      | {
          messages: number;
          attempts: number;
          reservations: number;
          leases: number;
        }
      | undefined;
    const gateway = new FakeGateway(async function* () {
      rowsAtProviderStart = {
        messages: (await database.select().from(conversationMessage)).length,
        attempts: (await database.select().from(generationAttempt)).length,
        reservations: (await database.select().from(quotaReservation)).length,
        leases: (await database.select().from(generationLease)).length,
      };
      yield { type: "provider-call", callNumber: 1 };
      yield { type: "request-id", requestId: "provider-request-1" };
      yield { type: "delta", text: "Hello" };
      yield {
        type: "usage",
        inputTokens: 12,
        outputTokens: 3,
        estimated: false,
      };
    });

    const events = await collect(
      serviceWith(gateway).startNewMessage({
        userId,
        conversationId,
        clientRequestId: randomUUID(),
        content: "Hi",
        signal: new AbortController().signal,
      }),
    );

    expect(rowsAtProviderStart).toEqual({
      messages: 3,
      attempts: 1,
      reservations: 1,
      leases: 1,
    });
    expect(events).toEqual([
      { type: "started", attemptId: expect.any(String) },
      { type: "delta", attemptId: expect.any(String), text: "Hello" },
      {
        type: "completed",
        attemptId: expect.any(String),
        usage: { inputTokens: 12, outputTokens: 3, estimated: false },
      },
    ]);
    const [attempt] = await database.select().from(generationAttempt);
    expect(attempt).toMatchObject({
      status: "complete",
      content: "Hello",
      providerRequestId: "provider-request-1",
      inputTokens: 12,
      outputTokens: 3,
      usageIsEstimated: false,
    });
    expect(await database.select().from(generationLease)).toHaveLength(0);
  });

  test("rejects an active idempotency replay with existing identifiers and never starts a second provider stream", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    const clientRequestId = randomUUID();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gateway = new FakeGateway(async function* () {
      yield { type: "provider-call", callNumber: 1 };
      await gate;
    });
    const service = serviceWith(gateway);
    const first = service.startNewMessage({
      userId,
      conversationId,
      clientRequestId,
      content: "Hi",
      signal: new AbortController().signal,
    });
    const started = await first.next();

    await expect(
      service
        .startNewMessage({
          userId,
          conversationId,
          clientRequestId,
          content: "Hi again",
          signal: new AbortController().signal,
        })
        .next(),
    ).rejects.toMatchObject({
      code: "CHAT_GENERATION_IN_PROGRESS",
      metadata: {
        attemptId: started.value?.attemptId,
        conversationId,
      },
    });
    expect(gateway.inputs).toHaveLength(0);

    release();
    await collect(first);
    expect(gateway.inputs).toHaveLength(1);
  });

  test("resolves a reused idempotency key to the owning conversation", async () => {
    const userId = await insertUser();
    const owningConversationId = await insertConversation(userId);
    const otherConversationId = await insertConversation(userId);
    const clientRequestId = randomUUID();
    const gateway = successfulGateway();
    const service = serviceWith(gateway);
    const first = service.startNewMessage({
      userId,
      conversationId: owningConversationId,
      clientRequestId,
      content: "Hi",
      signal: new AbortController().signal,
    });
    const started = await first.next();

    await expect(
      service
        .startNewMessage({
          userId,
          conversationId: otherConversationId,
          clientRequestId,
          content: "Duplicate",
          signal: new AbortController().signal,
        })
        .next(),
    ).rejects.toMatchObject({
      code: "CHAT_GENERATION_IN_PROGRESS",
      metadata: {
        attemptId: started.value?.attemptId,
        conversationId: owningConversationId,
      },
    });
    await collect(first);
  });

  test("replays a persisted terminal event without contacting the provider twice", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    const clientRequestId = randomUUID();
    const gateway = successfulGateway();
    const service = serviceWith(gateway);
    await collect(
      service.startNewMessage({
        userId,
        conversationId,
        clientRequestId,
        content: "Hi",
        signal: new AbortController().signal,
      }),
    );

    const replay = await collect(
      service.startNewMessage({
        userId,
        conversationId,
        clientRequestId,
        content: "ignored",
        signal: new AbortController().signal,
      }),
    );

    expect(replay).toEqual([
      {
        type: "completed",
        attemptId: expect.any(String),
        usage: { inputTokens: 12, outputTokens: 3, estimated: false },
      },
    ]);
    expect(gateway.inputs).toHaveLength(1);
  });

  test("checkpoints partial output after one KiB and estimates missing usage", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    const chunk = "x".repeat(1_024);
    let checkpointedContent = "";
    const gateway = new FakeGateway(async function* () {
      yield { type: "provider-call", callNumber: 1 };
      yield { type: "delta", text: chunk };
      const [attempt] = await database.select().from(generationAttempt);
      checkpointedContent = attempt!.content;
    });

    const events = await collect(
      serviceWith(gateway).startNewMessage({
        userId,
        conversationId,
        clientRequestId: randomUUID(),
        content: "Hi",
        signal: new AbortController().signal,
      }),
    );

    expect(checkpointedContent).toBe(chunk);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      usage: { estimated: true, outputTokens: 308 },
    });
    const [ledger] = await database.select().from(usageLedger);
    expect(ledger!.usageIsEstimated).toBe(true);
  });

  test("checkpoints partial output after 500ms", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    let milliseconds = baseNow.getTime();
    const gateway = new FakeGateway(async function* () {
      yield { type: "provider-call", callNumber: 1 };
      yield { type: "delta", text: "one" };
      milliseconds += 500;
      yield { type: "delta", text: " two" };
      const [attempt] = await database.select().from(generationAttempt);
      expect(attempt!.content).toBe("one two");
    });

    await collect(
      serviceWith(gateway, {
        now: () => new Date(milliseconds),
      }).startNewMessage({
        userId,
        conversationId,
        clientRequestId: randomUUID(),
        content: "Hi",
        signal: new AbortController().signal,
      }),
    );
  });

  test("stop records cancellation, aborts the local gateway, flushes partial text, and settles interrupted", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    const gateway = new FakeGateway(async function* (input) {
      yield { type: "provider-call", callNumber: 1 };
      yield { type: "delta", text: "partial" };
      await new Promise<void>((_resolve, reject) => {
        if (input.signal.aborted) {
          reject(new ModelGatewayError("cancelled"));
          return;
        }
        input.signal.addEventListener(
          "abort",
          () => reject(new ModelGatewayError("cancelled")),
          { once: true },
        );
      });
    });
    const service = serviceWith(gateway);
    const stream = service.startNewMessage({
      userId,
      conversationId,
      clientRequestId: randomUUID(),
      content: "Hi",
      signal: new AbortController().signal,
    });
    const started = await stream.next();
    await stream.next();

    await service.stop({
      userId,
      attemptId: started.value!.attemptId,
    });
    const terminal = await stream.next();

    expect(terminal.value).toMatchObject({
      type: "interrupted",
      code: "CHAT_STREAM_INTERRUPTED",
    });
    const [attempt] = await database.select().from(generationAttempt);
    expect(attempt).toMatchObject({
      status: "interrupted",
      content: "partial",
      cancelRequestedAt: expect.any(Date),
    });
    expect(await database.select().from(generationLease)).toHaveLength(0);
  });

  test("browser abort follows the interrupted settlement path", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    const browser = new AbortController();
    const gateway = new FakeGateway(async function* (input) {
      yield { type: "provider-call", callNumber: 1 };
      yield { type: "delta", text: "partial" };
      await new Promise<void>((_resolve, reject) => {
        if (input.signal.aborted) {
          reject(new ModelGatewayError("cancelled"));
          return;
        }
        input.signal.addEventListener(
          "abort",
          () => reject(new ModelGatewayError("cancelled")),
          { once: true },
        );
      });
    });
    const stream = serviceWith(gateway).startNewMessage({
      userId,
      conversationId,
      clientRequestId: randomUUID(),
      content: "Hi",
      signal: browser.signal,
    });
    await stream.next();
    await stream.next();

    browser.abort();
    const terminal = await stream.next();

    expect(terminal.value).toMatchObject({ type: "interrupted" });
    const [attempt] = await database.select().from(generationAttempt);
    expect(attempt).toMatchObject({
      status: "interrupted",
      content: "partial",
    });
  });

  test("observes a stop requested by another process after the final provider chunk", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    let finishProvider!: () => void;
    const gate = new Promise<void>((resolve) => {
      finishProvider = resolve;
    });
    const gateway = new FakeGateway(async function* () {
      yield { type: "provider-call", callNumber: 1 };
      yield { type: "delta", text: "partial" };
      await gate;
    });
    const firstProcess = serviceWith(gateway);
    const secondProcess = serviceWith(successfulGateway());
    const stream = firstProcess.startNewMessage({
      userId,
      conversationId,
      clientRequestId: randomUUID(),
      content: "Hi",
      signal: new AbortController().signal,
    });
    const started = await stream.next();
    await stream.next();

    await secondProcess.stop({
      userId,
      attemptId: started.value!.attemptId,
    });
    finishProvider();
    const terminal = await stream.next();

    expect(terminal.value).toMatchObject({
      type: "interrupted",
      code: "CHAT_STREAM_INTERRUPTED",
    });
    const [attempt] = await database.select().from(generationAttempt);
    expect(attempt!.status).toBe("interrupted");
  });

  test("records the gateway's automatic retry and completes after the second provider call", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    const gateway = successfulGateway([
      { type: "provider-call", callNumber: 1 },
      { type: "request-id", requestId: "failed-call" },
      { type: "provider-call", callNumber: 2 },
      { type: "request-id", requestId: "successful-call" },
      { type: "delta", text: "ok" },
      {
        type: "usage",
        inputTokens: 10,
        outputTokens: 1,
        estimated: false,
      },
    ]);

    await collect(
      serviceWith(gateway).startNewMessage({
        userId,
        conversationId,
        clientRequestId: randomUUID(),
        content: "Hi",
        signal: new AbortController().signal,
      }),
    );

    const calls = await database
      .select()
      .from(usageLedger)
      .orderBy(usageLedger.providerCallNumber);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      providerCallNumber: 2,
      automaticRetryCount: 1,
      inputTokens: 10,
      outputTokens: 1,
    });
  });

  test("provider failure after a delta becomes interrupted and preserves safe error output", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    const gateway = new FakeGateway(async function* () {
      yield { type: "provider-call", callNumber: 1 };
      yield { type: "delta", text: "partial" };
      throw new ModelGatewayError("interrupted", {
        providerRequestId: "safe-request-id",
      });
    });

    const events = await collect(
      serviceWith(gateway).startNewMessage({
        userId,
        conversationId,
        clientRequestId: randomUUID(),
        content: "secret prompt",
        signal: new AbortController().signal,
      }),
    );

    expect(events.at(-1)).toEqual({
      type: "interrupted",
      attemptId: expect.any(String),
      code: "CHAT_STREAM_INTERRUPTED",
      message: "The response stream ended before completion.",
      retryable: true,
    });
    expect(JSON.stringify(events)).not.toContain("secret prompt");
  });

  test("does not reclassify or swallow settlement failure and logs identifiers only", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    const logger = { error: vi.fn() };
    const gateway = new FakeGateway(async function* () {
      yield { type: "provider-call", callNumber: 1 };
      yield { type: "delta", text: "private partial text" };
      const [attempt] = await database.select().from(generationAttempt);
      await database
        .update(generationLease)
        .set({ ownerToken: "unexpected-owner" })
        .where(eq(generationLease.attemptId, attempt!.id));
    });

    await expect(
      collect(
        serviceWith(gateway, { logger }).startNewMessage({
          userId,
          conversationId,
          clientRequestId: randomUUID(),
          content: "private prompt",
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toMatchObject({ code: "CHAT_INTERNAL" });
    expect(logger.error).toHaveBeenCalledWith(
      "generation settlement failed",
      {
        attemptId: expect.any(String),
        conversationId,
        name: "UnknownError",
      },
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private");
  });

  test("manual retry replaces only the current failed attempt and increments the attempt number atomically", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    const failingGateway = new FakeGateway(async function* () {
      yield { type: "provider-call", callNumber: 1 };
      throw new ModelGatewayError("authentication");
    });
    const firstService = serviceWith(failingGateway);
    const firstEvents = await collect(
      firstService.startNewMessage({
        userId,
        conversationId,
        clientRequestId: randomUUID(),
        content: "Hi",
        signal: new AbortController().signal,
      }),
    );
    const firstAttemptId = (firstEvents[0] as { attemptId: string }).attemptId;

    const retryGateway = successfulGateway();
    const retryEvents = await collect(
      serviceWith(retryGateway).retry({
        userId,
        conversationId,
        clientRequestId: randomUUID(),
        attemptId: firstAttemptId,
        signal: new AbortController().signal,
      }),
    );

    const attempts = await database
      .select()
      .from(generationAttempt)
      .orderBy(generationAttempt.attemptNumber);
    expect(attempts).toMatchObject([
      {
        id: firstAttemptId,
        attemptNumber: 1,
        status: "failed",
        isCurrent: false,
      },
      {
        id: (retryEvents[0] as { attemptId: string }).attemptId,
        attemptNumber: 2,
        status: "complete",
        isCurrent: true,
      },
    ]);
    await expect(
      serviceWith(successfulGateway())
        .retry({
          userId,
          conversationId,
          clientRequestId: randomUUID(),
          attemptId: firstAttemptId,
          signal: new AbortController().signal,
        })
        .next(),
    ).rejects.toMatchObject({ code: "CHAT_NOT_FOUND" });
  });

  test.each([
    ["disabled user", "disabled"],
    ["archived conversation", "archived"],
    ["wrong owner", "wrong-owner"],
  ] as const)("%s fails before provider contact", async (_label, mode) => {
    const ownerId = await insertUser({ banned: mode === "disabled" });
    const requesterId =
      mode === "wrong-owner" ? await insertUser() : ownerId;
    const conversationId = await insertConversation(ownerId);
    if (mode === "archived") {
      await database
        .update(conversation)
        .set({ lifecycle: "archived", archivedAt: baseNow })
        .where(eq(conversation.id, conversationId));
    }
    const gateway = successfulGateway();

    await expect(
      serviceWith(gateway)
        .startNewMessage({
          userId: requesterId,
          conversationId,
          clientRequestId: randomUUID(),
          content: "Hi",
          signal: new AbortController().signal,
        })
        .next(),
    ).rejects.toBeInstanceOf(ChatDomainError);
    expect(gateway.inputs).toHaveLength(0);
    expect(
      await database
        .select()
        .from(conversationMessage)
        .where(eq(conversationMessage.kind, "user")),
    ).toHaveLength(0);
  });

  test("a second concurrent generation fails before provider contact", async () => {
    const userId = await insertUser();
    const firstConversationId = await insertConversation(userId);
    const secondConversationId = await insertConversation(userId);
    const gateway = successfulGateway();
    const service = serviceWith(gateway);
    const first = service.startNewMessage({
      userId,
      conversationId: firstConversationId,
      clientRequestId: randomUUID(),
      content: "First",
      signal: new AbortController().signal,
    });
    await first.next();

    await expect(
      service
        .startNewMessage({
          userId,
          conversationId: secondConversationId,
          clientRequestId: randomUUID(),
          content: "Second",
          signal: new AbortController().signal,
        })
        .next(),
    ).rejects.toMatchObject({ code: "CHAT_GENERATION_IN_PROGRESS" });
    expect(gateway.inputs).toHaveLength(0);
    await collect(first);
  });

  test("account deletion between chunks cancels safely without another visible delta or orphan", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    let continueStream!: () => void;
    const gate = new Promise<void>((resolve) => {
      continueStream = resolve;
    });
    const gateway = new FakeGateway(async function* () {
      yield { type: "provider-call", callNumber: 1 };
      yield { type: "delta", text: "visible" };
      await gate;
      yield { type: "delta", text: "must-not-be-visible" };
    });
    const stream = serviceWith(gateway).startNewMessage({
      userId,
      conversationId,
      clientRequestId: randomUUID(),
      content: "Hi",
      signal: new AbortController().signal,
    });
    await stream.next();
    await stream.next();

    await deleteUserWithGenerationSettlement(database, userId, baseNow);
    continueStream();
    const remaining = await collect(stream);

    expect(JSON.stringify(remaining)).not.toContain("must-not-be-visible");
    expect(await database.select().from(generationLease)).toHaveLength(0);
    expect(await database.select().from(quotaReservation)).toHaveLength(0);
  });

  test("a crashed stream is reconciled exactly once after lease expiry", async () => {
    const userId = await insertUser();
    const conversationId = await insertConversation(userId);
    const stream = serviceWith(successfulGateway()).startNewMessage({
      userId,
      conversationId,
      clientRequestId: randomUUID(),
      content: "Hi",
      signal: new AbortController().signal,
    });
    const started = await stream.next();
    await stream.return();
    const expiredAt = new Date(baseNow.getTime() - 1);
    await database
      .update(generationLease)
      .set({ expiresAt: expiredAt })
      .where(
        eq(
          generationLease.attemptId,
          (started.value as { attemptId: string }).attemptId,
        ),
      );

    expect(await reconcileExpiredLeases(database, baseNow)).toBe(1);
    expect(await reconcileExpiredLeases(database, baseNow)).toBe(0);
    const [attempt] = await database
      .select()
      .from(generationAttempt)
      .where(
        eq(
          generationAttempt.id,
          (started.value as { attemptId: string }).attemptId,
        ),
      );
    expect(attempt!.status).toBe("interrupted");
    expect(
      await database
        .select()
        .from(quotaReservation)
        .where(
          and(
            eq(
              quotaReservation.attemptId,
              (started.value as { attemptId: string }).attemptId,
            ),
            eq(quotaReservation.status, "settled"),
          ),
        ),
    ).toHaveLength(1);
  });
});
