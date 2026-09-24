import { expect, test } from "@playwright/test";

test("a forged Better Auth cookie cannot access protected pages", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "forged-session-token",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);

  await page.goto("/app");

  await expect(page).toHaveURL(/\/auth\/sign-in$/);
});
