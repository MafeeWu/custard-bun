import { afterEach, describe, expect, test } from "vitest";
import { ChatDomainError } from "./chat-errors";
import type { ChatStreamEvent } from "./chat-events";
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
    const failed: ChatStreamEvent = {
      type: "failed",
      attemptId: "attempt-1",
      code: "CHAT_PROVIDER_TIMEOUT",
      message: "Timed out while waiting for the provider.",
      retryable: true,
      resetAt: "2026-10-09T16:00:00.000Z",
    };
    const interrupted: ChatStreamEvent = {
      type: "interrupted",
      attemptId: "attempt-1",
      code: "CHAT_STREAM_INTERRUPTED",
      message: "The stream ended before completion.",
      retryable: true,
    };

    expect(failed).not.toHaveProperty("metadata");
    expect(interrupted).not.toHaveProperty("metadata");
  });
});

describe("ChatDomainError", () => {
  test("serializes stable codes and safe metadata", () => {
    const error = new ChatDomainError(
      "CHAT_PROVIDER_TIMEOUT",
      "Timed out while waiting for the provider.",
      {
        retryable: true,
        resetAt: new Date("2026-10-09T16:00:00.000Z"),
        metadata: {
          providerStatus: 504,
          provider: "gateway-a",
          prompt: "secret prompt",
          nested: { unsafe: true },
        },
      },
    );

    expect(error.toJSON()).toEqual({
      code: "CHAT_PROVIDER_TIMEOUT",
      message: "Timed out while waiting for the provider.",
      retryable: true,
      resetAt: "2026-10-09T16:00:00.000Z",
      metadata: {
        providerStatus: 504,
        provider: "gateway-a",
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
});
