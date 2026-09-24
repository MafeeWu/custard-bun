import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000/",
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      APP_CONFIG_PATH: "app.config.yml",
      NODE_ENV: "test",
      DATABASE_URL:
        "postgresql://postgres:postgres@127.0.0.1:55432/companion_test",
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      SMTP_SECURE: "false",
      SMTP_USER: "test",
      SMTP_PASSWORD: "test",
      SMTP_FROM: "Custard Bun <noreply@example.com>",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
