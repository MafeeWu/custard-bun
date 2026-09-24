// @vitest-environment node
import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import {
  startWorkerHarness,
  type WorkerHarnessDependencies,
} from "../../tests/e2e/support/worker-harness-lifecycle";

function createDependencies(
  overrides: Partial<WorkerHarnessDependencies> = {},
) {
  const closeDatabase = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const closeServer = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const worker = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
  });
  const killWorker = vi.fn(() => {
    worker.exitCode = 0;
    worker.emit("exit", 0);
    return true;
  });

  const dependencies: WorkerHarnessDependencies = {
    createProbeDatabase: vi.fn(() => ({
      deleteHeartbeat: vi.fn().mockResolvedValue(undefined),
      close: closeDatabase,
      requireReady: vi.fn().mockResolvedValue(undefined),
    })),
    spawnWorker: vi.fn(() => worker),
    waitForWorkerSpawn: vi.fn().mockResolvedValue(undefined),
    createReadinessServer: vi.fn(() => ({})),
    listen: vi.fn().mockResolvedValue(undefined),
    closeServer,
    killWorker,
    onWorkerExit: vi.fn(() => vi.fn()),
    onSignal: vi.fn(() => vi.fn()),
    setExitCode: vi.fn(),
    logger: { error: vi.fn() },
    gracefulShutdownTimeoutMs: 10,
    forceShutdownTimeoutMs: 10,
    ...overrides,
  };

  return {
    dependencies,
    closeDatabase,
    closeServer,
    killWorker: vi.mocked(dependencies.killWorker),
    worker,
  };
}

test("closes the probe database when heartbeat deletion fails", async () => {
  const { dependencies, closeDatabase } = createDependencies();
  vi.mocked(dependencies.createProbeDatabase).mockReturnValue({
    deleteHeartbeat: vi.fn().mockRejectedValue(new Error("delete failed")),
    close: closeDatabase,
    requireReady: vi.fn().mockResolvedValue(undefined),
  });

  await expect(startWorkerHarness(dependencies)).rejects.toThrow(
    "delete failed",
  );

  expect(closeDatabase).toHaveBeenCalledOnce();
  expect(dependencies.spawnWorker).not.toHaveBeenCalled();
});

test("cleans the exact child and database when child spawn fails", async () => {
  const {
    dependencies,
    closeDatabase,
    killWorker,
  } = createDependencies({
    waitForWorkerSpawn: vi.fn().mockRejectedValue(new Error("spawn failed")),
  });

  await expect(startWorkerHarness(dependencies)).rejects.toThrow(
    "spawn failed",
  );

  const worker = vi.mocked(dependencies.spawnWorker).mock.results[0]?.value;
  expect(killWorker).toHaveBeenCalledWith(worker, "SIGTERM");
  expect(closeDatabase).toHaveBeenCalledOnce();
});

test("kills the exact child and closes server and database when listen fails", async () => {
  const {
    dependencies,
    closeDatabase,
    closeServer,
    killWorker,
  } = createDependencies({
    listen: vi.fn().mockRejectedValue(new Error("listen failed")),
  });

  const starting = startWorkerHarness(dependencies);
  await expect(starting).rejects.toThrow("listen failed");

  const spawnedWorker = vi.mocked(dependencies.spawnWorker).mock.results[0]
    ?.value;
  expect(spawnedWorker).toBeDefined();
  expect(killWorker).toHaveBeenCalledWith(spawnedWorker, "SIGTERM");
  expect(closeServer).toHaveBeenCalledOnce();
  expect(closeDatabase).toHaveBeenCalledOnce();
});

test("falls back to SIGKILL when the initial signal returns false", async () => {
  vi.useFakeTimers();
  try {
    const {
      dependencies,
      killWorker,
      worker,
    } = createDependencies();
    killWorker.mockImplementation((_worker, signal) => {
      if (signal === "SIGKILL") {
        worker.exitCode = 137;
        worker.emit("exit", 137);
        return true;
      }
      return false;
    });
    const controller = await startWorkerHarness(dependencies);

    const shutdown = controller.shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(10);
    await shutdown;

    expect(killWorker.mock.calls).toEqual([
      [worker, "SIGTERM"],
      [worker, "SIGKILL"],
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("rejects deterministically and closes resources when SIGKILL does not exit", async () => {
  vi.useFakeTimers();
  try {
    const {
      dependencies,
      closeDatabase,
      closeServer,
      killWorker,
    } = createDependencies({
      killWorker: vi.fn(() => true),
    });
    const controller = await startWorkerHarness(dependencies);

    const shutdown = controller.shutdown("SIGTERM");
    const rejected = expect(shutdown).rejects.toThrow(
      "worker did not exit after SIGKILL",
    );
    await vi.advanceTimersByTimeAsync(20);
    await rejected;

    expect(killWorker).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "SIGTERM",
    );
    expect(killWorker).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "SIGKILL",
    );
    expect(closeServer).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

test("does not force kill after a graceful exit", async () => {
  const {
    dependencies,
    killWorker,
    worker,
  } = createDependencies();
  const controller = await startWorkerHarness(dependencies);

  await controller.shutdown("SIGINT");

  expect(killWorker).toHaveBeenCalledOnce();
  expect(killWorker).toHaveBeenCalledWith(worker, "SIGINT");
});

test("does not signal a child that already exited", async () => {
  const {
    dependencies,
    killWorker,
    worker,
  } = createDependencies();
  const controller = await startWorkerHarness(dependencies);
  worker.exitCode = 0;

  await controller.shutdown("SIGTERM");

  expect(killWorker).not.toHaveBeenCalled();
});

test("cleans every acquired resource when later handler setup fails", async () => {
  const removeFirstSignal = vi.fn();
  const onSignal = vi
    .fn()
    .mockReturnValueOnce(removeFirstSignal)
    .mockImplementationOnce(() => {
      throw new Error("handler setup failed");
    });
  const {
    dependencies,
    closeDatabase,
    closeServer,
    killWorker,
  } = createDependencies({ onSignal });

  await expect(startWorkerHarness(dependencies)).rejects.toThrow(
    "handler setup failed",
  );

  const worker = vi.mocked(dependencies.spawnWorker).mock.results[0]?.value;
  expect(removeFirstSignal).toHaveBeenCalledOnce();
  expect(killWorker).toHaveBeenCalledWith(worker, "SIGTERM");
  expect(closeServer).toHaveBeenCalledOnce();
  expect(closeDatabase).toHaveBeenCalledOnce();
});
