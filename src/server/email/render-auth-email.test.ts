import { expect, test } from "vitest";
import { renderAuthEmail } from "./render-auth-email";

test("renders a verification email without leaking the token into the subject", () => {
  const email = renderAuthEmail(
    {
      kind: "verify-email",
      to: "person@example.com",
      actionUrl: "https://example.com/verify?token=secret-token",
    },
    "Custard Bun",
  );

  expect(email.subject).toBe("Verify your Custard Bun email");
  expect(email.subject).not.toContain("secret-token");
  expect(email.text).toContain("https://example.com/verify?token=secret-token");
});
