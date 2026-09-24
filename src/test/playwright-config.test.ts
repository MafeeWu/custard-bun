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
    if (Array.isArray(config.webServer)) {
      throw new Error("Expected a single Playwright web server");
    }

    expect(config.webServer?.reuseExistingServer).toBe(false);
    expect(config.webServer?.command).toBe("pnpm dev");
    expect(config.webServer?.env?.APP_CONFIG_PATH).toBe("app.config.yml");
    expect(config.webServer?.env?.NODE_ENV).toBe("test");
    expect(config.webServer?.env?.BETTER_AUTH_URL).toBe("http://127.0.0.1:3000");
  },
);
