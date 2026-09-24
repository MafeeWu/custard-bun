import { defineConfig, devices } from "@playwright/test";
import { e2eEnvironment } from "./tests/e2e/support/environment";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm build && pnpm start",
      url: "http://127.0.0.1:3000/",
      reuseExistingServer: false,
      env: e2eEnvironment,
    },
    {
      command: "pnpm exec tsx tests/e2e/support/worker-harness.ts",
      url: "http://127.0.0.1:3101/",
      reuseExistingServer: false,
      env: e2eEnvironment,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
