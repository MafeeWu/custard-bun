import { createServer } from "node:http";
import type { DataExportPolicy } from "../../../src/server/privacy/data-export-service";

export function createExportBarrier() {
  let owner: string | undefined;
  let claim:
    { exportId: string; userId: string; attemptCount: number } | undefined;
  let state = "idle";
  let resume: (() => void) | undefined;
  const afterClaim: NonNullable<DataExportPolicy["afterClaim"]> = async (
    value,
  ) => {
    if (value.userId !== owner || state !== "armed") return;
    claim = value;
    state = "paused";
    await new Promise<void>((resolve) => {
      resume = resolve;
    });
    state = "resumed";
  };
  const server = createServer(async (request, response) => {
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        request.socket.remoteAddress ?? "",
      )
    ) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === "GET" && request.url === "/state") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ state, ...claim }));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (
        request.url === "/arm" &&
        typeof body.userId === "string" &&
        state !== "paused"
      ) {
        owner = body.userId;
        claim = undefined;
        state = "armed";
        response.writeHead(204).end();
      } else if (
        request.url === "/resume" &&
        state === "paused" &&
        body.exportId === claim?.exportId
      ) {
        resume?.();
        resume = undefined;
        response.writeHead(204).end();
      } else response.writeHead(409).end();
    } catch {
      response.writeHead(400).end();
    }
  });
  return {
    server,
    afterClaim,
    release() {
      owner = undefined;
      resume?.();
      resume = undefined;
    },
  };
}
