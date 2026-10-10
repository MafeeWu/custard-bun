import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  betterAuth,
  type BetterAuthOptions,
  type DBAdapter,
  type DBTransactionAdapter,
} from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import type { RuntimeConfig } from "../config/schema";
import { createDatabase } from "../db/client";
import * as schema from "../db/schema";
import type { EmailQueue } from "../email/email-queue";
import { assertRegistrationOpen } from "./registration-policy";
import type { EmailQueueJob } from "../email/email-job";
import { safeErrorName, type SafeLogger } from "../logging/safe-error";
import { eq } from "drizzle-orm";
import { lockUserChatMutation } from "../chat/chat-locks";

export interface AuthDependencies {
  database: ReturnType<typeof createDatabase>;
  config: RuntimeConfig;
  emailQueue: EmailQueue;
  logger?: SafeLogger;
}

export function createAuth({
  database,
  config,
  emailQueue,
  logger = console,
}: AuthDependencies) {
  const adapter = drizzleAdapter(database, {
    provider: "pg",
    schema,
    transaction: true,
  });
  const uncommittedUsers = new Set<string>();

  function rethrowSessionError(error: unknown): never {
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      cause instanceof Error &&
      "code" in cause &&
      cause.code === "23514" &&
      (cause.message === "cannot create a session for a disabled user" ||
        cause.message === "account access is disabled")
    ) {
      // Do not let a rejected INSERT expose SQL parameters (including tokens)
      // through Better Auth's unexpected-error logger.
      throw new APIError("FORBIDDEN", {
        code: "BANNED_USER",
        message: "This account is disabled.",
      });
    }
    throw error;
  }

  function guardSessions(
    instance: DBTransactionAdapter,
    createdUsers?: Set<string>,
  ): DBTransactionAdapter {
    return {
      ...instance,
      async create<T extends Record<string, unknown>, R = T>(input: {
        model: string;
        data: Omit<T, "id">;
        select?: string[];
        forceAllowId?: boolean;
      }): Promise<R> {
        try {
          const result = await instance.create<T, R>(input);
          const record = result as { id?: unknown } | null;
          if (
            input.model === "user" &&
            createdUsers &&
            record &&
            typeof record.id === "string"
          ) {
            createdUsers.add(record.id);
            uncommittedUsers.add(record.id);
          }
          return result;
        } catch (error) {
          rethrowSessionError(error);
        }
      },
      async update(input) {
        try {
          return await instance.update(input);
        } catch (error) {
          rethrowSessionError(error);
        }
      },
      async delete(input) {
        if (input.model === "user")
          throw new APIError("FORBIDDEN", {
            code: "APPLICATION_PURGE_REQUIRED",
            message: "Account removal is not available here.",
          });
        return instance.delete(input);
      },
      async deleteMany(input) {
        if (input.model === "user")
          throw new APIError("FORBIDDEN", {
            code: "APPLICATION_PURGE_REQUIRED",
            message: "Account removal is not available here.",
          });
        return instance.deleteMany(input);
      },
      async findOne<T>(
        input: Parameters<DBTransactionAdapter["findOne"]>[0],
      ): Promise<T | null> {
        const result = await instance.findOne<T>(input);
        // Better Auth's authoritative session lookup joins the current user.
        const owner = (
          result as {
            user?: { banned?: boolean; deletionPendingAt?: Date | null };
          } | null
        )?.user;
        return input.model === "session" &&
          (owner?.banned === true || owner?.deletionPendingAt)
          ? null
          : result;
      },
    };
  }

  async function acceptEmail(job: EmailQueueJob, ownerId?: string) {
    try {
      let id: string;
      if (ownerId && !uncommittedUsers.has(ownerId)) {
        id = await database.transaction(async (tx) => {
          await lockUserChatMutation(tx, ownerId);
          const [owner] = await tx
            .select()
            .from(schema.user)
            .where(eq(schema.user.id, ownerId));
          return emailQueue.enqueue(
            !owner || owner.deletionPendingAt ? { kind: "noop" } : job,
          );
        });
      } else id = await emailQueue.enqueue(job);
      if (!id) throw new Error("Email not accepted");
    } catch (error) {
      logger.error("auth email acceptance failed", {
        name: safeErrorName(error),
      });
      throw new APIError("INTERNAL_SERVER_ERROR", {
        code: "EMAIL_QUEUE_UNAVAILABLE",
        message: "Unable to accept email request. Please try again.",
      });
    }
  }

  return betterAuth({
    appName: config.public.branding.name,
    baseURL: config.secret.betterAuthUrl,
    secret: config.secret.betterAuthSecret,
    logger: {
      log(level, _message, ...args: unknown[]) {
        logger.error(`auth ${level}`, {
          name: safeErrorName(args.find((arg) => arg instanceof Error)),
        });
      },
    },
    onAPIError: {
      onError(error) {
        logger.error("auth request failed", { name: safeErrorName(error) });
      },
    },
    database: (options: BetterAuthOptions): DBAdapter => {
      const instance = adapter(options);
      return {
        ...guardSessions(instance),
        transaction: async (callback) => {
          const createdUsers = new Set<string>();
          try {
            return await instance.transaction((transaction) =>
              callback(guardSessions(transaction, createdUsers)),
            );
          } finally {
            for (const id of createdUsers) uncommittedUsers.delete(id);
          }
        },
      };
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      onExistingUserSignUp: async () => acceptEmail({ kind: "noop" }),
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        role: "user",
        banned: false,
        banReason: null,
        banExpires: null,
        ...additionalFields,
        id,
      }),
      sendResetPassword: async ({ user, url }) => {
        await acceptEmail(
          {
            kind: "reset-password",
            to: user.email,
            actionUrl: url,
          },
          user.id,
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await acceptEmail(
          {
            kind: "verify-email",
            to: user.email,
            actionUrl: url,
          },
          user.id,
        );
      },
    },
    user: {
      additionalFields: {
        deletionPendingAt: { type: "date", required: false, input: false },
      },
      deleteUser: {
        enabled: false,
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-up/email": {
          window: 60 * 60,
          max: config.public.registration.maxAttemptsPerHourPerIp,
        },
        "/sign-in/email": {
          window: 60,
          max: 5,
        },
        "/request-password-reset": {
          window: 60 * 15,
          max: 3,
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Durable acceptance must complete in the request, never be swallowed by
        // Better Auth's default best-effort background callback runner.
        ctx.context.runInBackgroundOrAwait = async (promise) => promise;
        if (ctx.path === "/sign-up/email") {
          assertRegistrationOpen(config.public.registration.open);
        }
        if (
          ctx.path === "/request-password-reset" ||
          ctx.path === "/send-verification-email"
        ) {
          const existing = await ctx.context.internalAdapter.findUserByEmail(
            ctx.body.email,
          );
          if (existing) {
            const [owner] = await database
              .select({ deletionPendingAt: schema.user.deletionPendingAt })
              .from(schema.user)
              .where(eq(schema.user.id, existing.user.id));
            if (owner?.deletionPendingAt) {
              await acceptEmail({ kind: "noop" });
              return ctx.json(
                ctx.path === "/request-password-reset"
                  ? {
                      status: true,
                      message:
                        "If this email exists in our system, check your email for the reset link",
                    }
                  : { status: true },
              );
            }
          }
          if (
            !existing ||
            (ctx.path === "/send-verification-email" &&
              existing.user.emailVerified)
          ) {
            await acceptEmail({ kind: "noop" });
          }
        }
      }),
    },
    session: {
      cookieCache: { enabled: false },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["x-companion-client-ip"] },
      database: {
        joins: true,
      },
    },
    plugins: [admin(), nextCookies()],
  });
}
