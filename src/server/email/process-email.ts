import type { createDatabase } from "../db/client";
import type { AuthEmailJob, EmailQueueJob } from "./email-job";
import { recordDeliveryHealth } from "../health/worker-heartbeat";

export async function processEmail(
  database: ReturnType<typeof createDatabase>,
  job: EmailQueueJob,
  deliver: (job: AuthEmailJob) => Promise<void>,
): Promise<void> {
  if (job.kind === "noop") return;
  try {
    await deliver(job);
  } catch {
    try {
      await recordDeliveryHealth(database, false);
    } catch {
      throw new Error("SMTP_DELIVERY_HEALTH_WRITE_FAILED");
    }
    throw new Error("SMTP_DELIVERY_FAILED");
  }
  try {
    await recordDeliveryHealth(database, true);
  } catch {
    throw new Error("SMTP_DELIVERY_HEALTH_WRITE_FAILED");
  }
}
