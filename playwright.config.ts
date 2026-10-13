import { defineConfig, devices } from "@playwright/test";
import { e2eEnvironment } from "./tests/e2e/support/environment";

const fakeModelBaseUrl =
  process.env.E2E_FAKE_MODEL_BASE_URL ?? "http://127.0.0.1:3102";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["visual-redesign.spec.ts", "accessibility.spec.ts"],
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "pnpm db:deploy && pnpm exec tsx tests/e2e/support/reset-state.ts && pnpm build && mkdir -p test-results && : > test-results/e2e-app.log && exec pnpm start >> test-results/e2e-app.log 2>&1",
      url: "http://127.0.0.1:3000/",
      reuseExistingServer: false,
      timeout: 180_000,
      env: e2eEnvironment,
    },
    {
      command: "mkdir -p test-results && : > test-results/e2e-worker.log && exec pnpm exec tsx tests/e2e/support/worker-harness.ts >> test-results/e2e-worker.log 2>&1",
      url: "http://127.0.0.1:3101/",
      reuseExistingServer: false,
      env: e2eEnvironment,
    },
    {
      command: "pnpm exec tsx tests/e2e/support/fake-model-server.ts",
      url: `${fakeModelBaseUrl}/`,
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
