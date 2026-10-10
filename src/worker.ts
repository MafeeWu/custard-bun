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
import { OpenAiCompatibleGateway } from "@/server/model-gateway/openai-compatible-gateway";
import { createTokenCounter } from "@/server/chat/token-counter";
import { registerMemoryExtractionWorker } from "@/server/memory/memory-job";
import { registerRelationshipSummaryWorker } from "@/server/memory/relationship-summary-job";
import { relationshipSummaryPolicyFromConfig } from "@/server/memory/relationship-summary-service";
import { registerDataExportWorker } from "@/server/privacy/data-export-job";
import { registerAccountPurgeWorker } from "@/server/privacy/account-purge-job";

async function main(): Promise<void> {
  const config = await loadRuntimeConfig();
  const database = createDatabase(config.secret.databaseUrl, {
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  });
  const tokenCounter = createTokenCounter(config.secret.model.modelId);
  const summaryPolicy = relationshipSummaryPolicyFromConfig(config);
  let stopMemoryWorker: (() => Promise<void>) | undefined;
  let stopSummaryWorker: (() => Promise<void>) | undefined;
  let stopExportWorker: (() => Promise<void>) | undefined;
  let stopPurgeWorker: (() => Promise<void>) | undefined;

  await runWorkerProcess({
    createDatabase: () => database,
    createBoss: () => createBoss(config.secret.databaseUrl),
    ensureQueues,
    startHeartbeat: async () => {
      const heartbeat = await startWorkerHeartbeat(database);
      return {
        stop: async () => {
          await stopMemoryWorker?.();
          await stopSummaryWorker?.();
          await stopExportWorker?.();
          await stopPurgeWorker?.();
          await heartbeat.stop();
        },
      };
    },
    registerWorker: async (boss) => {
      await boss.work<EmailQueueJob>(AUTH_EMAIL_QUEUE, async ([job]) => {
        await processEmail(
          database,
          job.data,
          (email) =>
            deliverAuthEmail(email, {
              smtp: config.secret.smtp,
              brandName: config.public.branding.name,
            }),
          job.id,
        );
      });
      stopMemoryWorker = await registerMemoryExtractionWorker(
        database,
        boss,
        new OpenAiCompatibleGateway(config.secret.model),
        tokenCounter,
        console,
      );
      stopSummaryWorker = await registerRelationshipSummaryWorker(
        database,
        boss,
        new OpenAiCompatibleGateway(config.secret.model),
        tokenCounter,
        console,
        summaryPolicy,
      );
      stopExportWorker = await registerDataExportWorker(
        database,
        boss,
        console,
        {
          maxArchiveBytes: config.public.memory.maxExportArchiveBytes,
        },
      );
      stopPurgeWorker = await registerAccountPurgeWorker(
        database,
        boss,
        console,
      );
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
