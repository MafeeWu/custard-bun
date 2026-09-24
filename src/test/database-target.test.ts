// @vitest-environment node
import { expect, test } from "vitest";
import { testDatabaseUrl } from "./database-target";

test.each([
  "postgresql://user:secret@db.example.com/app_test",
  "postgresql://user:secret@127.0.0.1/production",
  "postgresql://user:secret@localhost/app",
  "not-a-url-secret",
])("refuses unsafe test targets without disclosing credentials", (url) => {
  expect(() => testDatabaseUrl({ DATABASE_URL: url })).toThrow(
    "Tests require a loopback PostgreSQL database ending in _test",
  );
});

test("uses an explicit safe override or the isolated local default", () => {
  expect(testDatabaseUrl({})).toContain("/companion_test");
  expect(
    testDatabaseUrl({
      DATABASE_URL: "postgresql://secret@production/app",
      TEST_DATABASE_URL: "postgresql://test@localhost/custom_test",
    }),
  ).toBe("postgresql://test@localhost/custom_test");
});
