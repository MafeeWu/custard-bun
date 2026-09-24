import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
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
  async function acceptEmail(job: EmailQueueJob) {
    try {
      const id = await emailQueue.enqueue(job);
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
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
      transaction: true,
    }),
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
        await acceptEmail({
          kind: "reset-password",
          to: user.email,
          actionUrl: url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await acceptEmail({
          kind: "verify-email",
          to: user.email,
          actionUrl: url,
        });
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user, url }) => {
          await acceptEmail({
            kind: "delete-account",
            to: user.email,
            actionUrl: url,
          });
        },
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
