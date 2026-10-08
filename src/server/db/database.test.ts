// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(),
  createDatabase: vi.fn(),
}));

vi.mock("@/server/config/load-config", () => ({
  getRuntimeConfig: mocks.getRuntimeConfig,
}));
vi.mock("./client", () => ({
  createDatabase: mocks.createDatabase,
}));

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  mocks.getRuntimeConfig.mockReset();
  mocks.createDatabase.mockReset();
  mocks.getRuntimeConfig.mockResolvedValue({
    secret: { databaseUrl: "******db/app" },
  });
});

test("retries database initialization after failure", async () => {
  const database = {
    $client: { end: vi.fn().mockResolvedValue(undefined) },
  };
  mocks.getRuntimeConfig
    .mockRejectedValueOnce(new Error("config failed"))
    .mockResolvedValueOnce({
      secret: { databaseUrl: "******db/app" },
    });
  mocks.createDatabase.mockReturnValue(database);

  const { getDatabase } = await import("./database");

  await expect(getDatabase()).rejects.toThrow("config failed");
  await expect(getDatabase()).resolves.toBe(database);
  expect(mocks.createDatabase).toHaveBeenCalledOnce();
});

test("concurrent database requests share one initialization attempt", async () => {
  let resolveConfig: (() => void) | undefined;
  const database = {
    $client: { end: vi.fn().mockResolvedValue(undefined) },
  };
  mocks.getRuntimeConfig.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveConfig = () =>
          resolve({
            secret: { databaseUrl: "******db/app" },
          });
      }),
  );
  mocks.createDatabase.mockReturnValue(database);

  const { getDatabase } = await import("./database");
  const first = getDatabase();
  const second = getDatabase();

  expect(first).toBe(second);
  await vi.waitFor(() => expect(mocks.getRuntimeConfig).toHaveBeenCalledOnce());
  resolveConfig?.();
  await expect(first).resolves.toBe(database);
  expect(mocks.createDatabase).toHaveBeenCalledOnce();
});

test("test reset closes the cached pool and allows recreation", async () => {
  const firstEnd = vi.fn().mockResolvedValue(undefined);
  const secondEnd = vi.fn().mockResolvedValue(undefined);
  const firstDatabase = { $client: { end: firstEnd } };
  const secondDatabase = { $client: { end: secondEnd } };
  mocks.createDatabase
    .mockReturnValueOnce(firstDatabase)
    .mockReturnValueOnce(secondDatabase);

  const { getDatabase, resetDatabaseForTests } = await import("./database");

  await expect(getDatabase()).resolves.toBe(firstDatabase);
  await expect(resetDatabaseForTests()).resolves.toBeUndefined();
  expect(firstEnd).toHaveBeenCalledOnce();
  await expect(getDatabase()).resolves.toBe(secondDatabase);
  expect(mocks.createDatabase).toHaveBeenCalledTimes(2);
});
