import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  contrastRatio,
  createBrandThemeVariables,
} from "../../src/server/branding/accent-theme";
import { completeChat, memoryUrl, waitForExtraction } from "./support/memory";
import {
  captureMain,
  assertCaptureValuesArePrivate,
  expectNoHorizontalOverflow,
  expectVisibleBox,
  injectOwnerExportError,
  longCharacterName,
  promoteVisualUser,
  registerVisualUser,
  resetVisualFixtures,
  prepareVisualAdministration,
  visualBrandName,
  visualPrivacySentinels,
} from "./support/visual-fixtures";
import { startCharacterConversation } from "./support/chat";
import {
  assertBrowserZoomGeometry,
  createBrowserZoomGeometry,
} from "./support/browser-zoom";

test.describe.configure({ mode: "default" });

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
  const panel = page.getByRole("dialog").getByRole("document");
  const box = await panel.boundingBox();
  const viewport = await page.evaluate(() => ({
    x: window.visualViewport?.offsetLeft ?? 0,
    y: window.visualViewport?.offsetTop ?? 0,
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  }));
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(viewport.x);
  expect(box!.y).toBeGreaterThanOrEqual(viewport.y);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.x + viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    viewport.y + viewport.height,
  );
  for (const button of await panel.getByRole("button").all()) {
    await button.scrollIntoViewIfNeeded();
    const action = await button.boundingBox();
    expect(action!.y).toBeGreaterThanOrEqual(viewport.y);
    expect(action!.y + action!.height).toBeLessThanOrEqual(
      viewport.y + viewport.height,
    );
  }
}

async function expectPainted(locator: ReturnType<Page["locator"]>) {
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((element) => {
      for (
        let ancestor: Element | null = element;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const styles = getComputedStyle(ancestor);
        if (
          Number(styles.opacity) === 0 ||
          styles.visibility === "hidden" ||
          styles.display === "none"
        )
          return false;
      }
      return true;
    }),
  ).toBe(true);
}

async function expectEmptyStateContained(page: Page) {
  const geometry = await page.evaluate(() => {
    const empty = document
      .querySelector(".application-empty-state")!
      .getBoundingClientRect();
    const primary = document
      .querySelector(".application-home__primary")!
      .getBoundingClientRect();
    const account = document
      .querySelector(".application-home__account")!
      .getBoundingClientRect();
    return {
      contained: empty.bottom <= primary.bottom,
      disjoint:
        empty.right <= account.left ||
        empty.bottom <= account.top ||
        account.right <= empty.left,
    };
  });
  expect(geometry).toEqual({ contained: true, disjoint: true });
}

async function expectReadableChatHeader(page: Page) {
  const identity = page.locator(".chat-character");
  const tools = page.getByLabel("Conversation tools", { exact: true });
  const geometry = await page.locator(".chat-header").evaluate((header) => {
    const name = header.querySelector("h1")!;
    const identity = header.querySelector(".chat-character")!;
    const tools = header.querySelector(".chat-header-actions")!;
    const style = getComputedStyle(name);
    return {
      height: name.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(style.lineHeight),
      identityBottom: identity.getBoundingClientRect().bottom,
      toolsTop: tools.getBoundingClientRect().top,
    };
  });
  expect(geometry.height).toBeLessThanOrEqual(
    Math.ceil(geometry.lineHeight * 1.1),
  );
  expect(geometry.toolsTop).toBeGreaterThanOrEqual(geometry.identityBottom);
  await expect(
    identity.getByText(/Available|Replying|Archived/, { exact: true }),
  ).toBeVisible();
  for (const control of await tools.locator("a, button").all())
    await expectVisibleBox(control);
  await expectNoHorizontalOverflow(page);
}

async function expectFocusedChatCapture(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const image = await readFile(
    testInfo.outputPath(`${name}-${testInfo.project.name}.png`),
  );
  expect({
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  }).toEqual(page.viewportSize());
  expect(
    await page
      .locator(".chat-header")
      .evaluate((element) => getComputedStyle(element).position),
  ).toBe("sticky");
}

