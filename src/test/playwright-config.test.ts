import { expect, test, vi } from "vitest";

async function loadPlaywrightConfig(
  ciValue: string | undefined,
  env: Record<string, string | undefined> = {},
) {
  const original = {
    CI: process.env.CI,
    DATABASE_URL: process.env.DATABASE_URL,
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

    expect(config.webServer).toHaveLength(2);
    expect(config.webServer[0]).toMatchObject({
      command: "pnpm build && pnpm start",
      reuseExistingServer: false,
      url: "http://127.0.0.1:3000/",
    });
    expect(config.webServer[1]).toMatchObject({
      command: "pnpm exec tsx tests/e2e/support/worker-harness.ts",
      reuseExistingServer: false,
      url: "http://127.0.0.1:3101/",
    });
    expect(config.webServer[0]?.env?.APP_CONFIG_PATH).toBe("app.config.yml");
    expect(config.webServer[1]?.env?.NODE_ENV).toBe("test");
    expect(config.webServer[1]?.env?.BETTER_AUTH_URL).toBe(
      "http://127.0.0.1:3000",
    );
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
});
