import "server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { getRuntimeConfig } from "@/server/config/load-config";
import {
  lockUserChatMutation,
  type ChatTransaction,
} from "@/server/chat/chat-locks";
import { settleUserGenerationsBeforeDeletion } from "@/server/chat/quota-service";
import { settleUserExtractionWorkBeforeDeletion } from "@/server/memory/background-usage-service";
import {
  accountDeletionRequest,
  memoryExtractionRun,
  relationshipSummaryRun,
  rateLimit,
  session,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import { cancelDataExportsForUser } from "./data-export-service";
import type { EmailQueue } from "@/server/email/email-queue";

const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
function unavailable(): never {
  throw new Error("DELETION_UNAVAILABLE");
}
async function signature(payload: string) {
  const config = await getRuntimeConfig();
  return createHmac("sha256", config.secret.betterAuthSecret)
    .update("account-deletion-v1:" + payload)
    .digest("hex");
}

export async function requestAccountDeletion(
  database: Database,
  input: { userId: string; email: string; now: Date },
): Promise<{ requestId: string; verificationToken: string }> {
  try {
    return await database.transaction(async (tx) => {
      await lockUserChatMutation(tx, input.userId);
      const [owner] = await tx
        .select()
        .from(user)
        .where(eq(user.id, input.userId))
        .for("update");
      if (
        !owner ||
        owner.banned ||
        owner.deletionPendingAt ||
        owner.email !== input.email
      )
        unavailable();
      const [existing] = await tx
        .select()
        .from(accountDeletionRequest)
        .where(eq(accountDeletionRequest.userId, input.userId))
        .for("update");
      if (existing && existing.status !== "pending_confirmation") unavailable();
      const key = `account-delete:${input.userId}`;
      const [limit] = await tx
        .select()
        .from(rateLimit)
        .where(eq(rateLimit.key, key))
        .for("update");
      const currentWindow =
        limit && input.now.getTime() - limit.lastRequest < TOKEN_LIFETIME_MS;
      if (currentWindow && limit.count >= 3)
        throw new Error("DELETION_RATE_LIMITED");
      await tx
        .insert(rateLimit)
        .values({
          id: randomUUID(),
          key,
          count: currentWindow ? limit.count + 1 : 1,
          lastRequest: currentWindow ? limit.lastRequest : input.now.getTime(),
        })
        .onConflictDoUpdate({
          target: rateLimit.key,
          set: {
            count: currentWindow ? limit.count + 1 : 1,
            lastRequest: currentWindow
              ? limit.lastRequest
              : input.now.getTime(),
          },
        });
      const requestId = existing?.id ?? randomUUID();
      const expires = new Date(input.now.getTime() + TOKEN_LIFETIME_MS);
      const payload = `${requestId}.${expires.getTime()}.${randomBytes(32).toString("hex")}`;
      // The signature authenticates content-free terminal replays after the stored hash is erased.
      const verificationToken = `${payload}.${await signature(payload)}`;
      await tx
        .insert(accountDeletionRequest)
        .values({
          id: requestId,
          userId: input.userId,
          currentStage: "confirmation",
          verificationTokenHash: hash(verificationToken),
          verificationExpiresAt: expires,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: accountDeletionRequest.id,
          set: {
            verificationTokenHash: hash(verificationToken),
            verificationExpiresAt: expires,
            updatedAt: input.now,
          },
        });
      return { requestId, verificationToken };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DELETION_RATE_LIMITED")
      throw new Error("DELETION_RATE_LIMITED");
    unavailable();
  }
}

export async function lockAccountWork(
  tx: ChatTransaction,
  userId: string,
  now: Date,
): Promise<void> {
  await lockUserChatMutation(tx, userId);
  await settleUserGenerationsBeforeDeletion(tx, userId, now);
  await settleUserExtractionWorkBeforeDeletion(tx, { userId, now });
  await tx.execute(sql`UPDATE memory_extraction_executions
    SET candidates = NULL, response_at = COALESCE(response_at, ${now}), settled_at = COALESCE(settled_at, ${now})
    WHERE run_id IN (SELECT id FROM memory_extraction_runs WHERE user_id = ${userId})`);
  await tx.execute(sql`UPDATE relationship_summary_executions
    SET summary = NULL, response_at = COALESCE(response_at, ${now}), settled_at = COALESCE(settled_at, ${now})
    WHERE run_id IN (SELECT id FROM relationship_summary_runs WHERE user_id = ${userId})`);
  await tx
    .update(userCharacterMemorySetting)
    .set({
      memoryEpoch: sql`${userCharacterMemorySetting.memoryEpoch} + 1`,
      updatedAt: now,
    })
    .where(eq(userCharacterMemorySetting.userId, userId));
  for (const operation of [memoryExtractionRun, relationshipSummaryRun]) {
    await tx
      .update(operation)
      .set({
        status: "cancelled",
        claimToken: null,
        leaseExpiresAt: null,
        nextRetryAt: null,
        finishedAt: now,
        updatedAt: now,
        errorCategory: "account_deleted",
      })
      .where(
        and(
          eq(operation.userId, userId),
          inArray(operation.status, [
            "pending",
            "queued",
            "running",
            "retrying",
          ]),
        ),
      );
    // SQL invalidation triggers may already have cancelled a run. Remove every
    // outstanding claim without rewriting immutable terminal receipts.
    await tx
      .update(operation)
      .set({ claimToken: null, leaseExpiresAt: null })
      .where(eq(operation.userId, userId));
  }
  await cancelDataExportsForUser(tx, userId, now);
}

export async function enqueueAccountDeletionVerification(
  database: Database,
  queue: EmailQueue,
  input: {
    userId: string;
    requestId: string;
    verificationToken: string;
    actionUrl: string;
    now: Date;
  },
): Promise<void> {
  try {
    await database.transaction(async (tx) => {
      await lockUserChatMutation(tx, input.userId);
      const [owner] = await tx
        .select()
        .from(user)
        .where(eq(user.id, input.userId));
      const [request] = await tx
        .select()
        .from(accountDeletionRequest)
        .where(eq(accountDeletionRequest.id, input.requestId))
        .for("update");
      if (
        !owner ||
        owner.deletionPendingAt ||
        owner.banned ||
        !request ||
        request.userId !== owner.id ||
        request.status !== "pending_confirmation" ||
        !request.verificationExpiresAt ||
        request.verificationExpiresAt <= input.now ||
        request.verificationTokenHash !== hash(input.verificationToken)
      )
        unavailable();
      // Hold the confirmation fence through durable acceptance so it cannot
      // remove private queue bytes before a delayed publication recreates them.
      const id = await queue.enqueue({
        kind: "delete-account",
        to: owner.email,
        actionUrl: input.actionUrl,
        deletionRequestId: request.id,
      });
      if (!id) unavailable();
    });
  } catch {
    unavailable();
  }
}

export async function confirmAccountDeletion(
  database: Database,
  input: { token: string; now: Date },
): Promise<{ requestId: string }> {
  try {
    if (typeof input.token !== "string" || input.token.length > 300)
      unavailable();
    const match =
      /^([0-9a-f-]{36})\.(\d{13})\.([0-9a-f]{64})\.([0-9a-f]{64})$/.exec(
        input.token,
      );
    if (!match) unavailable();
    const payload = input.token.slice(0, input.token.lastIndexOf("."));
    if (
      !timingSafeEqual(
        Buffer.from(match[4], "hex"),
        Buffer.from(await signature(payload), "hex"),
      )
    )
      unavailable();
    const requestId = match[1];
    const [preview] = await database
      .select({ userId: accountDeletionRequest.userId })
      .from(accountDeletionRequest)
      .where(eq(accountDeletionRequest.id, requestId));
    if (!preview) unavailable();
    return await database.transaction(async (tx) => {
      // All product work uses global settings -> user -> request, including duplicate confirmation.
      if (preview.userId) await lockUserChatMutation(tx, preview.userId);
      const [request] = await tx
        .select()
        .from(accountDeletionRequest)
        .where(eq(accountDeletionRequest.id, requestId))
        .for("update");
      if (!request) unavailable();
      if (request.status !== "pending_confirmation") return { requestId };
      if (
        !request.userId ||
        !request.verificationExpiresAt ||
        request.verificationExpiresAt <= input.now ||
        request.verificationTokenHash !== hash(input.token)
      )
        unavailable();
      await tx
        .update(user)
        .set({ deletionPendingAt: input.now, updatedAt: input.now })
        .where(eq(user.id, request.userId));
      // Remove IP-linked rate limits before revoking the only durable association with those IPs.
      await tx.execute(sql`DELETE FROM rate_limit WHERE key IN (
        SELECT r.key FROM rate_limit r JOIN session s ON r.key LIKE s.ip_address || '|%'
        WHERE s.user_id = ${request.userId} AND s.ip_address IS NOT NULL
      ) OR strpos(key, ${request.userId}) > 0`);
      await tx.delete(session).where(eq(session.userId, request.userId));
      await lockAccountWork(tx, request.userId, input.now);
      // The locked row is the durable purge outbox; queue publication is restartable.
      await tx
        .update(accountDeletionRequest)
        .set({
          status: "locked",
          currentStage: "settle",
          verificationTokenHash: null,
          verificationExpiresAt: null,
          verificationConsumedAt: input.now,
          confirmedAt: input.now,
          lockedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(accountDeletionRequest.id, requestId));
      // Email queue is the only allowed transient transport of raw verification URLs.
      const queue = await tx.execute<{ present: boolean }>(
        sql`SELECT to_regclass('job.job') IS NOT NULL AS present`,
      );
      if (queue.rows[0]?.present)
        await tx.execute(sql`DELETE FROM job.job WHERE name IN ('auth-email', 'auth-email-dead-letter')
        AND (data->>'to' = (SELECT email FROM "user" WHERE id = ${request.userId}) OR data->>'deletionRequestId' = ${requestId})`);
      return { requestId };
    });
  } catch {
    unavailable();
  }
}
