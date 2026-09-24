// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { buildPostgresUrl } from "../config/postgres-url";

const mocks = vi.hoisted(() => ({
  poolConfigs: [] as unknown[],
}));

vi.mock("pg", () => ({
  Pool: vi.fn(function MockPool(config: unknown) {
    mocks.poolConfigs.push(config);
  }),
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn((pool: unknown) => ({ $client: pool })),
}));

beforeEach(() => {
  mocks.poolConfigs.length = 0;
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
