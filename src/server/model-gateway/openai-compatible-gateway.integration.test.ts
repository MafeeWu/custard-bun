import type { GatewayMessage } from "@/server/chat/prompt-assembler";
import {
  startFakeModelServer,
  type FakeModelServer,
} from "@/test/fake-model-server";
import type { GatewayStreamEvent } from "./model-contract";
import { ModelGatewayError } from "./model-error";
import { OpenAiCompatibleGateway } from "./openai-compatible-gateway";

const apiKey = "fake-provider-api-key";
const messages: GatewayMessage[] = [
  { role: "system", content: "You are concise." },
  { role: "user", content: "Say hello." },
];

interface Consumption {
  events: GatewayStreamEvent[];
  error?: unknown;
}

async function consume(
  source: AsyncIterable<GatewayStreamEvent>,
): Promise<Consumption> {
  const events: GatewayStreamEvent[] = [];
  try {
    for await (const event of source) {
      events.push(event);
    }
    return { events };
  } catch (error) {
    return { events, error };
  }
}

async function consumeWithRequestIdDelay(
  source: AsyncIterable<GatewayStreamEvent>,
  delayedRequestId: string,
  delayMs: number,
): Promise<Consumption> {
  const events: GatewayStreamEvent[] = [];
  try {
    for await (const event of source) {
      events.push(event);
      if (event.type === "request-id" && event.requestId === delayedRequestId) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return { events };
  } catch (error) {
    return { events, error };
  }
}

function expectGatewayError(
  error: unknown,
  category: ModelGatewayError["category"],
): ModelGatewayError {
  expect(error).toBeInstanceOf(ModelGatewayError);
  expect(error).toMatchObject({ category });
  return error as ModelGatewayError;
}

describe("OpenAiCompatibleGateway", () => {
  let provider: FakeModelServer;

  beforeEach(async () => {
    provider = await startFakeModelServer();
  });

  afterEach(async () => {
    await provider.close();
  });

  function stream(
    overrides: Partial<Parameters<OpenAiCompatibleGateway["stream"]>[0]> = {},
  ) {
    const gateway = new OpenAiCompatibleGateway({
      apiBaseUrl: provider.baseUrl,
      apiKey,
    });
    return gateway.stream({
      messages,
      modelId: "configured-model",
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 321,
      firstTokenTimeoutMs: 100,
      requestTimeoutMs: 500,
      signal: new AbortController().signal,
      ...overrides,
    });
  }

  test("maps the request and streams provider calls, request ID, deltas, and usage", async () => {
    provider.enqueue("standard");

    const result = await consume(stream());

    expect(result.error).toBeUndefined();
    expect(result.events).toEqual([
      { type: "provider-call", callNumber: 1 },
      { type: "request-id", requestId: "req-standard" },
      { type: "delta", text: "你" },
      { type: "delta", text: "好" },
      {
        type: "usage",
        inputTokens: 12,
        outputTokens: 2,
        estimated: false,
      },
    ]);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: "configured-model",
        messages,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 321,
        stream: true,
        stream_options: { include_usage: true },
      },
    });
    expect(provider.requests[0]?.headers.authorization).toBe(
      `Bearer ${apiKey}`,
    );
  });

  test("accepts a completed stream without usage", async () => {
    provider.enqueue("missing-usage");

    const result = await consume(stream());

    expect(result.error).toBeUndefined();
    expect(result.events).toContainEqual({ type: "delta", text: "no usage" });
    expect(result.events.some((event) => event.type === "usage")).toBe(false);
  });

  test("completes at DONE while the loopback response remains open and cleans up its body", async () => {
    provider.enqueue("done-open");
    const result = await consume(stream({ requestTimeoutMs: 150 }));
    expect(result.error).toBeUndefined();
    expect(result.events).toContainEqual({ type: "delta", text: "Hello" });
    await vi.waitFor(() => expect(provider.requests[0]?.aborted).toBe(true));
    expect(provider.requests).toHaveLength(1);
  });

  test("maps authentication errors without exposing provider bodies or credentials", async () => {
    provider.enqueue("authentication-error");

    const result = await consume(stream());
    const error = expectGatewayError(result.error, "authentication");

    expect(error).toMatchObject({
      status: 401,
      providerRequestId: "req-authentication",
      retryable: false,
    });
    const serialized = `${String(error)} ${JSON.stringify(error)}`;
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain("raw provider body");
    expect(provider.requests[0]?.headers.authorization).toBe(
      `Bearer ${apiKey}`,
    );
    expect(provider.requests[0]?.body).toMatchObject({
      model: "configured-model",
    });
  });

  test("handles authentication before slow consumers can trigger first-token timeout or retry", async () => {
    provider.enqueue("authentication-error", "standard");

    const result = await consumeWithRequestIdDelay(
      stream({ firstTokenTimeoutMs: 200, requestTimeoutMs: 1_000 }),
      "req-authentication",
      300,
    );
    const error = expectGatewayError(result.error, "authentication");

    expect(error).toMatchObject({
      status: 401,
      providerRequestId: "req-authentication",
      retryable: false,
    });
    expect(result.events).toEqual([{ type: "provider-call", callNumber: 1 }]);
    expect(provider.requests).toHaveLength(1);
  });

  test("bounds Retry-After and does not wait when it exceeds the total deadline", async () => {
    provider.enqueue("rate-limit-long");

    const result = await consume(
      stream({ firstTokenTimeoutMs: 50, requestTimeoutMs: 100 }),
    );
    const error = expectGatewayError(result.error, "rate_limit");

    expect(error).toMatchObject({
      status: 429,
      providerRequestId: "req-rate-limit-long",
      retryable: true,
      retryAfterMs: 60_000,
    });
    expect(provider.requests).toHaveLength(1);
  });

  test("emits the failed server request ID before retry success", async () => {
    provider.enqueue("server-error", "standard");

    const result = await consumeWithRequestIdDelay(
      stream({ firstTokenTimeoutMs: 100, requestTimeoutMs: 1_000 }),
      "req-server-error",
      200,
    );

    expect(result.error).toBeUndefined();
    expect(
      result.events.filter(
        (event) =>
          event.type === "provider-call" || event.type === "request-id",
      ),
    ).toEqual([
      { type: "provider-call", callNumber: 1 },
      { type: "request-id", requestId: "req-server-error" },
      { type: "provider-call", callNumber: 2 },
      { type: "request-id", requestId: "req-standard" },
    ]);
    expect(provider.requests).toHaveLength(2);
  });

  test("retries a bounded rate limit when its delay fits the total deadline", async () => {
    provider.enqueue("rate-limit", "standard");

    const result = await consume(stream());

    expect(result.error).toBeUndefined();
    expect(provider.requests).toHaveLength(2);
  });

  test("retries one connection failure before output", async () => {
    provider.enqueue("disconnect-before-response", "standard");

    const result = await consume(stream());

    expect(result.error).toBeUndefined();
    expect(provider.requests).toHaveLength(2);
  });

  test("reports first-token timeout after at most one pre-delta retry", async () => {
    provider.enqueue("stall-before-delta", "stall-before-delta");

    const result = await consume(
      stream({ firstTokenTimeoutMs: 20, requestTimeoutMs: 150 }),
    );

    expectGatewayError(result.error, "first_token_timeout");
    expect(provider.requests).toHaveLength(2);
  });

  test("reports total timeout after a delta without retrying", async () => {
    provider.enqueue("stall-after-delta");

    const result = await consume(
      stream({ firstTokenTimeoutMs: 50, requestTimeoutMs: 80 }),
    );

    expect(result.events).toContainEqual({ type: "delta", text: "partial" });
    expectGatewayError(result.error, "total_timeout");
    expect(provider.requests).toHaveLength(1);
  });

  test("reports an interrupted stream after a delta without retrying", async () => {
    provider.enqueue("disconnect-after-delta");

    const result = await consume(stream());

    expect(result.events).toContainEqual({ type: "delta", text: "partial" });
    expectGatewayError(result.error, "interrupted");
    expect(provider.requests).toHaveLength(1);
  });

  test("reports malformed frames as protocol errors", async () => {
    provider.enqueue("malformed-frame");

    const result = await consume(stream());

    expectGatewayError(result.error, "protocol");
    expect(provider.requests).toHaveLength(1);
  });

  test("cancels the upstream request when the caller aborts", async () => {
    provider.enqueue("wait-for-abort");
    const controller = new AbortController();

    const resultPromise = consume(stream({ signal: controller.signal }));
    await vi.waitFor(() => expect(provider.requests).toHaveLength(1));
    controller.abort();
    const result = await resultPromise;

    expectGatewayError(result.error, "cancelled");
    await vi.waitFor(() => expect(provider.requests[0]?.aborted).toBe(true));
    expect(provider.requests).toHaveLength(1);
  });

  test("does not forward buffered events after caller cancellation", async () => {
    provider.enqueue("buffered-events");
    const controller = new AbortController();
    const iterator = stream({ signal: controller.signal });

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "provider-call", callNumber: 1 },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: "request-id",
        requestId: "req-buffered-events",
      },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "delta", text: "first" },
    });

    controller.abort();

    await expect(iterator.next()).rejects.toMatchObject({
      category: "cancelled",
    });
    expect(provider.requests).toHaveLength(1);
  });

  test("performs only one automatic retry", async () => {
    provider.enqueue("server-error", "server-error", "standard");

    const result = await consume(stream());

    expectGatewayError(result.error, "server");
    expect(provider.requests).toHaveLength(2);
  });
});
