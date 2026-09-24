import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { ConfigurationError } from "./configuration-error";
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
  issues: Array<{ path: PropertyKey[]; message: string; code: string }>,
) {
  return issues
    .map((issue) => {
      const field =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "<root>";
      return `${label}.${field}: ${issue.code === "unrecognized_keys" ? "unknown configuration key" : issue.message}`;
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
  ).catch(() => {
    throw new ConfigurationError(
      "app.config.yml.<root>: Unable to read configuration file",
    );
  });

  let rawYaml: unknown;
  try {
    rawYaml = parse(source);
  } catch {
    throw new ConfigurationError("app.config.yml.<root>: Invalid YAML syntax");
  }

  const publicResult = publicAppConfigSchema.safeParse(rawYaml);
  if (!publicResult.success) {
    throw new ConfigurationError(
      formatIssues("app.config.yml", publicResult.error.issues),
    );
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
    throw new ConfigurationError(
      formatIssues("environment", secretResult.error.issues),
    );
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
