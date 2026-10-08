import { expect, test } from "vitest";
import { toAdminActor } from "./admin-actor";

test("converts an administrator session to a bounded actor", () => {
  expect(
    toAdminActor(
      { user: { id: "admin-1", email: "a@example.com", role: "admin" } },
      "op-2",
    ),
  ).toEqual({
    userId: "admin-1",
    label: "a@example.com",
    operationId: "op-2",
  });
});

test("rejects a signed-in non-administrator", () => {
  expect(() =>
    toAdminActor(
      { user: { id: "user-1", email: "u@example.com", role: "user" } },
      "op-1",
    ),
  ).toThrow("Administrator access required");
});

test("rejects a disabled administrator session", () => {
  expect(() =>
    toAdminActor(
      {
        user: {
          id: "admin-1",
          email: "a@example.com",
          role: "admin",
          banned: true,
        },
      },
      "op-disabled",
    ),
  ).toThrow("Administrator access required");
});
