import { expect, test } from "@playwright/test";
import { clearMailbox, waitForActionUrl } from "./helpers/mailbox";

test("registers, verifies, signs in, resets password, and deletes the account", async ({
  page,
}) => {
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

  await page.context().clearCookies();
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
  await page.getByLabel("Confirm account email").fill(email);
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByRole("status")).toContainText(/confirmation link/i);
  const deletionUrl = await waitForActionUrl(email, "Confirm deletion");
  await page.goto(deletionUrl);
  await expect(page).toHaveURL(/\/goodbye$/);

  await page.context().clearCookies();
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(secondPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /invalid/i }),
  ).toContainText(/invalid/i);
});
