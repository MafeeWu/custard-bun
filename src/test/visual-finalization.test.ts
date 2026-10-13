// @vitest-environment node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { afterEach, expect, test } from "vitest";
import { visualPrivacySentinels } from "../../tests/release/visual-evidence";

const root = "test-results/visual-finalization-unit";
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("real Playwright teardown finalizes privacy even after a screenshot assertion fails", async () => {
  const snapshots = `${root}/tests/e2e/visual-redesign.spec.ts-snapshots`;
  await mkdir(snapshots, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 180 },
    });
    await page.setContent("<body>Public safe fixture</body>");
    const image = await page.screenshot();
    for (const name of [
      "home-desktop-light",
      "home-desktop-dark",
      "home-mobile",
      "account-error-state",
    ]) {
      await writeFile(`${snapshots}/${name}.png`, image);
    }
  } finally {
    await browser.close();
  }
  await writeFile(
    `${root}/fixture.spec.ts`,
    `
    import { test, expect } from "@playwright/test";
    test("intentional screenshot failure", async ({ page }) => {
      await page.setContent("<body style='font:24px monospace'>${visualPrivacySentinels[0]}</body>");
      await expect(page).toHaveScreenshot("mismatch.png");
    });
  `,
  );
  await writeFile(
    `${root}/config.ts`,
    `
    import baseConfig from "../../playwright.visual.config";
    import { defineConfig } from "@playwright/test";
    export default defineConfig({
      ...baseConfig, webServer: undefined, testDir: ".", testMatch: "fixture.spec.ts",
      globalTeardown: typeof baseConfig.globalTeardown === "string" ? require("node:path").resolve(baseConfig.globalTeardown) : undefined,
      outputDir: "./test-results/ui-evidence", workers: 1,
      metadata: { visualPrivacyRoot: ${JSON.stringify(resolve(root))} },
      snapshotPathTemplate: ${JSON.stringify(resolve(snapshots, "home-desktop-light.png"))},
      use: { browserName: "chromium", viewport: { width: 1400, height: 180 }, trace: "off" },
      projects: [{ name: "failure-proof" }],
    });
  `,
  );
  const require = createRequire(import.meta.url);
  const cli = resolve(
    require.resolve("@playwright/test/package.json"),
    "../cli.js",
  );
  const result = await new Promise<{ code: number | null; output: string }>(
    (resolveResult, reject) => {
      const child = spawn(
        process.execPath,
        [cli, "test", "--config", `${root}/config.ts`],
        { cwd: process.cwd(), env: process.env },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("error", reject);
      child.on("exit", (code) => resolveResult({ code, output }));
    },
  );
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("intentional screenshot failure");
  expect(result.output).toContain("Visual privacy sentinel found");
}, 30_000);
