import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createBrandThemeVariables } from "../../src/server/branding/accent-theme";
import { completeChat, memoryUrl, waitForExtraction } from "./support/memory";
import {
  captureMain,
  expectNoHorizontalOverflow,
  expectVisibleBox,
  injectOwnerExportError,
  longCharacterName,
  promoteVisualUser,
  registerVisualUser,
  resetVisualFixtures,
  visualBrandName,
  visualPrivacySentinels,
} from "./support/visual-fixtures";
import { assertVisualEvidenceIsPrivate } from "./support/visual-privacy";
import { startCharacterConversation } from "./support/chat";

test.describe.configure({ mode: "serial" });

async function expectLatestMessageAboveComposer(page: Page) {
  const message = await page
    .locator('li[data-status="complete"]')
    .last()
    .boundingBox();
  const composer = await page
    .getByLabel("Message", { exact: true })
    .boundingBox();
  const diagnostics = await page.evaluate(() => {
    const marker = document.querySelector(".chat-timeline__end");
    const shell = document.querySelector(".chat-composer-shell");
    return {
      composerTop: shell?.getBoundingClientRect().top,
      innerHeight: window.innerHeight,
      markerBottom: marker?.getBoundingClientRect().bottom,
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
    };
  });
  expect(message).not.toBeNull();
  expect(composer).not.toBeNull();
  expect(
    message!.y + message!.height,
    JSON.stringify(diagnostics),
  ).toBeLessThanOrEqual(composer!.y);
}

async function expectDialogInsideViewport(page: Page) {
  const dialog = page.getByRole("dialog");
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

async function apply200PercentLayoutZoom(page: Page) {
  await page.addInitScript(() => {
    const applyZoom = () => {
      const root = document.documentElement;
      root.dataset.baseFontSize = getComputedStyle(root).fontSize;
      root.style.fontSize = "200%";
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applyZoom, { once: true });
    } else {
      applyZoom();
    }
  });
}

async function readLayoutZoomMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const baseFontSize = Number.parseFloat(root.dataset.baseFontSize ?? "0");
    const scaledFontSize = Number.parseFloat(getComputedStyle(root).fontSize);
    const effectiveViewportWidth = window.innerWidth;
    return {
      baseFontSize,
      devicePixelRatio: window.devicePixelRatio,
      effectiveViewportWidth,
      scaledFontSize,
    };
  });
}

async function scrollLatestAboveComposer(page: Page) {
  await page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>(".chat-timeline__end");
    const composer = document.querySelector<HTMLElement>(
      ".chat-composer-shell",
    );
    if (!marker || !composer) return;
    const scrollingElement =
      document.scrollingElement ?? document.documentElement;
    scrollingElement.scrollTop = scrollingElement.scrollHeight;
  });
}

async function screenshotDialogError(page: Page, testInfo: TestInfo) {
  for (const sentinel of visualPrivacySentinels) {
    await expect(page.locator("body")).not.toContainText(sentinel);
  }
  await expect(page).toHaveScreenshot("account-delete-dialog-error-state.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.015,
    scale: "css",
  });
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: testInfo.outputPath(
      `account-delete-dialog-error-state-${testInfo.project.name}.png`,
    ),
    scale: "css",
  });
}

