// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import {
  closeWorkerResources,
  runWorkerProcess,
  type WorkerProcessDependencies,
} from "./lifecycle";

afterEach(() => {
  vi.useRealTimers();
});

test("stops heartbeat and closes pg-boss and database resources", async () => {
  const stopHeartbeat = vi.fn().mockResolvedValue(undefined);
  const boss = {
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const database = {
    $client: {
      end: vi.fn().mockResolvedValue(undefined),
    },
  };

  await closeWorkerResources({
    heartbeat: { stop: stopHeartbeat },
    boss,
    database,
  });

  expect(stopHeartbeat).toHaveBeenCalledOnce();
  expect(boss.stop).toHaveBeenCalledWith({
    graceful: true,
    timeout: 30_000,
  });
  expect(database.$client.end).toHaveBeenCalledOnce();
});

test("closes the database even when pg-boss shutdown fails", async () => {
  const database = {
    $client: {
      end: vi.fn().mockResolvedValue(undefined),
    },
  };

  await expect(
    closeWorkerResources({
      heartbeat: { stop: vi.fn().mockResolvedValue(undefined) },
      boss: {
        stop: vi.fn().mockRejectedValue(new Error("boss stop failed")),
      },
      database,
    }),
  ).rejects.toThrow("boss stop failed");

  expect(database.$client.end).toHaveBeenCalledOnce();
});

test("waits for an in-flight heartbeat before closing the database", async () => {
  let finishHeartbeat: (() => void) | undefined;
  const stopHeartbeat = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishHeartbeat = resolve;
      }),
  );
  const end = vi.fn().mockResolvedValue(undefined);

  const closing = closeWorkerResources({
    heartbeat: { stop: stopHeartbeat },
    boss: { stop: vi.fn().mockResolvedValue(undefined) },
    database: { $client: { end } },
  });
  await Promise.resolve();

  expect(end).not.toHaveBeenCalled();
  finishHeartbeat?.();
  await closing;
  expect(end).toHaveBeenCalledOnce();
});

test("continues cleanup after a bounded pg-boss stop timeout", async () => {
  vi.useFakeTimers();
  const end = vi.fn().mockResolvedValue(undefined);
  const closing = closeWorkerResources(
    {
      heartbeat: { stop: vi.fn().mockResolvedValue(undefined) },
      boss: { stop: vi.fn(() => new Promise(() => undefined)) },
      database: { $client: { end } },
    },
    { timeoutMs: 1_000 },
  );
  const rejection = expect(closing).rejects.toThrow("worker cleanup timed out");

  await vi.advanceTimersByTimeAsync(1_000);
  await rejection;
  expect(end).toHaveBeenCalledOnce();
});

function createWorkerDependencies(
  overrides: Partial<WorkerProcessDependencies> = {},
): WorkerProcessDependencies & { events: string[] } {
  const events: string[] = [];
  const terminate = vi.fn((code: number) => {
    events.push(`terminate:${code}`);
  });
  const database = {
    $client: {
      end: vi.fn(async () => {
        events.push("database:end");
      }),
    },
  };
  const boss = {
    start: vi.fn(async () => {
      events.push("boss:start");
    }),
    stop: vi.fn(async () => {
      events.push("boss:stop");
    }),
  };

  return {
    createDatabase: vi.fn(() => database),
    createBoss: vi.fn(() => boss),
    ensureQueues: vi.fn(async () => {
      events.push("queues:ready");
    }),
    startHeartbeat: vi.fn(async () => ({
      stop: vi.fn(async () => {
        events.push("heartbeat:stop");
      }),
    })),
    registerWorker: vi.fn(async () => {
      events.push("worker:registered");
    }),
    onSignal: vi.fn(),
    logger: { error: vi.fn() },
    terminate,
    cleanupTimeoutMs: 1_000,
    events,
    ...overrides,
  };
}

test.each([
  ["queue setup", "ensureQueues"],
  ["initial heartbeat or interval setup", "startHeartbeat"],
  ["worker registration", "registerWorker"],
] as const)(
  "cleans acquired resources and terminates after %s failure",
  async (_label, failingStage) => {
    const dependencies = createWorkerDependencies({
      [failingStage]: vi.fn().mockRejectedValue(new Error("private failure")),
    });

    await runWorkerProcess(dependencies);

    expect(dependencies.events).toEqual([
      "boss:start",
      ...(failingStage === "ensureQueues" ? [] : ["queues:ready"]),
      ...(failingStage === "startHeartbeat" ? ["worker:registered"] : []),
      "boss:stop",
      "database:end",
      "terminate:1",
    ]);
    expect(dependencies.logger.error).toHaveBeenCalledWith(
      "worker startup failed",
      { name: "Error" },
    );

    expect(
      JSON.stringify(vi.mocked(dependencies.logger.error).mock.calls),
    ).not.toContain("private");
  },
);

test("does not advertise readiness until all queue handlers are registered", async () => {
  let release!: () => void;
  const registration = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dependencies = createWorkerDependencies({
    registerWorker: vi.fn(() => registration),
  });
  const startup = runWorkerProcess(dependencies);
  await vi.waitFor(() =>
    expect(dependencies.registerWorker).toHaveBeenCalledOnce(),
  );
  const advertisedBeforeRegistration = vi.mocked(dependencies.startHeartbeat)
    .mock.calls.length;
  release();
  await startup;
  expect(advertisedBeforeRegistration).toBe(0);
  expect(dependencies.startHeartbeat).toHaveBeenCalledOnce();
});

test("startup termination still occurs when cleanup reports an error", async () => {
  const dependencies = createWorkerDependencies({
    ensureQueues: vi.fn().mockRejectedValue(new Error("startup failed")),
  });
  vi.mocked(dependencies.createBoss).mockReturnValue({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockRejectedValue(new Error("stop failed")),
  });

  await runWorkerProcess(dependencies);

  expect(dependencies.terminate).toHaveBeenCalledWith(1);
  expect(dependencies.events.at(-1)).toBe("terminate:1");
});
