import { describe, expect, test } from "vitest";
import { loadDatabaseUrl } from "./database-url";

describe("loadDatabaseUrl", () => {
  test("loads a PostgreSQL database URL", () => {
    expect(
      loadDatabaseUrl({
        DATABASE_URL: "postgresql://companion:companion@127.0.0.1:55432/companion_test",
      }),
    ).toBe("postgresql://companion:companion@127.0.0.1:55432/companion_test");
  });

  test.each([
    ["missing DATABASE_URL", {}, "environment.DATABASE_URL"],
    [
      "non-postgresql DATABASE_URL",
      { DATABASE_URL: "https://example.com" },
      "environment.DATABASE_URL",
    ],
  ])("rejects %s", (_name, env, expectedMessage) => {
    expect(() => loadDatabaseUrl(env)).toThrow(expectedMessage);
  });
});