async function readViewportMetrics(page: Page) {
  return page.evaluate(() => {
    const visualViewport = window.visualViewport;
    return {
      devicePixelRatio: window.devicePixelRatio,
      layoutHeight: window.innerHeight,
      layoutWidth: window.innerWidth,
      physicalHeight: window.innerHeight * window.devicePixelRatio,
      physicalWidth: window.innerWidth * window.devicePixelRatio,
      visualHeight: visualViewport?.height,
      visualScale: visualViewport?.scale,
      visualWidth: visualViewport?.width,
    };
  });
}

async function scrollLatestAboveComposer(page: Page) {
  await page.evaluate(() => {
    const scrollingElement =
      document.scrollingElement ?? document.documentElement;
    scrollingElement.scrollTop = scrollingElement.scrollHeight;
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scrollingElement =
          document.scrollingElement ?? document.documentElement;
        return Math.ceil(scrollingElement.scrollTop + window.innerHeight);
      }),
    )
    .toBeGreaterThanOrEqual(
      await page.evaluate(
        () =>
          (document.scrollingElement ?? document.documentElement).scrollHeight,
      ),
    );
}

async function screenshotDialogError(page: Page, testInfo: TestInfo) {
  await assertCaptureValuesArePrivate(page);
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
    await expectEmptyStateContained(page);
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
    await expectFocusedChatCapture(page, testInfo, "chat-active");
    await expectLatestMessageAboveComposer(page);

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
    await expectFocusedChatCapture(page, testInfo, "chat-archived");

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

    await prepareVisualAdministration(page, fixture.database, fixture);
    const operationDelay = await fixture.database.$client.query<{
      p50: number;
      p95: number;
    }>(`
      select percentile_cont(0.5) within group (order by delay_ms) as p50,
        percentile_cont(0.95) within group (order by delay_ms) as p95
      from (
        select extract(epoch from (started_at - created_at)) * 1000 as delay_ms
        from memory_extraction_runs where started_at is not null
        union all
        select extract(epoch from (started_at - created_at)) * 1000 as delay_ms
        from relationship_summary_runs where started_at is not null
      ) delays
    `);
    expect(operationDelay.rows[0]).toEqual({ p50: null, p95: null });
    for (const [name, path] of [
      ["admin-users", "/admin/users"],
      ["admin-usage", "/admin/usage"],
      ["admin-memory", "/admin/memory"],
      ["admin-audit", "/admin/audit"],
    ] as const) {
      await page.goto(path);
      if (name === "admin-memory") {
        await expect(
          page.getByText("Processing delay p50: Unavailable ms", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText("Processing delay p95: Unavailable ms", {
            exact: true,
          }),
        ).toBeVisible();
      }
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

test("reflows the same physical desktop viewport at 200% browser zoom", async ({
  browser,
  page: baselinePage,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-light");
  const fixture = await resetVisualFixtures(`${testInfo.project.name}-zoom`);
  const geometry = createBrowserZoomGeometry({ width: 1280, height: 900 }, 2);
  const zoomContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    colorScheme: "light",
    ...geometry.zoomed,
    reducedMotion: "no-preference",
  });
  const page = await zoomContext.newPage();
  try {
    await baselinePage.setViewportSize(geometry.baseline.viewport);
    await baselinePage.goto("/characters/visual-long-name");
    const baseline = await readViewportMetrics(baselinePage);
    await page.goto("/characters/visual-long-name");
    const zoomed = await readViewportMetrics(page);
    assertBrowserZoomGeometry(geometry, baseline, zoomed);
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
    await zoomContext.close();
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
    await expectPainted(page.getByRole("heading", { level: 1 }));
    await expectPainted(
      page.getByRole("link", { name: "Get started", exact: true }),
    );
    await expectPainted(
      page
        .getByRole("link", { name: "Browse characters", exact: true })
        .first(),
    );
    for (const heading of await page.locator("main h2").all())
      await expectPainted(heading);
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
    await page.goto("/characters");
    await expectPainted(
      page.getByRole("heading", { name: "Calm Listener", exact: true }),
    );
    await expectPainted(
      page.getByRole("link", { name: "Calm Listener", exact: true }),
    );
  } finally {
    await context.close();
  }
});

test.describe("final whole-branch regression contracts", () => {
  test.describe.configure({ mode: "default" });

  test("bounds the actual dialog panel and keeps close and destructive actions reachable in a keyboard-sized visual viewport", async ({
    page,
  }, testInfo) => {
    const fixture = await resetVisualFixtures(`panel-${testInfo.project.name}`);
    try {
      await registerVisualUser(page, fixture);
      await page.setViewportSize({ width: 320, height: 450 });
      await page.goto("/account");
      await page
        .getByRole("button", { name: "Delete account", exact: true })
        .click();
      await expectDialogInsideViewport(page);
      const input = page.getByRole("textbox", {
        name: "Confirm account email",
      });
      await input.fill("draft@example.com");
      await expect(input).toBeFocused();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      await fixture.database.$client.end();
    }
  });

  test("contains the mobile application empty state without intersecting the Account surface", async ({
    page,
  }, testInfo) => {
    const fixture = await resetVisualFixtures(
      `contain-${testInfo.project.name}`,
    );
    try {
      await page.setViewportSize({ width: 320, height: 900 });
      await registerVisualUser(page, fixture);
      await expectEmptyStateContained(page);
    } finally {
      await fixture.database.$client.end();
    }
  });

  test("keeps character identity readable and conversation tools separate at 320px and 200% zoom", async ({
    browser,
    page,
  }, testInfo) => {
    const fixture = await resetVisualFixtures(
      `header-${testInfo.project.name}`,
    );
    try {
      await registerVisualUser(page, fixture);
      await startCharacterConversation(page, "calm-listener");
      await page.setViewportSize({ width: 320, height: 900 });
      await expectReadableChatHeader(page);
      const geometry = createBrowserZoomGeometry(
        { width: 1280, height: 900 },
        2,
      );
      const context = await browser.newContext({
        baseURL: "http://127.0.0.1:3000",
        storageState: await page.context().storageState(),
        ...geometry.zoomed,
      });
      try {
        const zoomPage = await context.newPage();
        await zoomPage.goto(page.url());
        await expectReadableChatHeader(zoomPage);
      } finally {
        await context.close();
      }
    } finally {
      await fixture.database.$client.end();
    }
  });

  test("account explicitly provides desktop and mobile application navigation with one main landmark", async ({
    page,
  }, testInfo) => {
    const fixture = await resetVisualFixtures(
      `account-nav-${testInfo.project.name}`,
    );
    try {
      await registerVisualUser(page, fixture);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/account");
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(
        page.getByRole("navigation", {
          name: "Application navigation",
          exact: true,
        }),
      ).toBeVisible();
      await page.setViewportSize({ width: 320, height: 900 });
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
      const navigation = page.getByRole("dialog", {
        name: "Application navigation",
      });
      for (const name of ["Conversations", "Memories", "Account"])
        await expect(
          navigation.getByRole("link", { name, exact: true }),
        ).toBeVisible();
      await page.keyboard.press("Escape");
    } finally {
      await fixture.database.$client.end();
    }
  });

  test("continuation keyboard focus uses a resolved, contrasting outline", async ({
    page,
  }, testInfo) => {
    const fixture = await resetVisualFixtures(
      `continuation-${testInfo.project.name}`,
    );
    try {
      await registerVisualUser(page, fixture);
      await startCharacterConversation(page, "calm-listener");
      await page.goto("/app");
      const link = page.locator(".application-conversation-card-link");
      await link.focus();
      const style = await link.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          outlineStyle: computed.outlineStyle,
          outlineWidth: computed.outlineWidth,
          color: computed.outlineColor,
          background: getComputedStyle(element.querySelector("article")!)
            .backgroundColor,
        };
      });
      expect(style.outlineStyle).toBe("solid");
      expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(rgbHex(style.color), rgbHex(style.background)),
      ).toBeGreaterThanOrEqual(3);
    } finally {
      await fixture.database.$client.end();
    }
  });

  test("renders readable accent text and primary hover, active and focus on real surfaces", async ({
    page,
  }) => {
    await page.goto("/characters");
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    for (const accent of [
      "#F59E0B",
      "#FFFFFF",
      "#000000",
      "#1757D5",
      "#7F8C8D",
      "#00FF00",
      "#FF00FF",
    ]) {
      await page.evaluate((theme) => {
        for (const [name, value] of Object.entries(theme))
          document.documentElement.style.setProperty(name, value);
      }, createBrandThemeVariables(accent));
      for (const consumer of await page
        .locator(".character-card__eyebrow, .ui-page-header__eyebrow")
        .all()) {
        const pair = await consumer.evaluate((element) => {
          let surface: Element | null = element;
          while (
            surface &&
            getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)"
          )
            surface = surface.parentElement;
          return [
            getComputedStyle(element).color,
            getComputedStyle(surface!).backgroundColor,
          ];
        });
        expect(
          contrastRatio(rgbHex(pair[0]), rgbHex(pair[1])),
          `${accent} text`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      await page.goto("/");
      await page.evaluate((theme) => {
        for (const [name, value] of Object.entries(theme))
          document.documentElement.style.setProperty(name, value);
      }, createBrandThemeVariables(accent));
      const action = page.getByRole("link", {
        name: "Get started",
        exact: true,
      });
      await action.hover();
      await action.evaluate((element) =>
        element.getAnimations().forEach((animation) => animation.finish()),
      );
      await assertButtonContrast(action, accent);
      await page.mouse.down();
      try {
        await action.evaluate((element) =>
          element.getAnimations().forEach((animation) => animation.finish()),
        );
        await assertButtonContrast(action, accent);
      } finally {
        await page.mouse.move(0, 0);
        await page.mouse.up();
      }
      await page.keyboard.press("Tab");
      await action.focus();
      expect(
        await action.evaluate((element) => element.matches(":focus-visible")),
      ).toBe(true);
      expect(
        await action.evaluate(
          (element) => getComputedStyle(element).outlineStyle,
        ),
      ).toBe("solid");
      const focus = await action.evaluate(
        (element) => getComputedStyle(element).outlineColor,
      );
      const surfaces = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        return [
          "--color-surface",
          "--color-canvas",
          "--color-surface-raised",
          "--color-surface-selected",
        ].map((name) => root.getPropertyValue(name).trim());
      });
      for (const surface of surfaces)
        expect(
          contrastRatio(rgbHex(focus), rgbHex(surface)),
          `${accent} focus on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      await page.goto("/characters");
    }
  });

  test("reduced motion removes catalog initial transforms before hydration and spatial pointer hover", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      reducedMotion: "reduce",
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 900 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/characters");
      const initialTransforms = await page
        .locator(".character-grid, .character-grid__item")
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).transform),
        );
      expect(initialTransforms).toEqual(initialTransforms.map(() => "none"));
      for (const item of await page
        .locator(".character-grid, .character-grid__item")
        .all()) {
        expect(
          await item.evaluate((element) => getComputedStyle(element).transform),
        ).toBe("none");
        await expectPainted(item);
      }
      const card = page.locator(".character-card").first();
      await card.hover();
      for (const element of [card, card.locator(".character-card__avatar")]) {
        expect(
          await element.evaluate((node) => getComputedStyle(node).transform),
        ).toBe("none");
      }
    } finally {
      await context.close();
    }
  });

  test("reduced motion disables card translation and portrait scaling on a fine pointer", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/characters");
      const card = page.locator(".character-card").first();
      await card.hover();
      for (const element of [card, card.locator(".character-card__avatar")]) {
        await element.evaluate((node) =>
          node.getAnimations().forEach((animation) => animation.finish()),
        );
        expect(
          await element.evaluate((node) => getComputedStyle(node).transform),
        ).toBe("none");
      }
    } finally {
      await context.close();
    }
  });

  test("all referenced semantic CSS tokens resolve in the rendered theme", async ({
    page,
  }) => {
    const source = await readFile("src/app/globals.css", "utf8");
    const tokens = [
      ...new Set(
        [
          ...source.matchAll(
            /var\((--(?:color|font-size|line-height|motion|duration|ease|shadow|radius|space|measure|tracking)[\w-]*)/g,
          ),
        ].map((match) => match[1]),
      ),
    ];
    await page.goto("/");
    expect(
      await page.evaluate((references) => {
        const style = getComputedStyle(document.documentElement);
        return references.filter(
          (name) => !style.getPropertyValue(name).trim(),
        );
      }, tokens),
    ).toEqual([]);
  });

  test("a responsive admin quota form keeps its draft, submission and feedback across the breakpoint", async ({
    page,
  }, testInfo) => {
    const fixture = await resetVisualFixtures(
      `admin-edit-${testInfo.project.name}`,
    );
    let releaseRequest: (() => void) | undefined;
    try {
      await registerVisualUser(page, fixture);
      await promoteVisualUser(page, fixture.database, fixture);
      await fixture.database.$client.query(
        'UPDATE "user" SET role = $1 WHERE name = $2',
        ["user", "Private decoy"],
      );
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/admin/users");
      const form = page.getByRole("form", {
        name: "Quota override for Private decoy",
        exact: true,
      });
      await expect(form).toHaveCount(1);
      const input = form.getByLabel("Daily request override", { exact: true });
      await input.fill("37");
      const identity = await input.evaluate((element) => {
        element.setAttribute(
          "data-draft-identity",
          "same-interactive-instance",
        );
        return element.id;
      });
      await page.setViewportSize({ width: 640, height: 450 });
      await expect(input).toHaveValue("37");
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute("id", identity);
      const held = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });
      await page.route("**/admin/users", async (route) => {
        if (route.request().method() === "POST") await held;
        await route.continue();
      });
      const save = form.getByRole("button", {
        name: "Save quota override",
        exact: true,
      });
      await save.click();
      await expect(save).toBeDisabled();
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(save).toBeDisabled();
      await expect(input).toHaveValue("37");
      releaseRequest!();
      await expect(save).toBeEnabled();
      await expect(form.getByRole("status")).toBeVisible();
      await page.setViewportSize({ width: 320, height: 900 });
      await expect(form.getByRole("status")).toBeVisible();
      await expect(input).toHaveValue("37");
      await expect(input).toHaveAttribute(
        "data-draft-identity",
        "same-interactive-instance",
      );
      await expectNoHorizontalOverflow(page);
    } finally {
      releaseRequest?.();
      await fixture.database.$client.end();
    }
  });

  test("visual capture rejects private input values before any screenshot is written", async ({
    page,
  }, testInfo) => {
    await page.setContent(
      "<main><label>Private capture value<input /></label></main>",
    );
    await page
      .getByRole("textbox", { name: "Private capture value" })
      .fill(visualPrivacySentinels[2]);
    await expect(page.getByRole("textbox")).toHaveValue(
      visualPrivacySentinels[2],
    );
    await expect(
      captureMain(page, testInfo, "must-not-capture-input"),
    ).rejects.toThrow("Visual privacy sentinel found");
  });

  test("capture privacy distinguishes painted values from opaque, non-rendered server action metadata", async ({
    page,
  }) => {
    await page.setContent(
      "<main><p>Public fixture</p><script type='application/json'></script><input type='hidden'></main>",
    );
    await page.evaluate((sentinel) => {
      document.querySelector("script")!.textContent = JSON.stringify({
        bound: [sentinel],
      });
      document.querySelector("input")!.value = sentinel;
    }, visualPrivacySentinels[6]);
    await expect(assertCaptureValuesArePrivate(page)).resolves.toBeUndefined();
  });
});

function rgbHex(color: string): string {
  if (/^#[0-9a-f]{3}$/i.test(color))
    return `#${color
      .slice(1)
      .split("")
      .map((digit) => digit.repeat(2))
      .join("")}`;
  if (color.startsWith("#")) return color;
  const channels = color
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number);
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

async function assertButtonContrast(
  action: ReturnType<Page["locator"]>,
  accent: string,
) {
  const pair = await action.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.color, style.backgroundColor];
  });
  expect(
    contrastRatio(rgbHex(pair[0]), rgbHex(pair[1])),
    `${accent} button state`,
  ).toBeGreaterThanOrEqual(4.5);
}

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
      await expectPainted(page.getByRole("heading", { level: 1 }));
      await expectPainted(
        page.getByRole("link", { name: "Get started", exact: true }),
      );
      await expectPainted(
        page
          .getByRole("link", { name: "Browse characters", exact: true })
          .first(),
      );
      for (const heading of await page.locator("main h2").all())
        await expectPainted(heading);
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
      await page.goto("/characters");
      await expectPainted(
        page.getByRole("heading", { name: "Calm Listener", exact: true }),
      );
      await expectPainted(
        page.getByRole("link", { name: "Calm Listener", exact: true }),
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
