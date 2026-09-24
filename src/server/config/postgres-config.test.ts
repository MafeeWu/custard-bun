// @vitest-environment node
import { expect, test } from "vitest";
import { parsePostgresConfig } from "./postgres-config";
import { buildPostgresUrl } from "./postgres-url";

test("round-trips rich application URL components into individual pg fields", () => {
  const username = "user/%2F ?#@";
  const password = "pass/%2F ?#@";
  const database = "data/%2F ?#@";
  const connectionString = `${buildPostgresUrl({
    username,
    password,
    host: "2001:db8::1",
    port: 6543,
    database,
  })}?application_name=companion%20runtime&sslmode=disable`;

  expect(parsePostgresConfig(connectionString)).toMatchObject({
    user: username,
    password,
    database,
    host: "2001:db8::1",
    port: 6543,
    application_name: "companion runtime",
    ssl: false,
  });
  expect(parsePostgresConfig(connectionString)).not.toHaveProperty(
    "connectionString",
  );
});
