import "server-only";

import { createHash } from "node:crypto";
import type { ModelSecretConfig } from "@/server/config/schema";
import {
  type GatewayStreamEvent,
  type ModelGateway,
  type ModelGatewayStreamInput,
  type StructuredCompletionInput,
  type StructuredCompletionResult,
} from "./model-contract";
import { ModelGatewayError } from "./model-error";
import { parseOpenAiStream } from "./stream-parser";

type GatewayProviderConfig = Pick<
  ModelSecretConfig,
  "apiBaseUrl" | "apiKey" | "modelId"
> & {
  requestTimeoutMs?: number;
};

const DEFAULT_STRUCTURED_REQUEST_TIMEOUT_MS = 120_000;

function scheduleAbort(
  controller: AbortController,
  milliseconds: number,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => controller.abort(), milliseconds);
  timer.unref?.();
  return timer;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, date - Date.now());
}

function providerRequestId(
  response: Response,
  apiKey: string,
): string | undefined {
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    undefined;
  const normalized = requestId?.trim();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized.length <= 256 &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(normalized) &&
    !(apiKey.length > 0 && normalized.includes(apiKey))
  ) {
    return normalized;
  }
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function providerHeaders(
  config: GatewayProviderConfig,
  accept: string,
): HeadersInit {
  return {
    accept,
    authorization: `Bearer ${config.apiKey}`,
    "content-type": "application/json",
  };
}

async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function errorForResponse(
  response: Response,
  apiKey: string,
): ModelGatewayError {
  const options = {
    status: response.status,
    providerRequestId: providerRequestId(response, apiKey),
  };

  if (response.status === 401 || response.status === 403) {
    return new ModelGatewayError("authentication", options);
  }
  if (response.status === 429) {
    return new ModelGatewayError("rate_limit", {
      ...options,
      retryable: true,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    });
  }
  if (response.status >= 500) {
    return new ModelGatewayError("server", {
      ...options,
      retryable: true,
    });
  }
  return new ModelGatewayError("protocol", options);
}

function withRequestId(
  error: ModelGatewayError,
  requestId: string | undefined,
): ModelGatewayError {
  if (error.providerRequestId || !requestId) {
    return error;
  }
  return new ModelGatewayError(error.category, {
    status: error.status,
    providerRequestId: requestId,
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs,
  });
}

function normalizeError(input: {
  error: unknown;
  callerSignal: AbortSignal;
  totalSignal: AbortSignal;
  firstTokenSignal: AbortSignal;
  hasEmittedDelta: boolean;
  requestId?: string;
}): ModelGatewayError {
  if (input.callerSignal.aborted) {
    return new ModelGatewayError("cancelled", {
      providerRequestId: input.requestId,
    });
  }
  if (input.totalSignal.aborted) {
    return new ModelGatewayError("total_timeout", {
      providerRequestId: input.requestId,
    });
  }
  if (input.firstTokenSignal.aborted) {
    return new ModelGatewayError("first_token_timeout", {
      providerRequestId: input.requestId,
      retryable: true,
    });
  }

  if (input.error instanceof ModelGatewayError) {
    return withRequestId(input.error, input.requestId);
  }
  if (input.hasEmittedDelta) {
    return new ModelGatewayError("interrupted", {
      providerRequestId: input.requestId,
    });
  }
  return new ModelGatewayError("connection", {
    providerRequestId: input.requestId,
    retryable: true,
  });
}

function normalizeStructuredError(input: {
  error: unknown;
  callerSignal: AbortSignal;
  totalSignal: AbortSignal;
  requestId?: string;
}): ModelGatewayError {
  if (input.callerSignal.aborted) {
    return new ModelGatewayError("cancelled", {
      providerRequestId: input.requestId,
    });
  }
  if (input.totalSignal.aborted) {
    return new ModelGatewayError("total_timeout", {
      providerRequestId: input.requestId,
    });
  }
  if (input.error instanceof ModelGatewayError) {
    return withRequestId(input.error, input.requestId);
  }
  return new ModelGatewayError("connection", {
    providerRequestId: input.requestId,
  });
}

