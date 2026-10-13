import { expect, test } from "@playwright/test";
import { rateLimit } from "../../src/server/db/auth-schema";
import { createAdminTestDatabase } from "./support/admin";
import { e2eEnvironment } from "./support/environment";
import { clearMailbox, waitForActionUrl } from "./helpers/mailbox";

test("registers, verifies, signs in, resets password, and deletes the account", async ({
  page,
  browser,
}) => {
  const database = createAdminTestDatabase(e2eEnvironment.DATABASE_URL!);
  await database.delete(rateLimit);
  await database.$client.end();
  await clearMailbox();
  const email = `person-${Date.now()}@example.com`;
  const firstPassword = "correct horse battery staple";
  const secondPassword = "second correct horse battery staple";

  await page.goto("/auth/sign-up");
  await page.getByLabel("Name").fill("Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(firstPassword);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();

  const verificationUrl = await waitForActionUrl(email, "Verify your");
  await page.goto(verificationUrl);
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(firstPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);

  const retained = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  const retainedPage = await retained.newPage();
  try {
    await retainedPage.goto("http://127.0.0.1:3000/account");
    await expect(retainedPage).toHaveURL(/\/account$/);

    await page.goto("/auth/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText(
      /if an account exists/i,
    );
    const resetUrl = await waitForActionUrl(email, "Reset your");
    await page.goto(resetUrl);
    await page.getByLabel("New password").fill(secondPassword);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByRole("status")).toContainText(/has been reset/i);
    await retainedPage.goto("http://127.0.0.1:3000/account");
    await expect(retainedPage).toHaveURL(/\/auth\/sign-in$/);
  } finally {
    await retained.close();
  }

  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(firstPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /invalid/i }),
  ).toContainText(/invalid/i);
  await expect(page).toHaveURL(/\/auth\/sign-in$/);

  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(secondPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/account");
  await page
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  const deletionDialog = page.getByRole("dialog", { name: "Delete account" });
  await deletionDialog.getByLabel("Confirm account email").fill(email);
  await deletionDialog
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /confirmation link/i }),
  ).toBeVisible();
  const deletionUrl = await waitForActionUrl(email, "Confirm deletion");
  await page.goto(deletionUrl);
  await page
    .getByRole("button", { name: "Confirm account deletion", exact: true })
    .click();
  await expect(page).toHaveURL(/\/goodbye$/);

  await page.context().clearCookies();
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(secondPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /invalid|sign-in is unavailable/i }),
  ).toContainText(/invalid|sign-in is unavailable/i);
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
});
