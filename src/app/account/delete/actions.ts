"use server";
import { headers } from "next/headers";
import { requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/database";
import { getRuntimeConfig } from "@/server/config/load-config";
import { getBoss } from "@/server/jobs/boss";
import { ensureQueues } from "@/server/jobs/queues";
import { createEmailQueue } from "@/server/email/email-queue";
import {
  requestAccountDeletion,
  enqueueAccountDeletionVerification,
} from "@/server/privacy/account-deletion-service";

export interface AccountDeletionActionState {
  status: "idle" | "success" | "error";
  message?: string;
  code?: "rate_limited";
}
export async function requestAccountDeletionAction(
  _state: AccountDeletionActionState,
  _data: FormData,
): Promise<AccountDeletionActionState> {
  void _state;
  void _data;
  const session = await requireSession(await headers());
  try {
    const config = await getRuntimeConfig();
    const boss = await getBoss(config.secret.databaseUrl);
    await ensureQueues(boss);
    const database = await getDatabase();
    const result = await requestAccountDeletion(database, {
      userId: session.user.id,
      email: session.user.email,
      now: new Date(),
    });
    const actionUrl = new URL(
      "/account/delete/confirm",
      config.secret.betterAuthUrl,
    );
    // Fragments never enter reverse-proxy access logs or Referer headers.
    actionUrl.hash = new URLSearchParams({
      token: result.verificationToken,
    }).toString();
    await enqueueAccountDeletionVerification(database, createEmailQueue(boss), {
      userId: session.user.id,
      ...result,
      actionUrl: actionUrl.toString(),
      now: new Date(),
    });
    return {
      status: "success",
      message: "A confirmation link has been sent to your email.",
    };
  } catch (error) {
    if (error instanceof Error && error.message === "DELETION_RATE_LIMITED")
      return {
        status: "error",
        code: "rate_limited",
        message: "Too many attempts. Please try again later.",
      };
    return {
      status: "error",
      message: "Unable to request account deletion. Try again.",
    };
  }
}
