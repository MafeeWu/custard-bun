import { afterEach, describe, expect, test } from "vitest";
import { ChatDomainError } from "./chat-errors";
import {
  createFailedChatStreamEvent,
  createInterruptedChatStreamEvent,
  type ChatStreamEvent,
} from "./chat-events";
import { createTokenCounter, type TokenCounter } from "./token-counter";

describe("chat stream events", () => {
  test("preserve the stable event order contracts", () => {
    const events: ChatStreamEvent[] = [
      { type: "started", attemptId: "attempt-1" },
      { type: "delta", attemptId: "attempt-1", text: "Hello" },
      {
        type: "completed",
        attemptId: "attempt-1",
        usage: { inputTokens: 12, outputTokens: 3, estimated: false },
      },
    ];

    expect(events.map((event) => event.type)).toEqual([
      "started",
      "delta",
      "completed",
    ]);
  });

  test("keeps failed and interrupted payloads provider-safe", () => {
    const failed = createFailedChatStreamEvent(
      "attempt-1",
      new ChatDomainError(
        "CHAT_PROVIDER_TIMEOUT",
        "provider said rawBody={...} apiKey=secret",
        {
          retryable: true,
          resetAt: new Date("2026-10-09T16:00:00.000Z"),
          metadata: {
            rawBody: '{"secret":true}',
            responseBody: "timed out",
            authorizationHeader: "Bearer secret",
          },
        },
      ),
    );
    const interrupted = createInterruptedChatStreamEvent(
      "attempt-1",
      new ChatDomainError(
        "CHAT_STREAM_INTERRUPTED",
        "provider stream closed with responseBody=oops",
        {
          retryable: true,
          metadata: {
            providerRawContent: "sensitive delta",
          },
        },
      ),
    );

    expect(failed).not.toHaveProperty("metadata");
    expect(interrupted).not.toHaveProperty("metadata");
    expect(failed.message).toBe("The model provider took too long to respond.");
    expect(interrupted.message).toBe(
      "The response stream ended before completion.",
    );
  });
});

describe("ChatDomainError", () => {
  test("serializes stable codes, safe copy, and safe metadata", () => {
    const error = new ChatDomainError(
      "CHAT_PROVIDER_TIMEOUT",
      "provider said apiKey=abc rawBody={...}",
      {
        retryable: true,
        resetAt: new Date("2026-10-09T16:00:00.000Z"),
        metadata: {
          apiKey: "abc",
          rawBody: '{"secret":true}',
          responseBody: '{"error":"timeout"}',
          authorizationHeader: "Bearer top-secret",
          credentialScope: "model",
          providerMessage: "provider leaked details",
          providerRawContent: "sensitive chunk",
          providerStatus: 504,
          provider: "gateway-a",
          requestId: "req-123",
          prompt: "secret prompt",
          nested: { unsafe: true },
        },
      },
    );

    expect(error.toJSON()).toEqual({
      code: "CHAT_PROVIDER_TIMEOUT",
      message: "The model provider took too long to respond.",
      retryable: true,
      resetAt: "2026-10-09T16:00:00.000Z",
      metadata: {
        providerStatus: 504,
        provider: "gateway-a",
        requestId: "req-123",
      },
    });
  });
});

describe("createTokenCounter", () => {
  let counter: TokenCounter | undefined;

  afterEach(() => {
    counter?.free();
    counter = undefined;
  });

  test("counts text, role overhead, and a safety margin", () => {
    counter = createTokenCounter("test-chat-model");

    const plainTextTokens = counter.estimateText("Hello there");
    const userTokens = counter.estimateMessages([
      { role: "user", content: "Hello there" },
    ]);
    const systemTokens = counter.estimateMessages([
      { role: "system", content: "Hello there" },
    ]);
    const assistantTokens = counter.estimateMessages([
      { role: "assistant", content: "Hello there" },
    ]);

    expect(counter.estimateText("")).toBe(0);
    expect(counter.estimateText("你好 👋")).toBeGreaterThan(0);
    expect(userTokens).toBeGreaterThan(plainTextTokens);
    expect(systemTokens - plainTextTokens).toBe(userTokens - plainTextTokens);
    expect(assistantTokens - plainTextTokens).toBe(
      userTokens - plainTextTokens,
    );
    expect(counter.withSafetyMargin(100)).toBe(120);
  });

  test("counts special-token-looking text for raw text and messages", () => {
    const tokenCounter = (counter = createTokenCounter("test-chat-model"));

    expect(() => tokenCounter.estimateText("<|endoftext|>")).not.toThrow();
    expect(tokenCounter.estimateText("<|endoftext|>")).toBeGreaterThan(0);

    expect(() =>
      tokenCounter.estimateMessages([
        { role: "user", content: "prefix <|endoftext|> suffix" },
      ]),
    ).not.toThrow();
    expect(
      tokenCounter.estimateMessages([
        { role: "user", content: "prefix <|endoftext|> suffix" },
      ]),
    ).toBeGreaterThan(
      tokenCounter.estimateText("prefix <|endoftext|> suffix"),
    );
  });
});
