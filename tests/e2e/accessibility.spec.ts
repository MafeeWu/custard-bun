import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { startCharacterConversation } from "./support/chat";
import {
  promoteVisualUser,
  registerVisualUser,
  resetVisualFixtures,
} from "./support/visual-fixtures";

test.describe.configure({ mode: "serial" });

async function expectAccessiblePage(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const withoutContrast = await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .analyze();
  expect(
    withoutContrast.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);

  const contrast = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .analyze();
  expect(
    contrast.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

test("has no axe violations across representative shells", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await resetVisualFixtures(`a11y-${testInfo.project.name}`);
  try {
    await page.goto("/");
    await expectAccessiblePage(page);

    await page.goto("/auth/sign-up");
    await expectAccessiblePage(page);

    await registerVisualUser(page, fixture);
    await expectAccessiblePage(page);

    await startCharacterConversation(page, "calm-listener");
    await expectAccessiblePage(page);

    await page.goto("/account");
    await expectAccessiblePage(page);

    await promoteVisualUser(page, fixture.database, fixture);
    await page.goto("/admin/users");
    await expectAccessiblePage(page);
  } finally {
    await fixture.database.$client.end();
  }
});

test("supports keyboard-only navigation, overlays, Escape, and focus restoration", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-light");
  const fixture = await resetVisualFixtures("a11y-keyboard");
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const navigationTrigger = page.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    await expect(navigationTrigger).toBeVisible();
    await navigationTrigger.focus();
    await expect(navigationTrigger).toBeFocused();
    await navigationTrigger.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Primary", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close navigation", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(navigationTrigger).toBeFocused();

    await registerVisualUser(page, fixture);
    await startCharacterConversation(page, "calm-listener");

    const historyTrigger = page.getByRole("button", {
      name: "Open conversation history",
      exact: true,
    });
    await historyTrigger.focus();
    await expect(historyTrigger).toBeFocused();
    await historyTrigger.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Conversation history" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(historyTrigger).toBeFocused();

    const actionsTrigger = page.getByRole("button", {
      name: "Open conversation actions",
      exact: true,
    });
    await actionsTrigger.focus();
    await expect(actionsTrigger).toBeFocused();
    await actionsTrigger.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Conversation actions" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(actionsTrigger).toBeFocused();

    await page.goto("/account");
    const deleteTrigger = page.getByRole("button", {
      name: "Delete account",
      exact: true,
    });
    await deleteTrigger.focus();
    await expect(deleteTrigger).toBeFocused();
    await deleteTrigger.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Delete account" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Confirm account email", { exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(deleteTrigger).toBeFocused();
  } finally {
    await fixture.database.$client.end();
  }
});