test("captures deterministic redesigned surfaces without private evidence", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const fixture = await resetVisualFixtures(testInfo.project.name);
  try {
    await page.goto("/");
    await expect(
      page.locator("main").getByText(visualBrandName, { exact: true }),
    ).toBeVisible();
    const getStarted = page.getByRole("link", { name: /get started/i });
    await captureMain(page, testInfo, "home", getStarted);
    expect(
      await page
        .locator("[data-home-motion]")
        .evaluateAll((elements) =>
          elements
            .filter((element) =>
              [
                "preview-feature",
                "preview-list",
                "privacy",
                "continuity",
                "final-cta",
              ].includes(element.getAttribute("data-home-motion") ?? ""),
            )
            .map((element) => element.parentElement?.tagName),
        ),
    ).toEqual(["SECTION", "SECTION", "SECTION", "SECTION", "SECTION"]);
    if ((page.viewportSize()?.width ?? 0) >= 800) {
      const dimensions = await getStarted
        .locator(".ui-button__label")
        .evaluate((element) => {
          const styles = getComputedStyle(element);
          return {
            height: element.getBoundingClientRect().height,
            lineHeight: Number.parseFloat(styles.lineHeight),
          };
        });
      expect(dimensions.height).toBeLessThanOrEqual(
        Math.ceil(dimensions.lineHeight * 1.25),
      );
    }

    await page.goto("/characters");
    await captureMain(
      page,
      testInfo,
      "characters",
      page.getByRole("link", { name: new RegExp(longCharacterName) }),
    );

    await page.goto("/characters/calm-listener");
    await captureMain(
      page,
      testInfo,
      "character-profile",
      page.getByRole("link", { name: /sign in to start a conversation/i }),
    );

    await page.goto("/auth/sign-up");
    await captureMain(
      page,
      testInfo,
      "sign-up",
      page.getByRole("button", { name: "Create account", exact: true }),
    );

    await registerVisualUser(page, fixture);
    await captureMain(
      page,
      testInfo,
      "app-empty",
      page.getByRole("link", { name: /browse characters/i }),
    );

    const conversationId = await startCharacterConversation(
      page,
      "calm-listener",
    );
    await completeChat(page, "A calm deterministic hello.");
    await completeChat(page, "[memory-direct] I prefer jasmine tea");
    await waitForExtraction(fixture.database, conversationId);
    await expectLatestMessageAboveComposer(page);
    await captureMain(
      page,
      testInfo,
      "chat-active",
      page.getByRole("button", { name: "Send", exact: true }),
    );

    const relationshipUrl = await memoryUrl(page);
    await page.goto(relationshipUrl);
    await expect(
      page.getByRole("region", { name: "Saved memories" }),
    ).toContainText("jasmine tea");
    const originalViewport = page.viewportSize();
    if (testInfo.project.name === "mobile-light-reduced") {
      await page.setViewportSize({ width: 320, height: 900 });
    }
    await captureMain(
      page,
      testInfo,
      "memory-relationship",
      page.getByRole("button", { name: "Save controls", exact: true }),
    );
    if (testInfo.project.name === "mobile-light-reduced" && originalViewport) {
      await page.setViewportSize(originalViewport);
    }

    await page.goto("/app");
    await captureMain(
      page,
      testInfo,
      "app-active",
      page.locator(`a[href="/app/conversations/${conversationId}"]`),
    );

    await page.goto(`/app/conversations/${conversationId}`);
    await page
      .getByRole("button", { name: "Open conversation actions", exact: true })
      .click();
    await page.getByLabel("Archive this conversation and start over.").check();
    await page.getByRole("button", { name: "Start over", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.endsWith(conversationId));
    await page.goto(`/app/conversations/${conversationId}`);
    await expect(
      page.getByText("This archived conversation is read-only.", {
        exact: true,
      }),
    ).toBeVisible();
    await captureMain(
      page,
      testInfo,
      "chat-archived",
      page.getByRole("button", {
        name: "Open conversation actions",
        exact: true,
      }),
    );

    await injectOwnerExportError(fixture.database, fixture.email);
    await page.goto("/account");
    await expect(
      page.getByText("Data export is unavailable.", { exact: true }),
    ).toBeVisible();
    await captureMain(
      page,
      testInfo,
      "account",
      page.getByRole("button", { name: "Request data export", exact: true }),
    );
    await page
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    await expectDialogInsideViewport(page);
    await screenshotDialogError(page, testInfo);
    await page.keyboard.press("Escape");

    await promoteVisualUser(page, fixture.database, fixture);
    for (const [name, path] of [
      ["admin-users", "/admin/users"],
      ["admin-usage", "/admin/usage"],
      ["admin-memory", "/admin/memory"],
      ["admin-audit", "/admin/audit"],
    ] as const) {
      await page.goto(path);
      await captureMain(page, testInfo, name);
    }
  } finally {
    await fixture.database.$client.end();
  }
});