function parseStructuredResponse(
  payload: unknown,
  requestId: string | undefined,
): Pick<
  StructuredCompletionResult,
  "content" | "inputTokens" | "outputTokens"
> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ModelGatewayError("protocol", {
      providerRequestId: requestId,
    });
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ModelGatewayError("protocol", {
      providerRequestId: requestId,
    });
  }
  const firstChoice = choices[0];
  const message =
    firstChoice && typeof firstChoice === "object" && !Array.isArray(firstChoice)
      ? (firstChoice as { message?: unknown }).message
      : undefined;
  const content =
    message && typeof message === "object" && !Array.isArray(message)
      ? (message as { content?: unknown }).content
      : undefined;
  if (typeof content !== "string" || content.length === 0) {
    throw new ModelGatewayError("protocol", {
      providerRequestId: requestId,
    });
  }

  const usage = (payload as { usage?: unknown }).usage;
  if (usage === undefined) {
    return { content };
  }
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    throw new ModelGatewayError("protocol", {
      providerRequestId: requestId,
    });
  }
  const inputTokens = (usage as { prompt_tokens?: unknown }).prompt_tokens;
  const outputTokens = (usage as { completion_tokens?: unknown })
    .completion_tokens;
  if (
    !Number.isSafeInteger(inputTokens) ||
    (inputTokens as number) < 0 ||
    !Number.isSafeInteger(outputTokens) ||
    (outputTokens as number) < 0
  ) {
    throw new ModelGatewayError("protocol", {
      providerRequestId: requestId,
    });
  }
  return {
    content,
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
  };
}

function shouldRetry(
  error: ModelGatewayError,
  hasEmittedDelta: boolean,
  attempt: number,
  remainingMs: number,
): boolean {
  if (attempt >= 2 || hasEmittedDelta || remainingMs <= 0) {
    return false;
  }
  if (
    error.category === "connection" ||
    error.category === "first_token_timeout" ||
    error.category === "server"
  ) {
    return true;
  }
  return (
    error.category === "rate_limit" &&
    error.retryAfterMs !== undefined &&
    error.retryAfterMs < remainingMs
  );
}

