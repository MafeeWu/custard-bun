import { loadDatabaseUrl } from "@/server/config/database-url";
import { createDatabase } from "@/server/db/client";
import { requireRecentWorkerHeartbeat } from "./worker-heartbeat";

async function main(): Promise<void> {
  const database = createDatabase(loadDatabaseUrl());

  try {
    await requireRecentWorkerHeartbeat(
      database,
      "auth-email-worker",
      new Date(Date.now() - 60_000),
    );
  } finally {
    await database.$client.end();
  }
}

void main().catch((error: unknown) => {
  console.error("worker health check failed", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  process.exitCode = 1;
});
