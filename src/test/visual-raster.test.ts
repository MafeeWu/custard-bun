// @vitest-environment node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import {
  assertVisualEvidenceFilesArePrivate,
  visualPrivacySentinels,
} from "../../tests/release/visual-evidence";

const root = "test-results/visual-raster-unit";
let browser: Browser;
let safeImage: Buffer;
beforeAll(async () => {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<body style='background:white'>Public fixture</body>");
  safeImage = await page.screenshot();
  await page.close();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
afterAll(async () => {
  await browser.close();
});

async function evidence() {
  await mkdir(root, { recursive: true });
  const files = [
    "home-desktop-light.png",
    "home-desktop-dark.png",
    "home-mobile.png",
    "account-error-state.png",
  ].map((name) => `${root}/${name}`);
  for (const file of files) await writeFile(file, safeImage);
  return files;
}

test.each(visualPrivacySentinels)(
  "rejects genuine rasterized sentinel text without embedded UTF-8 bytes: %s",
  async (sentinel) => {
    const files = await evidence();
    const page = await browser.newPage({
      viewport: { width: 1400, height: 180 },
    });
    try {
      await page.setContent(
        "<body style='background:white;color:black;font:24px monospace'></body>",
      );
      await page.locator("body").evaluate((body, text) => {
        body.textContent = text;
      }, sentinel);
      const image = await page.screenshot();
      expect(image.includes(Buffer.from(sentinel))).toBe(false);
      await writeFile(files[0], image);
      await expect(assertVisualEvidenceFilesArePrivate(files)).rejects.toThrow(
        "Visual privacy sentinel found",
      );
    } finally {
      await page.close();
    }
  },
);

test("fails closed on malformed PNG evidence instead of accepting plaintext with an image extension", async () => {
  const files = await evidence();
  await writeFile(files[0], "not a rendered image");
  await expect(assertVisualEvidenceFilesArePrivate(files)).rejects.toThrow();
});

test("accepts real safe rasterized evidence", async () => {
  await expect(
    assertVisualEvidenceFilesArePrivate(await evidence()),
  ).resolves.toBeUndefined();
});
