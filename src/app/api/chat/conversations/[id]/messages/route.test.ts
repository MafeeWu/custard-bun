// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ChatDomainError } from "@/server/chat/chat-errors";
import type { ChatStreamEvent } from "@/server/chat/chat-events";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getGenerationService: vi.fn(),
  getRuntimeConfig: vi.fn(),
  startNewMessage: vi.fn(),
  retry: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/server/auth/require-session", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("@/server/chat/generation-service", () => ({
  getGenerationService: mocks.getGenerationService,
}));
vi.mock("@/server/config/load-config", () => ({
  getRuntimeConfig: mocks.getRuntimeConfig,
}));

import { POST } from "./route";

const conversationId = "10000000-0000-4000-8000-000000000001";
const clientRequestId = "20000000-0000-4000-8000-000000000002";
const retryAttemptId = "30000000-0000-4000-8000-000000000003";

beforeEach(() => {
  mocks.requireSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.getGenerationService.mockResolvedValue({
    startNewMessage: mocks.startNewMessage,
    retry: mocks.retry,
    stop: mocks.stop,
  });
  mocks.getRuntimeConfig.mockResolvedValue({
    public: { chat: { maxInputCharacters: 5 } },
  });
});

function request(body: string, contentType = "application/json") {
  return new Request(
    `http://localhost/api/chat/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    },
  );
}

function context(id = conversationId) {
  return { params: Promise.resolve({ id }) };
}

async function* stream(
  events: ChatStreamEvent[],
): AsyncGenerator<ChatStreamEvent, void> {
  for (const event of events) {
    yield event;
  }
}

async function responseJson(response: Response) {
  return JSON.parse(await response.text());
}

function cancellableStream(signal: AbortSignal, state: {
  aborted: boolean;
  settled: boolean;
  returned: boolean;
}): AsyncGenerator<ChatStreamEvent, void> {
  let phase = 0;
  return {
    async next() {
      if (phase === 0) {
        phase = 1;
        return {
          done: false,
          value: { type: "started", attemptId: retryAttemptId },
        };
      }
      if (phase === 1) {
        phase = 2;
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            state.aborted = true;
            resolve();
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              state.aborted = true;
              resolve();
            },
            { once: true },
          );
        });
        state.settled = true;
        return {
          done: false,
          value: {
            type: "interrupted",
            attemptId: retryAttemptId,
            code: "CHAT_STREAM_INTERRUPTED",
            message: "The response stream ended before completion.",
            retryable: true,
          },
        };
      }
      return { done: true, value: undefined };
    },
    async return() {
      state.returned = true;
      return { done: true, value: undefined };
    },
    async throw(error?: unknown) {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    async [Symbol.asyncDispose]() {
      await this.return();
    },
  };
}

describe("POST conversation messages", () => {
  test.each([
    ["wrong content type", request("{}", "text/plain")],
    ["invalid JSON", request("{")],
    [
      "empty content",
      request(JSON.stringify({ clientRequestId, content: "   " })),
    ],
    [
      "overlong content",
      request(JSON.stringify({ clientRequestId, content: "123456" })),
    ],
    [
      "invalid conversation UUID",
      request(JSON.stringify({ clientRequestId, content: "Hi" })),
      "not-a-uuid",
    ],
    [
      "invalid idempotency key",
      request(JSON.stringify({ clientRequestId: "bad", content: "Hi" })),
    ],
    [
      "invalid retry attempt UUID",
      request(
        JSON.stringify({ clientRequestId, retryAttemptId: "not-a-uuid" }),
      ),
    ],
    [
      "both strict-union branches",
      request(
        JSON.stringify({
          clientRequestId,
          content: "Hi",
          retryAttemptId,
        }),
      ),
    ],
    [
      "unknown body key",
      request(JSON.stringify({ clientRequestId, content: "Hi", extra: true })),
    ],
  ] as const)(
    "returns a typed 400 for %s",
    async (_label, routeRequest, id?: string) => {
      const response = await POST(routeRequest, context(id ?? conversationId));

      expect(response.status).toBe(400);
      expect(await responseJson(response)).toEqual({
        error: {
          code: "CHAT_VALIDATION",
          message: "The chat request is invalid.",
          retryable: false,
        },
      });
      expect(mocks.startNewMessage).not.toHaveBeenCalled();
      expect(mocks.retry).not.toHaveBeenCalled();
    },
  );

  test("preserves authoritative unauthenticated and banned-session behavior", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mocks.requireSession.mockRejectedValue(redirect);

    await expect(
      POST(
        request(JSON.stringify({ clientRequestId, content: "Hi" })),
        context(),
      ),
    ).rejects.toBe(redirect);
    expect(mocks.getGenerationService).not.toHaveBeenCalled();
  });

  test("streams one NDJSON object per line with hardened headers and the request signal", async () => {
    const events: ChatStreamEvent[] = [
      { type: "started", attemptId: retryAttemptId },
      { type: "delta", attemptId: retryAttemptId, text: "Hi" },
      {
        type: "completed",
        attemptId: retryAttemptId,
        usage: { inputTokens: 4, outputTokens: 1, estimated: false },
      },
    ];
    mocks.startNewMessage.mockReturnValue(stream(events));
    const routeRequest = request(
      JSON.stringify({ clientRequestId, content: "Hi" }),
    );

    const response = await POST(routeRequest, context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe(
      events.map((event) => `${JSON.stringify(event)}\n`).join(""),
    );
    expect(mocks.startNewMessage).toHaveBeenCalledWith({
      userId: "user-1",
      conversationId,
      clientRequestId,
      content: "Hi",
      signal: expect.any(AbortSignal),
    });
    const serviceSignal = mocks.startNewMessage.mock.calls[0]![0].signal;
    expect(serviceSignal).not.toBe(routeRequest.signal);
    expect(serviceSignal.aborted).toBe(false);
  });

  test.each([
    ["before the started event is read", false],
    ["after the started event is read", true],
  ] as const)(
    "response cancellation %s aborts and drains interrupted settlement",
    async (_label, readStarted) => {
      const state = { aborted: false, settled: false, returned: false };
      mocks.startNewMessage.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          cancellableStream(signal, state),
      );
      const response = await POST(
        request(JSON.stringify({ clientRequestId, content: "Hi" })),
        context(),
      );

      if (readStarted) {
        const reader = response.body!.getReader();
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toContain(
          '"type":"started"',
        );
        await reader.cancel();
      } else {
        await response.body!.cancel();
      }

      expect(state).toEqual({
        aborted: true,
        settled: true,
        returned: false,
      });
    },
  );

  test("dispatches the strict retry branch", async () => {
    mocks.retry.mockReturnValue(
      stream([
        {
          type: "failed",
          attemptId: retryAttemptId,
          code: "CHAT_PROVIDER_AUTH",
          message: "The model provider rejected the request.",
          retryable: false,
        },
      ]),
    );
    const routeRequest = request(
      JSON.stringify({ clientRequestId, retryAttemptId }),
    );

    await POST(routeRequest, context());

    expect(mocks.retry).toHaveBeenCalledWith({
      userId: "user-1",
      conversationId,
      clientRequestId,
      attemptId: retryAttemptId,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.retry.mock.calls[0]![0].signal).not.toBe(
      routeRequest.signal,
    );
    expect(mocks.startNewMessage).not.toHaveBeenCalled();
  });

  test("emits a safe terminal internal error when the stream fails after headers", async () => {
    mocks.startNewMessage.mockReturnValue(
      (async function* () {
        yield { type: "started", attemptId: retryAttemptId } as const;
        throw new Error("provider body: private");
      })(),
    );

    const response = await POST(
      request(JSON.stringify({ clientRequestId, content: "Hi" })),
      context(),
    );
    const lines = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines).toEqual([
      { type: "started", attemptId: retryAttemptId },
      {
        type: "failed",
        attemptId: retryAttemptId,
        code: "CHAT_INTERNAL",
        message: "Something went wrong while generating a response.",
        retryable: false,
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain("provider body");
  });

  test.each([
    ["CHAT_NOT_FOUND", 404],
    ["CHAT_READ_ONLY", 409],
    ["CHAT_GENERATION_IN_PROGRESS", 409],
    ["CHAT_USER_REQUEST_QUOTA", 429],
    ["CHAT_INSTANCE_CONCURRENCY", 429],
    ["CHAT_PROVIDER_AUTH", 502],
    ["CHAT_PROVIDER_RATE_LIMIT", 503],
    ["CHAT_PROVIDER_TIMEOUT", 504],
    ["CHAT_INTERNAL", 500],
  ] as const)("maps %s to stable status %i", async (code, status) => {
    mocks.startNewMessage.mockReturnValue({
      async next() {
        throw new ChatDomainError(code, "private detail", {
          retryable: code === "CHAT_GENERATION_IN_PROGRESS",
          metadata:
            code === "CHAT_GENERATION_IN_PROGRESS"
              ? { attemptId: retryAttemptId, conversationId }
              : undefined,
        });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    });

    const response = await POST(
      request(JSON.stringify({ clientRequestId, content: "Hi" })),
      context(),
    );

    expect(response.status).toBe(status);
    const body = await responseJson(response);
    expect(body.error.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain("private detail");
  });

  test("returns duplicate idempotency conflict metadata without creating a stream response", async () => {
    mocks.startNewMessage.mockReturnValue({
      async next() {
        throw new ChatDomainError(
          "CHAT_GENERATION_IN_PROGRESS",
          "duplicate",
          {
            retryable: true,
            metadata: { attemptId: retryAttemptId, conversationId },
          },
        );
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    });

    const response = await POST(
      request(JSON.stringify({ clientRequestId, content: "Hi" })),
      context(),
    );

    expect(response.status).toBe(409);
    expect(await responseJson(response)).toEqual({
      error: {
        code: "CHAT_GENERATION_IN_PROGRESS",
        message: "A response is already being generated for this chat.",
        retryable: true,
        metadata: { attemptId: retryAttemptId, conversationId },
      },
    });
  });
});
