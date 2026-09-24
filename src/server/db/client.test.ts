// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { buildPostgresUrl } from "../config/postgres-url";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({
  poolConfigs: [] as unknown[],
}));

vi.mock("pg", () => ({
  Pool: vi.fn(function MockPool(config: unknown) {
    mocks.poolConfigs.push(config);
    return Object.assign(new EventEmitter(), { ending: false });
  }),
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn((pool: unknown) => ({ $client: pool })),
}));

beforeEach(() => {
  mocks.poolConfigs.length = 0;
});

test("idle pool errors are handled with sanitized diagnostics, not unhandled exceptions", async () => {
  const { createDatabase } = await import("./client");
  const logger = { error: vi.fn() };
  const database = createDatabase(
    "postgresql://test:test@localhost/app_test",
    {},
    logger,
  );
  const error = new TypeError("session-token-secret SQL parameter password");
  expect(() =>
    database.$client.emit("error", error, { password: "private" }),
  ).not.toThrow();
  expect(logger.error).toHaveBeenCalledWith("database idle connection failed", {
    name: "TypeError",
  });
  expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(
    /session-token|password|private/,
  );
  logger.error.mockClear();
  Object.assign(database.$client, { ending: true });
  database.$client.emit("error", error);
  expect(logger.error).not.toHaveBeenCalled();
});

test("creates pg pools with the exact database and readiness options", async () => {
  const database = "data/%2F ?#@";
  const connectionString = buildPostgresUrl({
    username: "user/%2F ?#@",
    password: "pass/%2F ?#@",
    host: "postgres",
    port: 5432,
    database,
  });
  const { createDatabase } = await import("./client");

  createDatabase(connectionString, {
    connectionTimeoutMillis: 1_000,
    query_timeout: 1_000,
    statement_timeout: 1_000,
  });

  expect(mocks.poolConfigs).toEqual([
    expect.objectContaining({
      database,
      connectionTimeoutMillis: 1_000,
      query_timeout: 1_000,
      statement_timeout: 1_000,
    }),
  ]);
  expect(mocks.poolConfigs[0]).not.toHaveProperty("connectionString");
});
