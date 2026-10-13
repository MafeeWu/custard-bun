import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";

interface ProviderMessage {
  role?: unknown;
  content?: unknown;
}

interface ProviderRequestBody {
  model?: unknown;
  messages?: ProviderMessage[];
  stream?: boolean;
  response_format?: unknown;
  [key: string]: unknown;
}

export interface FakeModelRequest {
  id: string;
  receivedAt: string;
  body: ProviderRequestBody;
}

interface FakeModelState {
  apiKey: string;
  missingUsage: boolean;
  requests: FakeModelRequest[];
  interruptedPrompts: Map<string, number>;
  heldResponses: Map<string, ServerResponse>;
  heldStructured: Map<string, () => void>;
  sequence: number;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new Error("request too large");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function latestUserText(body: ProviderRequestBody): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && typeof message.content === "string") {
      return message.content;
    }
  }
  return "";
}

function frame(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function delta(id: string, content: string): string {
  return frame({
    id,
    choices: [{ index: 0, delta: { content } }],
  });
}

function usage(inputTokens: number, outputTokens: number): string {
  return frame({
    choices: [],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
    },
  });
}

function beginStream(response: ServerResponse, id: string): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-request-id": id,
  });
}

function finishStream(
  response: ServerResponse,
  state: FakeModelState,
  id: string,
  chunks: string[],
  tokenUsage = { inputTokens: 20, outputTokens: chunks.length },
): void {
  beginStream(response, id);
  for (const chunk of chunks) {
    response.write(delta(id, chunk));
  }
  if (!state.missingUsage) {
    response.write(usage(tokenUsage.inputTokens, tokenUsage.outputTokens));
  }
  response.end("data: [DONE]\n\n");
}

function resetState(state: FakeModelState): void {
  state.missingUsage = false;
  state.requests.splice(0);
  state.interruptedPrompts.clear();
  for (const response of state.heldResponses.values()) {
    response.destroy();
  }
  state.heldResponses.clear();
  for (const complete of state.heldStructured.values()) complete();
  state.heldStructured.clear();
}

function structuredContent(body: ProviderRequestBody, apiKey: string): string {
  const text = latestUserText(body);
  const source = JSON.parse(text) as {
    sourceMessageId?: string;
    userMessage?: string;
    memories?: Array<{ content: string }>;
    items?: Array<{ content: string }>;
  };
  const userText = source.userMessage ?? text;
  if (userText.includes("[memory-invalid-json]"))
    return `{invalid ${apiKey} task12-provider-endpoint-299ce953ab6a469a`;
  if (
    userText.includes("[summary]") ||
    body.messages?.some(
      (message) =>
        typeof message.content === "string" &&
        message.content.startsWith("Summarize the approved"),
    )
  ) {
    const memories = source.items ?? source.memories ?? [];
    return JSON.stringify({
      summary: memories.length
        ? memories.map((item) => item.content).join(" ")
        : userText.includes("[summary]")
          ? "The user prefers jasmine tea."
          : "",
    });
  }
  if (
    !/\[memory-(direct|repeat|sensitive-explicit|sensitive-inferred|credential|stall)\]/.test(
      userText,
    )
  ) {
    return JSON.stringify({ candidates: [] });
  }
  const sensitive = userText.includes("[memory-sensitive");
  const inferred =
    userText.includes("[memory-repeat]") ||
    userText.includes("[memory-sensitive-inferred]");
  const credential = userText.includes("[memory-credential]");
  const ordinaryContent =
    userText
      .replace(/\[memory-[^\]]+\]\s*/, "")
      .replace(/^I prefer /i, "The user prefers ")
      .replace(/\.$/, "") + ".";
  return JSON.stringify({
    candidates: [
      {
        type: sensitive ? "personal_fact" : "preference",
        content: credential
          ? "The user's password is forbidden-credential-sentinel."
          : sensitive
            ? "The user has diabetes."
            : inferred
              ? "The user prefers evening walks."
              : ordinaryContent,
        sourceMessageId: source.sourceMessageId,
        explicitness: inferred ? "repeated_inference" : "direct",
        sensitivity: sensitive ? "personal_explicit" : "ordinary",
        userExplicitlyAskedToRemember: userText.includes(
          "[memory-sensitive-explicit]",
        ),
        confidence: 85,
        importance: 70,
      },
    ],
  });
}