function waitForRetry(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfCancelledOrTimedOut(
  callerSignal: AbortSignal,
  totalSignal: AbortSignal,
  requestId?: string,
): void {
  if (callerSignal.aborted) {
    throw new ModelGatewayError("cancelled", {
      providerRequestId: requestId,
    });
  }
  if (totalSignal.aborted) {
    throw new ModelGatewayError("total_timeout", {
      providerRequestId: requestId,
    });
  }
}

export class OpenAiCompatibleGateway implements ModelGateway {
  private readonly endpoint: URL;

  constructor(private readonly config: GatewayProviderConfig) {
    this.endpoint = new URL(
      "chat/completions",
      `${config.apiBaseUrl.replace(/\/+$/, "")}/`,
    );
  }

  async completeStructured(
    input: StructuredCompletionInput,
  ): Promise<StructuredCompletionResult> {
    const startedAt = Date.now();
    const totalController = new AbortController();
    const totalTimer = scheduleAbort(
      totalController,
      Math.max(
        0,
        this.config.requestTimeoutMs ??
          DEFAULT_STRUCTURED_REQUEST_TIMEOUT_MS,
      ),
    );
    const requestSignal = AbortSignal.any([
      input.signal,
      totalController.signal,
    ]);
    let requestId: string | undefined;

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: providerHeaders(this.config, "application/json"),
        body: JSON.stringify({
          model: this.config.modelId,
          messages: input.messages,
          max_tokens: input.maxOutputTokens,
          stream: false,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "background_response",
              strict: true,
              schema: input.jsonSchema,
            },
          },
        }),
        signal: requestSignal,
      });
      requestId = providerRequestId(response, this.config.apiKey);
      if (!response.ok) {
        const responseError = errorForResponse(response, this.config.apiKey);
        await discardBody(response);
        throw responseError;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throwIfCancelledOrTimedOut(
          input.signal,
          totalController.signal,
          requestId,
        );
        throw new ModelGatewayError("protocol", {
          providerRequestId: requestId,
        });
      }
      throwIfCancelledOrTimedOut(
        input.signal,
        totalController.signal,
        requestId,
      );
      const parsed = parseStructuredResponse(payload, requestId);
      return {
        ...parsed,
        modelId: this.config.modelId,
        providerRequestIds: requestId ? [requestId] : [],
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw normalizeStructuredError({
        error,
        callerSignal: input.signal,
        totalSignal: totalController.signal,
        requestId,
      });
    } finally {
      clearTimeout(totalTimer);
    }
  }

  async *stream(
    input: ModelGatewayStreamInput,
  ): AsyncGenerator<GatewayStreamEvent, void> {
    const startedAt = Date.now();
    const totalController = new AbortController();
    const totalTimer = scheduleAbort(
      totalController,
      Math.max(0, input.requestTimeoutMs),
    );
    const totalAndCallerSignal = AbortSignal.any([
      input.signal,
      totalController.signal,
    ]);
    let hasEmittedDelta = false;

    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (input.signal.aborted) {
          throw new ModelGatewayError("cancelled");
        }
        if (totalController.signal.aborted) {
          throw new ModelGatewayError("total_timeout");
        }

        yield { type: "provider-call", callNumber: attempt };

        const firstTokenController = new AbortController();
        const remainingBeforeAttempt =
          input.requestTimeoutMs - (Date.now() - startedAt);
        const firstTokenTimer = scheduleAbort(
          firstTokenController,
          Math.max(
            0,
            Math.min(input.firstTokenTimeoutMs, remainingBeforeAttempt),
          ),
        );
        const requestSignal = AbortSignal.any([
          totalAndCallerSignal,
          firstTokenController.signal,
        ]);
        let requestId: string | undefined;
        let hasEmittedRequestId = false;

        try {
          const response = await fetch(this.endpoint, {
            method: "POST",
            headers: providerHeaders(this.config, "text/event-stream"),
            body: JSON.stringify({
              model: input.modelId,
              messages: input.messages,
              temperature: input.temperature,
              top_p: input.topP,
              max_tokens: input.maxOutputTokens,
              stream: true,
              stream_options: { include_usage: true },
            }),
            signal: requestSignal,
          });
          requestId = providerRequestId(response, this.config.apiKey);
          if (!response.ok) {
            const responseError = errorForResponse(
              response,
              this.config.apiKey,
            );
            await discardBody(response);
            throw responseError;
          }
          if (!response.body) {
            throw new ModelGatewayError("protocol", {
              providerRequestId: requestId,
            });
          }
          if (requestId) {
            hasEmittedRequestId = true;
            yield { type: "request-id", requestId };
          }

          for await (const event of parseOpenAiStream(response.body)) {
            throwIfCancelledOrTimedOut(
              input.signal,
              totalController.signal,
              requestId,
            );
            if (event.type === "delta") {
              hasEmittedDelta = true;
              clearTimeout(firstTokenTimer);
            }
            yield event;
          }
          throwIfCancelledOrTimedOut(
            input.signal,
            totalController.signal,
            requestId,
          );
          clearTimeout(firstTokenTimer);
          return;
        } catch (error) {
          clearTimeout(firstTokenTimer);
          const normalized = normalizeError({
            error,
            callerSignal: input.signal,
            totalSignal: totalController.signal,
            firstTokenSignal: firstTokenController.signal,
            hasEmittedDelta,
            requestId,
          });
          const remainingMs = input.requestTimeoutMs - (Date.now() - startedAt);
          if (!shouldRetry(normalized, hasEmittedDelta, attempt, remainingMs)) {
            throw normalized;
          }
          if (!hasEmittedRequestId && normalized.providerRequestId) {
            yield {
              type: "request-id",
              requestId: normalized.providerRequestId,
            };
          }

          try {
            await waitForRetry(
              normalized.retryAfterMs ?? 0,
              totalAndCallerSignal,
            );
          } catch (retryError) {
            throw normalizeError({
              error: retryError,
              callerSignal: input.signal,
              totalSignal: totalController.signal,
              firstTokenSignal: firstTokenController.signal,
              hasEmittedDelta,
              requestId,
            });
          }
        }
      }
    } finally {
      clearTimeout(totalTimer);
    }
  }
}
