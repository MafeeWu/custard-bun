import { expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { privacySentinels } from "../../tests/release/privacy-scan";
import { visualFixtureValues } from "../../tests/e2e/support/visual-fixtures";

async function loadPlaywrightConfig(
  ciValue: string | undefined,
  env: Record<string, string | undefined> = {},
) {
  const original = {
    CI: process.env.CI,
    DATABASE_URL: process.env.DATABASE_URL,
    E2E_FAKE_MODEL_BASE_URL: process.env.E2E_FAKE_MODEL_BASE_URL,
    E2E_FAKE_MODEL_PORT: process.env.E2E_FAKE_MODEL_PORT,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  };

  if (ciValue === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = ciValue;
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  vi.resetModules();

  try {
    const { default: config } = await import("../../playwright.config");
    return config;
  } finally {
    if (original.CI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = original.CI;
    }
    if (original.DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original.DATABASE_URL;
    }
    if (original.TEST_DATABASE_URL === undefined) {
      delete process.env.TEST_DATABASE_URL;
    } else {
      process.env.TEST_DATABASE_URL = original.TEST_DATABASE_URL;
    }
    if (original.E2E_FAKE_MODEL_BASE_URL === undefined) {
      delete process.env.E2E_FAKE_MODEL_BASE_URL;
    } else {
      process.env.E2E_FAKE_MODEL_BASE_URL =
        original.E2E_FAKE_MODEL_BASE_URL;
    }
    if (original.E2E_FAKE_MODEL_PORT === undefined) {
      delete process.env.E2E_FAKE_MODEL_PORT;
    } else {
      process.env.E2E_FAKE_MODEL_PORT = original.E2E_FAKE_MODEL_PORT;
    }
  }
}

test.each([
  ["local", undefined],
  ["ci", "1"],
])(
  "always launches the configured web server when %s",
  async (_label, ciValue) => {
    const config = await loadPlaywrightConfig(ciValue);
    if (!Array.isArray(config.webServer)) {
      throw new Error("Expected app and worker Playwright web servers");
    }

    expect(config.webServer).toHaveLength(3);
    expect(config.testIgnore).toEqual([
      "visual-redesign.spec.ts",
      "accessibility.spec.ts",
    ]);
    expect(config.webServer[0]).toMatchObject({
      command:
        "pnpm db:deploy && pnpm exec tsx tests/e2e/support/reset-state.ts && pnpm build && mkdir -p test-results && : > test-results/e2e-app.log && exec pnpm start >> test-results/e2e-app.log 2>&1",
      reuseExistingServer: false,
      timeout: 180_000,
      url: "http://127.0.0.1:3000/",
    });
    expect(config.webServer[1]).toMatchObject({
      command: "mkdir -p test-results && : > test-results/e2e-worker.log && exec pnpm exec tsx tests/e2e/support/worker-harness.ts >> test-results/e2e-worker.log 2>&1",
      reuseExistingServer: false,
      url: "http://127.0.0.1:3101/",
    });
    expect(config.webServer[2]).toMatchObject({
      command: "pnpm exec tsx tests/e2e/support/fake-model-server.ts",
      reuseExistingServer: false,
      url: "http://127.0.0.1:3102/",
    });
    expect(config.webServer[0]?.env?.APP_CONFIG_PATH).toBe(
      "tests/e2e/app.config.yml",
    );
    expect(config.webServer[1]?.env?.NODE_ENV).toBe("test");
    expect(config.webServer[1]?.env?.BETTER_AUTH_URL).toBe(
      "http://127.0.0.1:3000",
    );
    expect(config.webServer[0]?.env).toMatchObject({
      MODEL_API_BASE_URL: `http://127.0.0.1:3102/${privacySentinels.providerEndpoint}/v1`,
      MODEL_API_KEY: privacySentinels.providerKey,
      MODEL_ID: "e2e-chat-model",
    });
  },
);

test("shares a single safe test database across app and worker servers", async () => {
  const isolatedDatabaseUrl = "postgresql://127.0.0.1:55432/isolated_test";
  const config = await loadPlaywrightConfig(undefined, {
    DATABASE_URL: "postgresql://secret@production/app",
    TEST_DATABASE_URL: isolatedDatabaseUrl,
  });

  if (!Array.isArray(config.webServer)) {
    throw new Error("Expected app and worker Playwright web servers");
  }

  expect(config.webServer[0]?.env).toMatchObject({
    DATABASE_URL: isolatedDatabaseUrl,
    TEST_DATABASE_URL: isolatedDatabaseUrl,
  });
  expect(config.webServer[1]?.env).toMatchObject({
    DATABASE_URL: isolatedDatabaseUrl,
    TEST_DATABASE_URL: isolatedDatabaseUrl,
  });
  expect(config.webServer[2]?.env).toMatchObject({
    DATABASE_URL: isolatedDatabaseUrl,
    TEST_DATABASE_URL: isolatedDatabaseUrl,
  });
});

test("allows the standard fake-model server to move off an occupied loopback port", async () => {
  const config = await loadPlaywrightConfig(undefined, {
    E2E_FAKE_MODEL_BASE_URL: "http://127.0.0.1:3203",
    E2E_FAKE_MODEL_PORT: "3203",
  });

  if (!Array.isArray(config.webServer)) {
    throw new Error("Expected app, worker, and model Playwright web servers");
  }

  expect(config.webServer[0]?.env?.MODEL_API_BASE_URL).toBe(
    `http://127.0.0.1:3203/${privacySentinels.providerEndpoint}/v1`,
  );
  expect(config.webServer[2]).toMatchObject({
    url: "http://127.0.0.1:3203/",
    env: { E2E_FAKE_MODEL_PORT: "3203" },
  });
});

test("limits the visual harness to quality specs across light, dark, and reduced-motion projects", async () => {
  vi.resetModules();
  const { default: config } = await import("../../playwright.visual.config");

  expect(config.testMatch).toEqual([
    "visual-redesign.spec.ts",
    "accessibility.spec.ts",
  ]);
  expect(config.testIgnore).toEqual([]);
  expect(config.use).toMatchObject({ trace: "off" });
  expect(config.projects).toMatchObject([
    {
      name: "desktop-light",
      use: { colorScheme: "light", reducedMotion: "no-preference" },
    },
    {
      name: "desktop-dark",
      use: { colorScheme: "dark", reducedMotion: "no-preference" },
    },
    {
      name: "mobile-light-reduced",
      use: { colorScheme: "light", reducedMotion: "reduce" },
    },
  ]);
  expect(config.webServer).toMatchObject([
    {
      env: {
        APP_CONFIG_PATH: "tests/e2e/visual.app.config.yml",
        MODEL_API_BASE_URL: `http://127.0.0.1:3202/${visualFixtureValues.providerEndpoint}/v1`,
        MODEL_API_KEY: visualFixtureValues.providerKey,
      },
    },
    {
      env: {
        APP_CONFIG_PATH: "tests/e2e/visual.app.config.yml",
        MODEL_API_BASE_URL: `http://127.0.0.1:3202/${visualFixtureValues.providerEndpoint}/v1`,
        MODEL_API_KEY: visualFixtureValues.providerKey,
      },
    },
    {
      env: { E2E_FAKE_MODEL_PORT: "3202" },
      url: "http://127.0.0.1:3202/",
    },
  ]);
});

test("publishes exact visual and accessibility commands", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  expect(packageJson.scripts["test:e2e:visual"]).toBe(
    "playwright test --config playwright.visual.config.ts tests/e2e/visual-redesign.spec.ts",
  );
  expect(packageJson.scripts["test:e2e:a11y"]).toBe(
    "playwright test --config playwright.visual.config.ts tests/e2e/accessibility.spec.ts",
  );
});

test("lets the deterministic provider bind the visual harness port", async () => {
  const source = await readFile(
    "tests/e2e/support/fake-model-server.ts",
    "utf8",
  );
  expect(source).toContain("process.env.E2E_FAKE_MODEL_PORT ?? \"3102\"");
});
