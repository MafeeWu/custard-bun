import path from "node:path";
import { expect, test } from "@playwright/test";
import { isReachable, withBrandingServer } from "./support/branding-server";

test("loads name, logo, favicon, and visible primary color from runtime YAML", async ({
  page,
}) => {
  await page.goto("/");
  const initialColor = await page
    .getByRole("link", { name: "Get started" })
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(
    await isReachable("http://127.0.0.1:3100"),
    "port 3100 must not have a stale server",
  ).toBe(false);
  const configPath = path.join(
    process.cwd(),
    "test-results",
    "runtime-branding.yml",
  );
  const yaml = [
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
  ].join("\n");
  await withBrandingServer(configPath, yaml, async (url) => {
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
    const control = page.getByRole("link", { name: "Get started" });
    await expect(control).toHaveCSS("background-color", "rgb(18, 52, 86)");
    expect(
      await control.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe(initialColor);
  });
});
