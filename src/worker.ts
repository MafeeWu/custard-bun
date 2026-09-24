import { loadRuntimeConfig } from "@/server/config/runtime-config-core";
import { createDatabase } from "@/server/db/client";
import type { AuthEmailJob } from "@/server/email/email-job";
import { deliverAuthEmail } from "@/server/email/smtp-delivery";
import { startWorkerHeartbeat } from "@/server/health/worker-heartbeat";
import { createBoss } from "@/server/jobs/boss";
import { AUTH_EMAIL_QUEUE, ensureQueues } from "@/server/jobs/queues";
import { closeWorkerResources } from "@/server/worker/lifecycle";

async function main(): Promise<void> {
  const config = await loadRuntimeConfig();
  const database = createDatabase(config.secret.databaseUrl);
  const boss = createBoss(config.secret.databaseUrl);

  boss.on("error", (error) => {
    console.error("worker error", {
      name: error.name,
      message: error.message,
    });
  });

  await boss.start();
  await ensureQueues(boss);
  const stopHeartbeat = await startWorkerHeartbeat(database);
  await boss.work<AuthEmailJob>(AUTH_EMAIL_QUEUE, async ([job]) => {
    await deliverAuthEmail(job.data, {
      smtp: config.secret.smtp,
      brandName: config.public.branding.name,
    });
  });

  let shutdownPromise: Promise<void> | undefined;

  async function shutdown(): Promise<void> {
    shutdownPromise ??= closeWorkerResources({
      stopHeartbeat,
      boss,
      database,
    });

    try {
      await shutdownPromise;
      process.exitCode = 0;
    } catch (error: unknown) {
      console.error("worker shutdown failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      process.exitCode = 1;
    }
  }

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main().catch((error: unknown) => {
  console.error("worker startup failed", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  process.exitCode = 1;
});
