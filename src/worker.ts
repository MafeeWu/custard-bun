import { loadRuntimeConfig } from "@/server/config/runtime-config-core";
import { createDatabase } from "@/server/db/client";
import type { EmailQueueJob } from "@/server/email/email-job";
import { processEmail } from "@/server/email/process-email";
import { deliverAuthEmail } from "@/server/email/smtp-delivery";
import { startWorkerHeartbeat } from "@/server/health/worker-heartbeat";
import { createBoss } from "@/server/jobs/boss";
import { AUTH_EMAIL_QUEUE, ensureQueues } from "@/server/jobs/queues";
import { runWorkerProcess } from "@/server/worker/lifecycle";
import { startupDiagnostic } from "@/server/config/configuration-error";

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
      await boss.work<EmailQueueJob>(AUTH_EMAIL_QUEUE, async ([job]) => {
        await processEmail(database, job.data, (email) =>
          deliverAuthEmail(email, {
            smtp: config.secret.smtp,
            brandName: config.public.branding.name,
          }),
        );
      });
    },
    onSignal: (signal, listener) => process.once(signal, listener),
    logger: console,
    terminate: (code) => process.exit(code),
  });
}

void main().catch((error: unknown) => {
  console.error("worker startup failed:", startupDiagnostic(error));
  process.exit(1);
});
