import { z } from "zod";

const publicPath = z.string().startsWith("/");
const httpUrl = z.url({ protocol: /^https?$/ });
const absoluteOrMailtoUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" && !!url.hostname) ||
      (url.protocol === "mailto:" && z.email().safeParse(url.pathname).success)
    );
  } catch {
    return false;
  }
}, "must be a valid https:// or mailto: URL");

export const chatConfigSchema = z
  .object({
    firstTokenTimeoutMs: z.number().int().min(1_000).max(120_000),
    requestTimeoutMs: z.number().int().min(1_000).max(600_000),
    promptTokenBudget: z.number().int().min(512).max(1_000_000),
    maxInputCharacters: z.number().int().min(1).max(1_000_000),
    maxOutputTokens: z.number().int().min(1).max(100_000),
    defaultUserDailyRequestLimit: z.number().int().min(1),
    defaultUserDailyTokenLimit: z.number().int().min(1),
    defaultInstanceMonthlyRequestLimit: z.number().int().min(1),
    defaultInstanceMonthlyTokenBudget: z.number().int().min(1),
    maxConcurrentGenerations: z.number().int().min(1).max(1_000),
  })
  .strict()
  .refine((value) => value.requestTimeoutMs >= value.firstTokenTimeoutMs, {
    message: "request timeout must be at least the first-token timeout",
    path: ["requestTimeoutMs"],
  })
  .refine((value) => value.maxOutputTokens < value.promptTokenBudget, {
    message: "max output tokens must be below the prompt token budget",
    path: ["maxOutputTokens"],
  });

export const publicAppConfigSchema = z
  .object({
    branding: z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().min(1).max(200),
        logoPath: publicPath,
        faviconPath: publicPath,
        primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      })
      .strict(),
    registration: z
      .object({
        open: z.boolean(),
        maxAttemptsPerHourPerIp: z.number().int().min(1).max(100),
      })
      .strict(),
    links: z
      .object({
        privacyUrl: absoluteOrMailtoUrl,
        termsUrl: absoluteOrMailtoUrl,
        supportUrl: absoluteOrMailtoUrl,
      })
      .strict(),
    chat: chatConfigSchema,
  })
  .strict();

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const secretConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    DATABASE_URL: z.string().url().startsWith("postgresql://"),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: httpUrl,
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_SECURE: booleanString,
    SMTP_USER: z.string().min(1),
    SMTP_PASSWORD: z.string().min(1),
    SMTP_FROM: z.string().min(3),
    MODEL_API_BASE_URL: httpUrl,
    MODEL_API_KEY: z.string().min(8),
    MODEL_ID: z.string().trim().min(1),
  })
  .strict();

export type PublicAppConfig = z.infer<typeof publicAppConfigSchema>;
export type ChatDeploymentConfig = z.infer<typeof chatConfigSchema>;

export interface ModelSecretConfig {
  apiBaseUrl: string;
  apiKey: string;
  modelId: string;
}

export interface SecretConfig {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
  };
  model: ModelSecretConfig;
}

export interface RuntimeConfig {
  public: PublicAppConfig;
  secret: SecretConfig;
}
