// @vitest-environment node
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
  const killWorker = vi.fn(() => true);
  const worker = { exitCode: null as number | null };

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
    waitForWorkerExit: vi.fn().mockResolvedValue(undefined),
    onWorkerExit: vi.fn(() => vi.fn()),
    onSignal: vi.fn(() => vi.fn()),
    setExitCode: vi.fn(),
    logger: { error: vi.fn() },
    ...overrides,
  };

  return { dependencies, closeDatabase, closeServer, killWorker };
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
