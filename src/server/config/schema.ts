import { z } from "zod";

const publicPath = z.string().startsWith("/");
const absoluteOrMailtoUrl = z
  .string()
  .refine(
    (value) => value.startsWith("https://") || value.startsWith("mailto:"),
    "must use https:// or mailto:",
  );

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
    BETTER_AUTH_URL: z.string().url(),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_SECURE: booleanString,
    SMTP_USER: z.string().min(1),
    SMTP_PASSWORD: z.string().min(1),
    SMTP_FROM: z.string().min(3),
  })
  .strict();

export type PublicAppConfig = z.infer<typeof publicAppConfigSchema>;

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
}

export interface RuntimeConfig {
  public: PublicAppConfig;
  secret: SecretConfig;
}
