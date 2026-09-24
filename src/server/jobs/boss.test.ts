// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  instances: [] as Array<{
    on: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>,
  startImplementations: [] as Array<() => Promise<void>>,
}));

vi.mock("pg-boss", () => ({
  PgBoss: vi.fn(function MockPgBoss() {
    const instance = {
      on: vi.fn(),
      start: vi.fn(
        mocks.startImplementations.shift() ??
          (() => Promise.resolve()),
      ),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    mocks.instances.push(instance);
    return instance;
  }),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.instances.length = 0;
  mocks.startImplementations.length = 0;
  delete (
    globalThis as typeof globalThis & {
      companionBossState?: unknown;
    }
  ).companionBossState;
});

test("pg-boss error logs contain only the error name", async () => {
  const logger = { error: vi.fn() };
  const { createBoss } = await import("./boss");
  createBoss("******db/app", { logger });
  const errorHandler = mocks.instances[0]?.on.mock.calls.find(
    ([event]) => event === "error",
  )?.[1] as ((error: Error) => void) | undefined;

  errorHandler?.(new Error("******db/private refused"));

  expect(logger.error).toHaveBeenCalledWith("job queue error", {
    name: "Error",
  });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private");
});

test("retries shared boss initialization after a transient start failure", async () => {
  mocks.startImplementations.push(
    () => Promise.reject(new Error("transient")),
    () => Promise.resolve(),
  );
  const { getBoss } = await import("./boss");

  await expect(getBoss("******db/app")).rejects.toThrow(
    "transient",
  );
  expect(mocks.instances[0]!.stop).toHaveBeenCalledWith({
    graceful: true,
    timeout: 30_000,
  });
  await expect(getBoss("******db/app")).resolves.toBe(
    mocks.instances[1],
  );
  expect(mocks.instances).toHaveLength(2);
});

test("failed startup cleanup times out and permits retry", async () => {
  vi.useFakeTimers();
  try {
    mocks.startImplementations.push(
      () => Promise.reject(new Error("transient")),
      () => Promise.resolve(),
    );
    const { getBoss } = await import("./boss");

    const first = getBoss("******db/app", {
      stopTimeoutMs: 10,
    });
    mocks.instances[0]!.stop.mockImplementation(
      () => new Promise<void>(() => undefined),
    );
    const failed = expect(first).rejects.toThrow("transient");

    await vi.advanceTimersByTimeAsync(10);
    await failed;
    await expect(
      getBoss("******db/app", { stopTimeoutMs: 10 }),
    ).resolves.toBe(mocks.instances[1]);
  } finally {
    vi.useRealTimers();
  }
});

test("concurrent resets stop once and block replacement until stop completes", async () => {
  let finishStop: (() => void) | undefined;
  const { getBoss, resetBoss } = await import("./boss");
  const boss = await getBoss("******db/app");
  mocks.instances[0]!.stop.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishStop = resolve;
      }),
  );

  const firstReset = resetBoss(boss);
  const secondReset = resetBoss(boss);
  const replacement = getBoss("******db/app");
  await Promise.resolve();

  expect(mocks.instances[0]!.stop).toHaveBeenCalledOnce();
  expect(mocks.instances).toHaveLength(1);

  finishStop?.();
  await Promise.all([firstReset, secondReset]);
  await expect(replacement).resolves.toBe(mocks.instances[1]);
  expect(mocks.instances).toHaveLength(2);
});

test("timed-out concurrent resets settle and allow replacement initialization", async () => {
  vi.useFakeTimers();
  try {
    let rejectStop: ((error: Error) => void) | undefined;
    const { getBoss, resetBoss } = await import("./boss");
    const boss = await getBoss("******db/app");
    mocks.instances[0]!.stop.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStop = reject;
        }),
    );

    const firstReset = resetBoss(boss, { stopTimeoutMs: 10 });
    const secondReset = resetBoss(boss, { stopTimeoutMs: 10 });
    const replacement = getBoss("******db/app", {
      stopTimeoutMs: 10,
    });

    expect(firstReset).toBe(secondReset);
    expect(mocks.instances[0]!.stop).toHaveBeenCalledOnce();
    expect(mocks.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10);
    await expect(firstReset).rejects.toThrow(
      "pg-boss stop timed out after 10ms",
    );
    await expect(replacement).resolves.toBe(mocks.instances[1]);

    rejectStop?.(new Error("late stop rejection"));
    await Promise.resolve();
  } finally {
    vi.useRealTimers();
  }
});
