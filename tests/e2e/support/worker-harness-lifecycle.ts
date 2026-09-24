export type HarnessSignal = "SIGINT" | "SIGTERM";

export interface HarnessProbeDatabase {
  deleteHeartbeat(): Promise<void>;
  requireReady(): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessWorker {
  exitCode: number | null;
  once(
    event: "exit",
    listener: (code: number | null) => void,
  ): unknown;
  off(
    event: "exit",
    listener: (code: number | null) => void,
  ): unknown;
}

export type HarnessServer = object;

interface HarnessLogger {
  error(message: string, metadata: { name: string }): void;
}

export interface WorkerHarnessDependencies {
  createProbeDatabase(): HarnessProbeDatabase;
  spawnWorker(): HarnessWorker;
  waitForWorkerSpawn(worker: HarnessWorker): Promise<void>;
  createReadinessServer(
    worker: HarnessWorker,
    database: HarnessProbeDatabase,
  ): HarnessServer;
  listen(server: HarnessServer): Promise<void>;
  closeServer(server: HarnessServer): Promise<void>;
  killWorker(
    worker: HarnessWorker,
    signal: HarnessSignal | "SIGKILL",
  ): boolean;
  onWorkerExit(
    worker: HarnessWorker,
    listener: (code: number | null) => void,
  ): () => void;
  onSignal(
    signal: HarnessSignal,
    listener: () => void,
  ): () => void;
  setExitCode(code: number): void;
  logger: HarnessLogger;
  gracefulShutdownTimeoutMs?: number;
  forceShutdownTimeoutMs?: number;
}

export interface WorkerHarnessController {
  shutdown(signal: HarnessSignal): Promise<void>;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function waitForWorkerExit(
  worker: HarnessWorker,
  timeoutMs: number,
): Promise<boolean> {
  if (worker.exitCode !== null) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      worker.off("exit", handleExit);
      resolve(exited);
    };
    const handleExit = () => finish(true);
    const timeout = setTimeout(() => {
      finish(worker.exitCode !== null);
    }, timeoutMs);
    timeout.unref?.();

    worker.once("exit", handleExit);
    if (worker.exitCode !== null) {
      finish(true);
    }
  });
}

export async function startWorkerHarness(
  dependencies: WorkerHarnessDependencies,
): Promise<WorkerHarnessController> {
  let database: HarnessProbeDatabase | undefined;
  let worker: HarnessWorker | undefined;
  let server: HarnessServer | undefined;
  const removeListeners: Array<() => void> = [];
  let shutdownPromise: Promise<void> | undefined;
  const gracefulShutdownTimeoutMs =
    dependencies.gracefulShutdownTimeoutMs ?? 35_000;
  const forceShutdownTimeoutMs =
    dependencies.forceShutdownTimeoutMs ?? 5_000;

  async function terminateWorker(
    ownedWorker: HarnessWorker,
    signal: HarnessSignal,
  ): Promise<void> {
    if (ownedWorker.exitCode !== null) {
      return;
    }

    dependencies.killWorker(ownedWorker, signal);
    if (
      await waitForWorkerExit(
        ownedWorker,
        gracefulShutdownTimeoutMs,
      )
    ) {
      return;
    }

    if (ownedWorker.exitCode === null) {
      dependencies.killWorker(ownedWorker, "SIGKILL");
    }
    if (
      await waitForWorkerExit(ownedWorker, forceShutdownTimeoutMs)
    ) {
      return;
    }

    throw new Error("worker did not exit after SIGKILL");
  }

  async function cleanup(
    signal: HarnessSignal,
    stopWorker: boolean,
  ): Promise<void> {
    shutdownPromise ??= (async () => {
      let firstError: unknown;
      const attempt = async (
        operation: () => void | Promise<void>,
      ): Promise<void> => {
        try {
          await operation();
        } catch (error: unknown) {
          firstError ??= error;
          dependencies.logger.error("worker harness cleanup failed", {
            name: errorName(error),
          });
        }
      };

      for (const removeListener of removeListeners.reverse()) {
        await attempt(removeListener);
      }
      if (server) {
        await attempt(() => dependencies.closeServer(server!));
      }
      if (worker && stopWorker && worker.exitCode === null) {
        await attempt(() => terminateWorker(worker!, signal));
      }
      if (database) {
        await attempt(() => database!.close());
      }

      if (firstError) {
        throw firstError;
      }
    })();

    return shutdownPromise;
  }

  try {
    database = dependencies.createProbeDatabase();
    await database.deleteHeartbeat();

    worker = dependencies.spawnWorker();
    await dependencies.waitForWorkerSpawn(worker);
    server = dependencies.createReadinessServer(worker, database);
    await dependencies.listen(server);

    removeListeners.push(
      dependencies.onWorkerExit(worker, (code) => {
        void cleanup("SIGTERM", false)
          .catch(() => undefined)
          .finally(() => dependencies.setExitCode(code ?? 1));
      }),
    );
    removeListeners.push(
      dependencies.onSignal("SIGINT", () => {
        void cleanup("SIGINT", true).catch(() => {
          dependencies.setExitCode(1);
        });
      }),
    );
    removeListeners.push(
      dependencies.onSignal("SIGTERM", () => {
        void cleanup("SIGTERM", true).catch(() => {
          dependencies.setExitCode(1);
        });
      }),
    );

    return {
      shutdown: (signal) => cleanup(signal, true),
    };
  } catch (error: unknown) {
    try {
      await cleanup("SIGTERM", true);
    } catch {
      // Cleanup failures are logged with redacted metadata above.
    }
    throw error;
  }
}
