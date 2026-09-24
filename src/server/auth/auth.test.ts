// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(),
  createDatabase: vi.fn(),
  getBoss: vi.fn(),
  resetBoss: vi.fn(),
  ensureQueues: vi.fn(),
  createAuth: vi.fn(),
  createEmailQueue: vi.fn(),
}));

vi.mock("@/server/config/load-config", () => ({
  getRuntimeConfig: mocks.getRuntimeConfig,
}));
vi.mock("@/server/db/client", () => ({
  createDatabase: mocks.createDatabase,
}));
vi.mock("@/server/jobs/boss", () => ({
  getBoss: mocks.getBoss,
  resetBoss: mocks.resetBoss,
}));
vi.mock("@/server/jobs/queues", () => ({
  ensureQueues: mocks.ensureQueues,
}));
vi.mock("./create-auth", () => ({
  createAuth: mocks.createAuth,
}));
vi.mock("@/server/email/email-queue", () => ({
  createEmailQueue: mocks.createEmailQueue,
}));

beforeEach(() => {
  vi.resetModules();
  mocks.getRuntimeConfig.mockResolvedValue({
    secret: { databaseUrl: "******db/app" },
  });
  mocks.getBoss.mockResolvedValue({ id: "boss" });
  mocks.resetBoss.mockResolvedValue(undefined);
  mocks.ensureQueues.mockResolvedValue(undefined);
  mocks.createEmailQueue.mockReturnValue({ send: vi.fn() });
  mocks.createAuth.mockReturnValue({ api: "auth" });
});

test("retries auth initialization after failure and closes failed resources", async () => {
  const firstEnd = vi.fn().mockResolvedValue(undefined);
  const secondEnd = vi.fn().mockResolvedValue(undefined);
  mocks.createDatabase
    .mockReturnValueOnce({ $client: { end: firstEnd } })
    .mockReturnValueOnce({ $client: { end: secondEnd } });
  mocks.ensureQueues
    .mockRejectedValueOnce(new Error("queue setup failed"))
    .mockResolvedValueOnce(undefined);

  const { getAuth } = await import("./auth");

  await expect(getAuth()).rejects.toThrow("queue setup failed");
  expect(firstEnd).toHaveBeenCalledOnce();
  expect(mocks.resetBoss).toHaveBeenCalledWith({ id: "boss" });

  await expect(getAuth()).resolves.toEqual({ api: "auth" });
  expect(mocks.createDatabase).toHaveBeenCalledTimes(2);
  expect(secondEnd).not.toHaveBeenCalled();
});

test("concurrent auth requests share one initialization attempt", async () => {
  let finishQueues: (() => void) | undefined;
  mocks.createDatabase.mockReturnValue({
    $client: { end: vi.fn().mockResolvedValue(undefined) },
  });
  mocks.ensureQueues.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishQueues = resolve;
      }),
  );

  const { getAuth } = await import("./auth");
  const first = getAuth();
  const second = getAuth();

  expect(first).toBe(second);
  await vi.waitFor(() =>
    expect(mocks.createDatabase).toHaveBeenCalledOnce(),
  );
  finishQueues?.();
  await expect(first).resolves.toEqual({ api: "auth" });
});
