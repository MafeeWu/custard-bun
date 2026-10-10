import type { createDatabase } from "../db/client";
import type { AuthEmailJob, EmailQueueJob } from "./email-job";
import { recordDeliveryHealth } from "../health/worker-heartbeat";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { accountDeletionRequest, user } from "../db/schema";
import {
  lockGlobalChatMutation,
  lockUserChatMutation,
} from "../chat/chat-locks";

export async function processEmail(
  database: ReturnType<typeof createDatabase>,
  job: EmailQueueJob,
  deliver: (job: AuthEmailJob) => Promise<void>,
  queueJobId?: string,
): Promise<void> {
  if (job.kind === "noop") return;
  let delivered = false;
  try {
    delivered = await database.transaction(async (tx) => {
      await lockGlobalChatMutation(tx);
      const [preview] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, job.to));
      if (!preview) return false;
      await lockUserChatMutation(tx, preview.id);
      const [owner] = await tx
        .select()
        .from(user)
        .where(eq(user.id, preview.id));
      if (!owner || owner.deletionPendingAt || owner.banned) return false;
      if (job.kind === "delete-account") {
        const [request] = await tx
          .select()
          .from(accountDeletionRequest)
          .where(eq(accountDeletionRequest.id, job.deletionRequestId ?? ""));
        const token =
          new URLSearchParams(new URL(job.actionUrl).hash.slice(1)).get(
            "token",
          ) ?? "";
        if (
          !request ||
          request.userId !== owner.id ||
          request.status !== "pending_confirmation" ||
          !request.verificationExpiresAt ||
          request.verificationExpiresAt <= new Date() ||
          request.verificationTokenHash !==
            createHash("sha256").update(token).digest("hex")
        )
          return false;
      }
      // Confirmation waits for delivery; a locked or purged owner is never contacted.
      await deliver(job);
      return true;
    });
  } catch {
    try {
      await recordDeliveryHealth(database, false);
    } catch {
      throw new Error("SMTP_DELIVERY_HEALTH_WRITE_FAILED");
    }
    throw new Error("SMTP_DELIVERY_FAILED");
  }
  // Retained successful/skipped email jobs carry no recipient or verification URL.
  if (queueJobId) {
    try {
      await database.execute(sql`UPDATE job.job SET data = '{"kind":"noop"}'::jsonb
        WHERE id = ${queueJobId} AND name = 'auth-email'`);
    } catch {
      throw new Error("SMTP_DELIVERY_HEALTH_WRITE_FAILED");
    }
  }
  if (!delivered) return;
  try {
    await recordDeliveryHealth(database, true);
  } catch {
    throw new Error("SMTP_DELIVERY_HEALTH_WRITE_FAILED");
  }
}
