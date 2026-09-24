import { expect, test } from "vitest";
import { buildPostgresUrl } from "./postgres-url";

test("percent-encodes arbitrary PostgreSQL credentials", () => {
  expect(
    buildPostgresUrl({
      username: "companion",
      password: "p/a?s#s@ word",
      host: "postgres",
      port: 5432,
      database: "companion",
    }),
  ).toBe(
    "postgresql://companion:p%2Fa%3Fs%23s%40%20word@postgres:5432/companion",
  );
});
