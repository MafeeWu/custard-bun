import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { rateLimit, session, user } from "../../src/server/db/auth-schema";
import {
  bootstrapAdmin,
  cleanupAdminTestData,
  createAdminTestDatabase,
} from "./support/admin";
import { e2eEnvironment } from "./support/environment";
import { waitForActionUrl } from "./helpers/mailbox";

test("administrators disable and restore ordinary users, revoke retained sessions and keep reasons out of audit", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const database = createAdminTestDatabase(e2eEnvironment.TEST_DATABASE_URL!);
  const token = randomUUID();
  const adminEmail = `access-admin-${token}@example.com`;
  const userEmail = `ordinary-${token}@example.com`;
  const password = "correct horse battery staple";
  const reason = `Private disable reason ${token}`;
  const ordinary = await browser.newContext({
    baseURL: e2eEnvironment.BETTER_AUTH_URL,
  });
  const userPage = await ordinary.newPage();
  try {
    await database.delete(rateLimit);
    await bootstrapAdmin(page, adminEmail, password, database);
    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { name: "User access", exact: true }),
    ).toBeVisible();

    await userPage.goto("/auth/sign-up");
    await userPage
      .getByLabel("Name", { exact: true })
      .fill("Ordinary E2E user");
    await userPage.getByLabel("Email", { exact: true }).fill(userEmail);
    await userPage.getByLabel("Password", { exact: true }).fill(password);
    await userPage
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(userPage.getByText(/check your email/i)).toBeVisible();
    await userPage.goto(await waitForActionUrl(userEmail, "Verify your"));
    await userPage.goto("/auth/sign-in");
    await userPage.getByLabel("Email", { exact: true }).fill(userEmail);
    await userPage.getByLabel("Password", { exact: true }).fill(password);
    await userPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(userPage).toHaveURL(/\/app$/);
    await userPage.goto("/account");
    await expect(userPage).toHaveURL(/\/account$/);
    for (const route of [
      "/admin",
      "/admin/characters",
      "/admin/users",
      "/admin/audit",
    ]) {
      expect((await userPage.goto(route))?.status()).toBe(404);
      await expect(userPage.getByRole("table")).toHaveCount(0);
    }
    const [target] = await database
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, userEmail));
    expect(target).toBeDefined();
    expect(
      await database
        .select()
        .from(session)
        .where(eq(session.userId, target.id)),
    ).toHaveLength(1);

    await page.getByLabel("Search users").fill(userEmail);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const row = page.getByRole("row").filter({
      has: page.getByRole("cell", { name: userEmail, exact: true }),
    });
    await expect(row).toHaveCount(1);
    await row.getByLabel("Reason for disabling user").fill(reason);
    await row.getByRole("checkbox").check();
    await row
      .getByRole("button", { name: "Disable user", exact: true })
      .click();
    await expect(
      row.getByRole("cell", { name: "Disabled", exact: true }),
    ).toBeVisible();
    expect(
      await database
        .select()
        .from(session)
        .where(eq(session.userId, target.id)),
    ).toEqual([]);
    await userPage.goto("/account");
    await expect(userPage).toHaveURL(/\/auth\/sign-in$/);

    await ordinary.clearCookies();
    await userPage.getByLabel("Email", { exact: true }).fill(userEmail);
    await userPage.getByLabel("Password", { exact: true }).fill(password);
    const rejected = userPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/sign-in/email") &&
        response.request().method() === "POST",
    );
    await userPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    expect((await rejected).status()).toBe(403);
    await expect(
      userPage.getByRole("alert").filter({ hasText: /Sign-in is unavailable/ }),
    ).toBeVisible();
    await expect(userPage).toHaveURL(/\/auth\/sign-in$/);
    await expect(userPage.locator("body")).not.toContainText(reason);

    await row
      .getByRole("button", { name: "Restore user", exact: true })
      .click();
    await expect(
      row.getByRole("cell", { name: "Active", exact: true }),
    ).toBeVisible();
    await userPage.goto("/auth/sign-in");
    await userPage.getByLabel("Email", { exact: true }).fill(userEmail);
    await userPage.getByLabel("Password", { exact: true }).fill(password);
    await userPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(userPage).toHaveURL(/\/app$/);
    await userPage.goto("/account");
    await expect(userPage).toHaveURL(/\/account$/);

    await page.goto("/admin/audit");
    const events = page
      .getByRole("row")
      .filter({ hasText: `user:${target.id}` })
      .filter({ hasText: adminEmail });
    await expect(events).toHaveCount(2);
    for (const action of ["user.disable", "user.restore"]) {
      await expect(
        events.filter({
          has: page.getByRole("cell", { name: action, exact: true }),
        }),
      ).toHaveCount(1);
    }
    await expect(page.getByRole("table")).not.toContainText(reason);
    await expect(page.getByRole("table")).not.toContainText(password);
  } finally {
    await ordinary.close();
    try {
      await cleanupAdminTestData(database, [adminEmail, userEmail], []);
    } finally {
      await database.$client.end();
    }
  }
});
