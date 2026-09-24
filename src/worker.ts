import { loadRuntimeConfig } from "@/server/config/runtime-config-core";
import { createDatabase } from "@/server/db/client";
import type { AuthEmailJob } from "@/server/email/email-job";
import { deliverAuthEmail } from "@/server/email/smtp-delivery";
import { startWorkerHeartbeat } from "@/server/health/worker-heartbeat";
import { createBoss } from "@/server/jobs/boss";
import { AUTH_EMAIL_QUEUE, ensureQueues } from "@/server/jobs/queues";
import { runWorkerProcess } from "@/server/worker/lifecycle";

async function main(): Promise<void> {
  const config = await loadRuntimeConfig();
  const database = createDatabase(config.secret.databaseUrl, {
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  });

  await runWorkerProcess({
    createDatabase: () => database,
    createBoss: () => createBoss(config.secret.databaseUrl),
    ensureQueues,
    startHeartbeat: () => startWorkerHeartbeat(database),
    registerWorker: async (boss) => {
      await boss.work<AuthEmailJob>(AUTH_EMAIL_QUEUE, async ([job]) => {
        await deliverAuthEmail(job.data, {
          smtp: config.secret.smtp,
          brandName: config.public.branding.name,
        });
      });
    },
    onSignal: (signal, listener) => process.once(signal, listener),
    logger: console,
    terminate: (code) => process.exit(code),
  });
}

void main().catch((error: unknown) => {
  console.error("worker startup failed", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  process.exit(1);
});
