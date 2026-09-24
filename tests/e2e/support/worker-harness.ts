import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { loadDatabaseUrl } from "../../../src/server/config/database-url";
import { createDatabase } from "../../../src/server/db/client";
import { workerHeartbeat } from "../../../src/server/db/system-schema";
import { requireRecentWorkerHeartbeat } from "../../../src/server/health/worker-heartbeat";
import {
  startWorkerHarness,
  type HarnessProbeDatabase,
} from "./worker-harness-lifecycle";

async function main(): Promise<void> {
  const databaseUrl = loadDatabaseUrl();
  type ProbeDatabase = ReturnType<typeof createDatabase>;

  await startWorkerHarness({
    createProbeDatabase() {
      const database = createDatabase(databaseUrl);
      return {
        async deleteHeartbeat() {
          await database
            .delete(workerHeartbeat)
            .where(eq(workerHeartbeat.worker, "auth-email-worker"));
        },
        async requireReady() {
          await requireRecentWorkerHeartbeat(
            database,
            "auth-email-worker",
            new Date(Date.now() - 60_000),
          );
        },
        close: () => database.$client.end(),
        database,
      } satisfies HarnessProbeDatabase & { database: ProbeDatabase };
    },
    spawnWorker() {
      return spawn(
        process.execPath,
        ["--import", "tsx", "src/worker.ts"],
        {
          cwd: process.cwd(),
          env: process.env,
          stdio: "inherit",
        },
      );
    },
    waitForWorkerSpawn(worker) {
      const child = worker as ReturnType<typeof spawn>;
      return new Promise<void>((resolve, reject) => {
        const handleSpawn = () => {
          child.off("error", handleError);
          resolve();
        };
        const handleError = (error: Error) => {
          child.off("spawn", handleSpawn);
          reject(error);
        };
        child.once("spawn", handleSpawn);
        child.once("error", handleError);
      });
    },
    createReadinessServer(worker, database) {
      return createServer(async (_request, response) => {
        if (
          worker.exitCode !== null ||
          worker.signalCode !== null
        ) {
          response.writeHead(503).end();
          return;
        }

        try {
          await database.requireReady();
          response.writeHead(200).end();
        } catch {
          response.writeHead(503).end();
        }
      });
    },
    listen(server) {
      return new Promise<void>((resolve, reject) => {
        const httpServer = server as ReturnType<typeof createServer>;
        httpServer.once("error", reject);
        httpServer.listen(3101, "127.0.0.1", resolve);
      });
    },
    closeServer(server) {
      const httpServer = server as ReturnType<typeof createServer>;
      if (!httpServer.listening) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    killWorker(worker, signal) {
      return (worker as ReturnType<typeof spawn>).kill(signal);
    },
    onWorkerExit(worker, listener) {
      const child = worker as ReturnType<typeof spawn>;
      child.once("exit", listener);
      return () => child.off("exit", listener);
    },
    onSignal(signal, listener) {
      process.once(signal, listener);
      return () => process.off(signal, listener);
    },
    setExitCode(code) {
      process.exitCode = code;
    },
    logger: console,
  });
}

void main().catch((error: unknown) => {
  console.error("worker harness failed", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  process.exit(1);
});
