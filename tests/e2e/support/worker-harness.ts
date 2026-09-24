import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { loadDatabaseUrl } from "../../../src/server/config/database-url";
import { createDatabase } from "../../../src/server/db/client";
import { workerHeartbeat } from "../../../src/server/db/system-schema";
import { requireRecentWorkerHeartbeat } from "../../../src/server/health/worker-heartbeat";

async function main(): Promise<void> {
  const databaseUrl = loadDatabaseUrl();
  const probeDatabase = createDatabase(databaseUrl);

  await probeDatabase
    .delete(workerHeartbeat)
    .where(eq(workerHeartbeat.worker, "auth-email-worker"));

  const worker = spawn(
    process.execPath,
    ["--import", "tsx", "src/worker.ts"],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );

  const server = createServer(async (_request, response) => {
    if (worker.exitCode !== null) {
      response.writeHead(503).end();
      return;
    }

    try {
      await requireRecentWorkerHeartbeat(
        probeDatabase,
        "auth-email-worker",
        new Date(Date.now() - 60_000),
      );
      response.writeHead(200).end();
    } catch {
      response.writeHead(503).end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3101, "127.0.0.1", resolve);
  });

  let stopping = false;

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (stopping) {
      return;
    }
    stopping = true;

    server.close();
    worker.kill(signal);

    const timeout = setTimeout(() => {
      if (worker.exitCode === null) {
        worker.kill("SIGKILL");
      }
    }, 35_000);
    timeout.unref();

    if (worker.exitCode === null) {
      await once(worker, "exit");
    }
    clearTimeout(timeout);
    await probeDatabase.$client.end();
  }

  worker.once("exit", async (code) => {
    if (!stopping) {
      stopping = true;
      server.close();
      await probeDatabase.$client.end();
      process.exitCode = code ?? 1;
    }
  });

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((error: unknown) => {
  console.error("worker harness failed", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  process.exitCode = 1;
});
