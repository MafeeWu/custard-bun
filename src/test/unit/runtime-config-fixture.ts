export const validYaml = `
branding:
  name: Custard Bun
  description: Private conversations with consistent AI characters.
  logoPath: /brand/logo.svg
  faviconPath: /brand/favicon.svg
  primaryColor: "#F59E0B"
registration:
  open: true
  maxAttemptsPerHourPerIp: 5
links:
  privacyUrl: https://example.com/privacy
  termsUrl: https://example.com/terms
  supportUrl: mailto:support@example.com
chat:
  firstTokenTimeoutMs: 30000
  requestTimeoutMs: 120000
  promptTokenBudget: 8192
  maxInputCharacters: 12000
  maxOutputTokens: 1024
  defaultUserDailyRequestLimit: 100
  defaultUserDailyTokenLimit: 100000
  defaultInstanceMonthlyRequestLimit: 10000
  defaultInstanceMonthlyTokenBudget: 10000000
  maxConcurrentGenerations: 4
`;

export const validSecretEnv = {
  NODE_ENV: "test",
  DATABASE_URL:
    "postgresql://companion:companion@127.0.0.1:55432/companion_test",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_SECURE: "false",
  SMTP_USER: "test",
  SMTP_PASSWORD: "test",
  SMTP_FROM: "Custard Bun <noreply@example.com>",
  MODEL_API_BASE_URL: "http://127.0.0.1:3102/v1",
  MODEL_API_KEY: "test-model-key",
  MODEL_ID: "test-chat-model",
} as const;
