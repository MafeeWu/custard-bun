import { loadRuntimeConfig } from "@/server/config/load-config";
import type { AuthEmailJob } from "@/server/email/email-job";
import { deliverAuthEmail } from "@/server/email/smtp-delivery";
import { createBoss } from "@/server/jobs/boss";
import { AUTH_EMAIL_QUEUE, ensureQueues } from "@/server/jobs/queues";

const config = await loadRuntimeConfig();
const boss = createBoss(config.secret.databaseUrl);

boss.on("error", (error) => {
  console.error("worker error", {
    name: error.name,
    message: error.message,
  });
});

await boss.start();
await ensureQueues(boss);
await boss.work<AuthEmailJob>(AUTH_EMAIL_QUEUE, async ([job]) => {
  await deliverAuthEmail(job.data, {
    smtp: config.secret.smtp,
    brandName: config.public.branding.name,
  });
});

async function shutdown() {
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
