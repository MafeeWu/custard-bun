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

test("application deletion email explains immediate lockout and deferred purge without token/owner in subject", () => {
  const email = renderAuthEmail(
    {
      kind: "delete-account",
      to: "private@example.com",
      actionUrl:
        "https://example.com/account/delete/confirm#token=private-token",
      deletionRequestId: "request",
    },
    "Custard Bun",
  );
  expect(email.subject).not.toMatch(/private|request/);
  expect(email.text).toContain("#token=private-token");
  expect(email.text).toMatch(/immediately stops account access/);
  expect(email.text).toMatch(/purged asynchronously/);
});
