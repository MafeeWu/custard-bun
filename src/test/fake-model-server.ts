import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

export type FakeModelScenario =
  | "standard"
  | "structured-standard"
  | "structured-missing-usage"
  | "structured-malformed-envelope"
  | "structured-empty-content"
  | "structured-authentication-reflected-credential"
  | "structured-disconnect-after-acceptance"
  | "structured-stall"
  | "structured-wait-for-abort"
  | "done-open"
  | "buffered-events"
  | "missing-usage"
  | "authentication-error"
  | "rate-limit"
  | "rate-limit-long"
  | "server-error"
  | "stall-before-delta"
  | "stall-after-delta"
  | "disconnect-before-response"
  | "disconnect-after-delta"
  | "malformed-frame"
  | "wait-for-abort";

export interface FakeModelRequest {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  body: unknown;
  aborted: boolean;
}

export interface FakeModelServer {
  readonly baseUrl: string;
  readonly requests: FakeModelRequest[];
  enqueue(...scenarios: FakeModelScenario[]): void;
  close(): Promise<void>;
}

const requestIds: Record<FakeModelScenario, string> = {
  standard: "req-standard",
  "structured-standard": "req-structured-standard",
  "structured-missing-usage": "req-structured-missing-usage",
  "structured-malformed-envelope": "req-structured-malformed",
  "structured-empty-content": "req-structured-empty",
  "structured-authentication-reflected-credential": "fake-provider-api-key",
  "structured-disconnect-after-acceptance":
    "req-structured-disconnect-after-acceptance",
  "structured-stall": "req-structured-stall",
  "structured-wait-for-abort": "req-structured-wait-for-abort",
  "done-open": "req-done-open",
  "buffered-events": "req-buffered-events",
  "missing-usage": "req-missing-usage",
  "authentication-error": "req-authentication",
  "rate-limit": "req-rate-limit",
  "rate-limit-long": "req-rate-limit-long",
  "server-error": "req-server-error",
  "stall-before-delta": "req-stall-before",
  "stall-after-delta": "req-stall-after",
  "disconnect-before-response": "req-disconnect-before",
  "disconnect-after-delta": "req-disconnect-after",
  "malformed-frame": "req-malformed",
  "wait-for-abort": "req-wait-for-abort",
};

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body === "" ? undefined : JSON.parse(body);
}

function startEventStream(
  response: ServerResponse,
  scenario: FakeModelScenario,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "x-request-id": requestIds[scenario],
  });
  response.flushHeaders();
}

async function runScenario(
  scenario: FakeModelScenario,
  response: ServerResponse,
): Promise<void> {
  switch (scenario) {
    case "structured-standard":
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": requestIds[scenario],
      });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '{"items":[]}' } }],
          usage: { prompt_tokens: 11, completion_tokens: 3 },
        }),
      );
      return;
    case "structured-missing-usage":
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": requestIds[scenario],
      });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '{"summary":"ok"}' } }],
        }),
      );
      return;
    case "structured-malformed-envelope":
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": requestIds[scenario],
      });
      response.end('{"choices":[');
      return;
    case "structured-empty-content":
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": requestIds[scenario],
      });
      response.end(
        JSON.stringify({ choices: [{ message: { content: "" } }] }),
      );
      return;
    case "structured-authentication-reflected-credential":
      response.writeHead(401, {
        "content-type": "application/json",
        "x-request-id": requestIds[scenario],
      });
      response.end('{"error":"authentication failed"}');
      return;
    case "structured-disconnect-after-acceptance":
      response.socket?.destroy();
      return;
    case "structured-stall":
    case "structured-wait-for-abort":
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": requestIds[scenario],
      });
      response.flushHeaders();
      return;
    case "done-open":
      startEventStream(response, scenario);
      response.write(
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
          "data: [DONE]\n\n",
      );
      return;
    case "standard": {
      startEventStream(response, scenario);
      const first = Buffer.from(
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      );
      response.write(first.subarray(0, first.length - 1));
      response.write(first.subarray(first.length - 1));
      response.write(
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
          'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2}}\n\n' +
          "data: [DONE]\n\n",
      );
      response.end();
      return;
    }
    case "buffered-events":
      startEventStream(response, scenario);
      response.end(
        'data: {"choices":[{"delta":{"content":"first"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"second"}}]}\n\n' +
          'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2}}\n\n' +
          "data: [DONE]\n\n",
      );
      return;
    case "missing-usage":
      startEventStream(response, scenario);
      response.end(
        'data: {"choices":[{"delta":{"content":"no usage"}}]}\n\n' +
          "data: [DONE]\n\n",
      );
      return;
    case "authentication-error":
      response.writeHead(401, {
        "content-type": "application/json",
        "x-request-id": requestIds[scenario],
      });
      response.end(
        JSON.stringify({
          error: "raw provider body must stay private",
          suppliedAuthorization: "Bearer fake-provider-api-key",
        }),
      );
      return;
    case "rate-limit":
    case "rate-limit-long":
      response.writeHead(429, {
        "content-type": "application/json",
        "retry-after": scenario === "rate-limit" ? "0" : "120",
        "x-request-id": requestIds[scenario],
      });
      response.end('{"error":"private rate-limit body"}');
      return;
    case "server-error":
      response.writeHead(500, {
        "content-type": "application/json",
        "x-request-id": requestIds[scenario],
      });
      response.end('{"error":"private server body"}');
      return;
    case "stall-before-delta":
      startEventStream(response, scenario);
      await sleep(250);
      if (!response.destroyed) {
        response.end("data: [DONE]\n\n");
      }
      return;
    case "stall-after-delta":
      startEventStream(response, scenario);
      response.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
      return;
    case "disconnect-before-response":
      response.socket?.destroy();
      return;
    case "disconnect-after-delta":
      startEventStream(response, scenario);
      response.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
      setImmediate(() => response.socket?.destroy());
      return;
    case "malformed-frame":
      startEventStream(response, scenario);
      response.end('data: {"choices":[}\n\ndata: [DONE]\n\n');
      return;
    case "wait-for-abort":
      startEventStream(response, scenario);
      return;
  }
}

export async function startFakeModelServer(): Promise<FakeModelServer> {
  const requests: FakeModelRequest[] = [];
  const scenarios: FakeModelScenario[] = [];

  const server: Server = createServer(async (request, response) => {
    const record: FakeModelRequest = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: undefined,
      aborted: false,
    };
    requests.push(record);
    const markAborted = () => {
      if (!response.writableEnded) {
        record.aborted = true;
      }
    };
    request.on("aborted", markAborted);
    response.on("close", markAborted);

    try {
      record.body = await readBody(request);
      const scenario = scenarios.shift();
      if (!scenario) {
        response.writeHead(500, {
          "content-type": "application/json",
          "x-request-id": "req-unexpected",
        });
        response.end('{"error":"unexpected request"}');
        return;
      }
      await runScenario(scenario, response);
    } catch {
      if (!response.headersSent) {
        response.writeHead(400);
      }
      response.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    enqueue(...nextScenarios) {
      scenarios.push(...nextScenarios);
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
