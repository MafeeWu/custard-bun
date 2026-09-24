export type HarnessSignal = "SIGINT" | "SIGTERM";

export interface HarnessProbeDatabase {
  deleteHeartbeat(): Promise<void>;
  requireReady(): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessWorker {
  exitCode: number | null;
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
  waitForWorkerExit(worker: HarnessWorker): Promise<void>;
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
}

export interface WorkerHarnessController {
  shutdown(signal: HarnessSignal): Promise<void>;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export async function startWorkerHarness(
  dependencies: WorkerHarnessDependencies,
): Promise<WorkerHarnessController> {
  let database: HarnessProbeDatabase | undefined;
  let worker: HarnessWorker | undefined;
  let server: HarnessServer | undefined;
  const removeListeners: Array<() => void> = [];
  let shutdownPromise: Promise<void> | undefined;

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
        let signaled = false;
        await attempt(() => {
          signaled = dependencies.killWorker(worker!, signal);
        });
        if (signaled) {
          await attempt(() => dependencies.waitForWorkerExit(worker!));
        }
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
        void cleanup("SIGINT", true);
      }),
    );
    removeListeners.push(
      dependencies.onSignal("SIGTERM", () => {
        void cleanup("SIGTERM", true);
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
