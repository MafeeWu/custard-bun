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
} as const;
