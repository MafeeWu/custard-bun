import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import type { RuntimeConfig } from "@/server/config/schema";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import type { EmailQueue } from "@/server/email/email-queue";
import { assertRegistrationOpen } from "./registration-policy";

export interface AuthDependencies {
  database: ReturnType<typeof createDatabase>;
  config: RuntimeConfig;
  emailQueue: EmailQueue;
}

export function createAuth({
  database,
  config,
  emailQueue,
}: AuthDependencies) {
  return betterAuth({
    appName: config.public.branding.name,
    baseURL: config.secret.betterAuthUrl,
    secret: config.secret.betterAuthSecret,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
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
        await emailQueue.enqueue({
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
        await emailQueue.enqueue({
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
          await emailQueue.enqueue({
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
        if (ctx.path === "/sign-up/email") {
          assertRegistrationOpen(config.public.registration.open);
        }
      }),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
    },
    advanced: {
      database: {
        joins: true,
      },
    },
    plugins: [admin(), nextCookies()],
  });
}
