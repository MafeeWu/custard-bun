import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.config";
import { visualFixtureValues } from "./tests/e2e/support/visual-fixtures";

const fakeModelBaseUrl = "http://127.0.0.1:3202";
process.env.E2E_FAKE_MODEL_BASE_URL = fakeModelBaseUrl;

const visualWebServer = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer.map((server, index) => ({
      ...server,
      url: index === 2 ? `${fakeModelBaseUrl}/` : server.url,
      env: {
        ...server.env,
        APP_CONFIG_PATH: "tests/e2e/visual.app.config.yml",
        MODEL_API_BASE_URL: `${fakeModelBaseUrl}/${visualFixtureValues.providerEndpoint}/v1`,
        MODEL_API_KEY: visualFixtureValues.providerKey,
        ...(index === 2 ? { E2E_FAKE_MODEL_PORT: "3202" } : {}),
      },
    }))
  : baseConfig.webServer;

export default defineConfig({
  ...baseConfig,
  testMatch: ["visual-redesign.spec.ts", "accessibility.spec.ts"],
  testIgnore: [],
  outputDir: "test-results/ui-evidence",
  use: {
    ...baseConfig.use,
    trace: "off",
  },
  webServer: visualWebServer,
  projects: [
    {
      name: "desktop-light",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
        reducedMotion: "no-preference",
      },
    },
    {
      name: "desktop-dark",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "dark",
        reducedMotion: "no-preference",
      },
    },
    {
      name: "mobile-light-reduced",
      use: {
        ...devices["iPhone 13"],
        colorScheme: "light",
        reducedMotion: "reduce",
      },
    },
  ],
});
