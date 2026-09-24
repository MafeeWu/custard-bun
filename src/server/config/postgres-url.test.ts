import { Client } from "pg";
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

test("encodes raw username, password, and database components exactly once", () => {
  const username = "user/%2F ?#@";
  const password = "pass/%2F ?#@";
  const database = "data/%2F ?#@";
  const connectionString = buildPostgresUrl({
    username,
    password,
    host: "postgres",
    port: 5432,
    database,
  });

  expect(connectionString).toBe(
    "postgresql://user%2F%252F%20%3F%23%40:pass%2F%252F%20%3F%23%40@postgres:5432/data%2F%252F%20%3F%23%40",
  );

  const parsed = new URL(connectionString);
  expect(decodeURIComponent(parsed.username)).toBe(username);
  expect(decodeURIComponent(parsed.password)).toBe(password);
  expect(decodeURIComponent(parsed.pathname.slice(1))).toBe(database);

  const client = new Client({ connectionString });
  expect({
    user: client.user,
    password: client.password,
  }).toEqual({ user: username, password });
});

test("formats a raw IPv6 hostname without changing connection components", () => {
  const connectionString = buildPostgresUrl({
    username: "companion",
    password: "secret",
    host: "2001:db8::1",
    port: 5432,
    database: "companion",
  });

  expect(connectionString).toBe(
    "postgresql://companion:secret@[2001:db8::1]:5432/companion",
  );
  const parsed = new URL(connectionString);
  expect(parsed.hostname).toBe("[2001:db8::1]");
  expect(parsed.port).toBe("5432");
});
