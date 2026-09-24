import { expect, test, vi } from "vitest";

async function loadPlaywrightConfig(ciValue: string | undefined) {
  const originalCi = process.env.CI;

  if (ciValue === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = ciValue;
  }

  vi.resetModules();

  try {
    const { default: config } = await import("../../playwright.config");
    return config;
  } finally {
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
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
