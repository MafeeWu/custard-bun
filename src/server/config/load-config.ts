import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import {
  publicAppConfigSchema,
  secretConfigSchema,
  type RuntimeConfig,
} from "./schema";

export interface LoadRuntimeConfigInput {
  configPath?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

function formatIssues(
  label: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
) {
  return issues
    .map((issue) => {
      const field =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "<root>";
      return `${label}.${field}: ${issue.message}`;
    })
    .join("; ");
}

export async function loadRuntimeConfig(
  input: LoadRuntimeConfigInput = {},
): Promise<RuntimeConfig> {
  const env = input.env ?? process.env;
  const configPath =
    input.configPath ??
    env.APP_CONFIG_PATH ??
    path.join(process.cwd(), "app.config.yml");

  const source = await readFile(
    /* turbopackIgnore: true */ configPath,
    "utf8",
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read app config at ${configPath}: ${message}`);
  });

  const publicResult = publicAppConfigSchema.safeParse(parse(source));
  if (!publicResult.success) {
    throw new Error(formatIssues("app.config.yml", publicResult.error.issues));
  }

  const secretResult = secretConfigSchema.safeParse({
    NODE_ENV: env.NODE_ENV ?? "development",
    DATABASE_URL: env.DATABASE_URL,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    SMTP_HOST: env.SMTP_HOST,
    SMTP_PORT: env.SMTP_PORT,
    SMTP_SECURE: env.SMTP_SECURE,
    SMTP_USER: env.SMTP_USER,
    SMTP_PASSWORD: env.SMTP_PASSWORD,
    SMTP_FROM: env.SMTP_FROM,
  });
  if (!secretResult.success) {
    throw new Error(formatIssues("environment", secretResult.error.issues));
  }

  const secret = secretResult.data;
  return {
    public: publicResult.data,
    secret: {
      nodeEnv: secret.NODE_ENV,
      databaseUrl: secret.DATABASE_URL,
      betterAuthSecret: secret.BETTER_AUTH_SECRET,
      betterAuthUrl: secret.BETTER_AUTH_URL,
      smtp: {
        host: secret.SMTP_HOST,
        port: secret.SMTP_PORT,
        secure: secret.SMTP_SECURE,
        user: secret.SMTP_USER,
        password: secret.SMTP_PASSWORD,
        from: secret.SMTP_FROM,
      },
    },
  };
}

let runtimeConfigPromise: Promise<RuntimeConfig> | undefined;

export function getRuntimeConfig(): Promise<RuntimeConfig> {
  runtimeConfigPromise ??= loadRuntimeConfig();
  return runtimeConfigPromise;
}
