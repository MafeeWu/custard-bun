import { expect, test } from "@playwright/test";

for (const identity of ["anonymous", "forged cookie"]) {
  test(`${identity} cannot access account or administrator pages`, async ({
    context,
    page,
  }) => {
    if (identity === "forged cookie") {
      await context.addCookies([
        {
          name: "better-auth.session_token",
          value: "forged-session-token",
          domain: "127.0.0.1",
          path: "/",
        },
      ]);
    }
    for (const route of [
      "/app",
      "/account",
      "/admin",
      "/admin/characters",
      "/admin/users",
      "/admin/audit",
    ]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/auth\/sign-in$/);
    }
  });
}
