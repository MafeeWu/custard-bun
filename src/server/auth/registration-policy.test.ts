import { APIError } from "better-auth/api";
import { expect, test } from "vitest";
import { assertRegistrationOpen } from "./registration-policy";

test("allows registration when open", () => {
  expect(() => assertRegistrationOpen(true)).not.toThrow();
});

test("rejects direct registration when closed", () => {
  expect(() => assertRegistrationOpen(false)).toThrow(APIError);
  expect(() => assertRegistrationOpen(false)).toThrow(
    "Registration is currently closed",
  );
});