async function handleProviderRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: FakeModelState,
): Promise<void> {
  const body = (await requestJson(request)) as ProviderRequestBody;
  const id = `e2e-provider-${++state.sequence}`;
  state.requests.push({
    id,
    receivedAt: new Date().toISOString(),
    body,
  });
  const text = latestUserText(body);

  if (request.headers.authorization !== `Bearer ${state.apiKey}`) {
    json(response, 401, { error: "unauthorized" });
    return;
  }
  if (body.stream === false) {
    const complete = () =>
      json(response, 200, {
        id,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: structuredContent(body, state.apiKey),
            },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      });
    if (text.includes("[memory-stall]")) {
      state.heldStructured.set(id, complete);
      response.once("close", () => state.heldStructured.delete(id));
    } else complete();
    return;
  }
  if (text.includes("[auth-fail]")) {
    json(response, 401, {
      error: `authentication failed ${state.apiKey} task12-provider-endpoint-299ce953ab6a469a`,
    });
    return;
  }
  if (text.includes("[rate-limit]")) {
    response.writeHead(429, {
      "content-type": "application/json",
      "retry-after": "1",
      "x-request-id": id,
    });
    response.end(JSON.stringify({ error: "rate limited" }));
    return;
  }
  if (text.includes("[interrupt]")) {
    const count = state.interruptedPrompts.get(text) ?? 0;
    state.interruptedPrompts.set(text, count + 1);
    if (count === 0) {
      beginStream(response, id);
      response.end(delta(id, "Partial reply"));
      return;
    }
    finishStream(response, state, id, ["Recovered reply"], {
      inputTokens: 20,
      outputTokens: 2,
    });
    return;
  }
  if (text.includes("[stall]")) {
    beginStream(response, id);
    response.write(delta(id, "Partial reply"));
    const timer = setTimeout(() => {
      finishStream(response, state, id, [" after pause"], {
        inputTokens: 20,
        outputTokens: 4,
      });
    }, 120_000);
    timer.unref();
    response.once("close", () => clearTimeout(timer));
    return;
  }
  if (text.includes("[replay-recovery]")) {
    beginStream(response, id);
    response.write(delta(id, "Recovery partial"));
    state.heldResponses.set(id, response);
    response.once("close", () => state.heldResponses.delete(id));
    return;
  }
  if (text.includes("[slow]")) {
    beginStream(response, id);
    response.flushHeaders();
    const timer = setTimeout(() => {
      finishStream(response, state, id, ["Slow reply"], {
        inputTokens: 20,
        outputTokens: 2,
      });
    }, 31_000);
    timer.unref();
    response.once("close", () => clearTimeout(timer));
    return;
  }
  if (text.includes("[stream]")) {
    beginStream(response, id);
    response.write(delta(id, "Hello"));
    const timer = setTimeout(() => {
      response.write(delta(id, " there"));
      if (!state.missingUsage) {
        response.write(usage(20, 2));
      }
      response.end("data: [DONE]\n\n");
    }, 1_000);
    timer.unref();
    response.once("close", () => clearTimeout(timer));
    return;
  }

  finishStream(response, state, id, ["E2E reply"], {
    inputTokens: 20,
    outputTokens: 2,
  });
}

export function createFakeModelServer(apiKey = "e2e-model-key") {
  const state: FakeModelState = {
    apiKey,
    missingUsage: false,
    requests: [],
    interruptedPrompts: new Map(),
    heldResponses: new Map(),
    heldStructured: new Map(),
    sequence: 0,
  };

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (
        url.pathname.startsWith("/__e2e__/") &&
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          request.socket.remoteAddress ?? "",
        )
      ) {
        json(response, 403, { error: "loopback only" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        json(response, 200, { status: "ok" });
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname.endsWith("/v1/chat/completions")
      ) {
        await handleProviderRequest(request, response, state);
        return;
      }
      if (request.method === "GET" && url.pathname === "/__e2e__/requests") {
        json(response, 200, state.requests);
        return;
      }
      if (request.method === "POST" && url.pathname === "/__e2e__/reset") {
        resetState(state);
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/__e2e__/control") {
        const control = (await requestJson(request)) as {
          missingUsage?: unknown;
          completeRequestId?: unknown;
        };
        state.missingUsage = control.missingUsage === true;
        if (typeof control.completeRequestId === "string") {
          const structured = state.heldStructured.get(
            control.completeRequestId,
          );
          if (structured) {
            structured();
            state.heldStructured.delete(control.completeRequestId);
            response.writeHead(204).end();
            return;
          }
          const held = state.heldResponses.get(control.completeRequestId);
          if (!held) {
            json(response, 404, { error: "held request not found" });
            return;
          }
          held.write(delta(control.completeRequestId, " and final content"));
          if (!state.missingUsage) {
            held.write(usage(20, 4));
          }
          held.end("data: [DONE]\n\n");
          state.heldResponses.delete(control.completeRequestId);
        }
        response.writeHead(204);
        response.end();
        return;
      }
      json(response, 404, { error: "not found" });
    } catch {
      if (!response.headersSent) {
        json(response, 400, { error: "invalid request" });
      } else {
        response.destroy();
      }
    }
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (invokedPath === import.meta.url) {
  createFakeModelServer(process.env.MODEL_API_KEY).listen(
    Number(process.env.E2E_FAKE_MODEL_PORT ?? "3102"),
    process.env.E2E_FAKE_BIND ?? "127.0.0.1",
  );
}