test("fits 60-character branding and an 80-character character at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/characters/visual-long-name");
  await expect(
    page.getByRole("heading", { level: 1, name: longCharacterName }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByText(visualBrandName, { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectVisibleBox(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  );
});

test("reflows layout and text at 200% zoom", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-light");
  await page.setViewportSize({ width: 640, height: 1800 });
  await apply200PercentLayoutZoom(page);
  const fixture = await resetVisualFixtures(`${testInfo.project.name}-zoom`);
  try {
    await page.goto("/characters/visual-long-name");
    const metrics = await readLayoutZoomMetrics(page);
    expect(metrics.effectiveViewportWidth).toBe(640);
    expect(metrics.devicePixelRatio).toBe(1);
    expect(metrics.scaledFontSize).toBeGreaterThanOrEqual(
      metrics.baseFontSize * 1.9,
    );
    await expectNoHorizontalOverflow(page);
    await expectVisibleBox(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    );

    await registerVisualUser(page, fixture);
    const conversationId = await startCharacterConversation(
      page,
      "calm-listener",
    );
    await completeChat(page, "A zoomed deterministic hello.");
    await scrollLatestAboveComposer(page);
    await expectNoHorizontalOverflow(page);
    await expectVisibleBox(
      page.getByRole("button", { name: "Send", exact: true }),
    );
    await expectLatestMessageAboveComposer(page);
    await page.goto("/account");
    await expectNoHorizontalOverflow(page);
    const deleteAccount = page.getByRole("button", {
      name: "Delete account",
      exact: true,
    });
    await expectVisibleBox(deleteAccount);
    await deleteAccount.click();
    await expectDialogInsideViewport(page);
    expect(new URL(page.url()).pathname).not.toContain(conversationId);
  } finally {
    await fixture.database.$client.end();
  }
});

test("supplementally preserves a 320px CSS viewport at 200% device scale", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    colorScheme: "light",
    deviceScaleFactor: 2,
    viewport: { width: 320, height: 900 },
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    expect(
      await page.evaluate(() => ({
        devicePixelRatio: window.devicePixelRatio,
        viewportWidth: window.innerWidth,
        visualWidth: window.visualViewport?.width,
      })),
    ).toMatchObject({
      devicePixelRatio: 2,
      viewportWidth: 320,
      visualWidth: 320,
    });
    await expectNoHorizontalOverflow(page);
    await expectVisibleBox(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    );
  } finally {
    await context.close();
  }
});

test("keeps primary actions visible for extreme accent colors", async ({
  page,
}) => {
  await page.goto("/");
  const action = page.getByRole("link", { name: /get started/i });
  for (const accent of ["#FFFFFF", "#000000", "#00FF00", "#FF00FF"]) {
    const variables = createBrandThemeVariables(accent);
    await page.evaluate((theme) => {
      for (const [name, value] of Object.entries(theme)) {
        document.documentElement.style.setProperty(name, value);
      }
    }, variables);
    await expectVisibleBox(action);
    await action.focus();
    expect(
      await action.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
    ).not.toBe("none");
  }
});

test("applies light and dark theme CSS without JavaScript", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-light");
  const backgrounds: string[] = [];
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      colorScheme,
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    try {
      await page.goto("/");
      backgrounds.push(
        await page
          .locator("body")
          .evaluate((body) => getComputedStyle(body).backgroundColor),
      );
      await expect(page.locator("main")).toHaveScreenshot(
        `no-js-${colorScheme}.png`,
        {
          animations: "disabled",
          caret: "hide",
          maxDiffPixelRatio: 0.015,
          scale: "css",
        },
      );
    } finally {
      await context.close();
    }
  }
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
});

test("settles reduced motion without transforms or hydration errors", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-light-reduced");
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|did not match|server rendered html/i.test(message.text())
    ) {
      hydrationErrors.push(message.text());
    }
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const transforms = await page
    .locator("[data-home-motion]")
    .evaluateAll((elements) =>
      elements.map(
        (element) =>
          getComputedStyle(element.parentElement ?? element).transform,
      ),
    );
  expect(transforms).toEqual(transforms.map(() => "none"));
  expect(hydrationErrors).toEqual([]);
});

test("recursively rejects private bytes from committed and runtime visual evidence", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-light-reduced");
  await expect(assertVisualEvidenceIsPrivate(process.cwd())).resolves.toEqual({
    files: expect.any(Number),
  });
});
