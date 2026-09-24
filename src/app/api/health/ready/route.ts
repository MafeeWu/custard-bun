import { getRuntimeConfig } from "@/server/config/load-config";
import { createDatabase } from "@/server/db/client";
import {
  checkReadiness,
  type ReadinessResult,
} from "@/server/health/check-readiness";
import { requireRecentWorkerHeartbeat } from "@/server/health/worker-heartbeat";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let database: ReturnType<typeof createDatabase> | undefined;
  let result: ReadinessResult = {
    ready: false,
    checks: { database: "error", worker: "error" },
  };

  try {
    const config = await getRuntimeConfig();
    const activeDatabase = createDatabase(config.secret.databaseUrl, {
      connectionTimeoutMillis: 1_000,
      query_timeout: 1_000,
      statement_timeout: 1_000,
    });
    database = activeDatabase;
    result = await checkReadiness({
      checkDatabase: async () => {
        await activeDatabase.$client.query("select 1");
      },
      checkWorker: async () => {
        await requireRecentWorkerHeartbeat(
          activeDatabase,
          "auth-email-worker",
          new Date(Date.now() - 60_000),
        );
      },
    });
  } catch {
    // Readiness responses intentionally contain no dependency error details.
  }

  if (database) {
    try {
      await database.$client.end();
    } catch {
      result = {
        ready: false,
        checks: { ...result.checks, database: "error" },
      };
    }
  }

  return Response.json(result, { status: result.ready ? 200 : 503 });
}
