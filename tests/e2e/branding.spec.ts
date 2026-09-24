import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const brandingConfigPath = path.join(
  process.cwd(),
  "test-results",
  "runtime-branding.yml",
);

async function isReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady(
  child: ChildProcess,
  url: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`branding server exited with code ${child.exitCode}`);
    }
    if (await isReachable(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for runtime branding server");
}

async function stopExactProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  const timeout = setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 10_000);
  timeout.unref();

  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  clearTimeout(timeout);
}

test("loads name, logo, favicon, and primary color from runtime YAML", async ({
  page,
}) => {
  const url = "http://127.0.0.1:3100";
  expect(await isReachable(url), "port 3100 must not have a stale server").toBe(
    false,
  );

  await mkdir(path.dirname(brandingConfigPath), { recursive: true });
  await writeFile(
    brandingConfigPath,
    [
      "branding:",
      "  name: Golden Friend",
      "  description: Runtime branding acceptance.",
      "  logoPath: /brand/favicon.svg",
      "  faviconPath: /brand/logo.svg",
      '  primaryColor: "#123456"',
      "registration:",
      "  open: true",
      "  maxAttemptsPerHourPerIp: 5",
      "links:",
      "  privacyUrl: https://example.com/privacy",
      "  termsUrl: https://example.com/terms",
      "  supportUrl: mailto:support@example.com",
      "",
    ].join("\n"),
  );

  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--port", "3100"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_CONFIG_PATH: brandingConfigPath,
      },
      stdio: "pipe",
    },
  );

  try {
    await waitUntilReady(child, url);
    await page.goto(url);

    await expect(
      page.getByRole("heading", { name: "Golden Friend" }),
    ).toBeVisible();
    await expect(page.locator("img").first()).toHaveAttribute(
      "src",
      /favicon\.svg/,
    );
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      "/brand/logo.svg",
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--brand-primary")
            .trim(),
        ),
      )
      .toBe("#123456");
  } finally {
    await stopExactProcess(child);
    await rm(brandingConfigPath, { force: true });
  }
});
