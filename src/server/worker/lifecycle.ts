import type { WorkerHeartbeatController } from "@/server/health/worker-heartbeat";

interface ClosableWorkerBoss {
  stop(options: { graceful: true; timeout: number }): Promise<unknown>;
}

export interface WorkerBoss extends ClosableWorkerBoss {
  start(): Promise<unknown>;
}

export interface WorkerDatabase {
  $client: {
    end(): Promise<unknown>;
  };
}

interface WorkerResources {
  heartbeat?: WorkerHeartbeatController;
  boss?: ClosableWorkerBoss;
  database?: WorkerDatabase;
}

interface CloseWorkerOptions {
  timeoutMs?: number;
}

interface WorkerLogger {
  error(message: string, metadata: { name: string }): void;
}

export interface WorkerProcessDependencies<
  Boss extends WorkerBoss = WorkerBoss,
  Database extends WorkerDatabase = WorkerDatabase,
> {
  createDatabase(): Database;
  createBoss(): Boss;
  ensureQueues(boss: Boss): Promise<void>;
  startHeartbeat(
    database: Database,
  ): Promise<WorkerHeartbeatController>;
  registerWorker(boss: Boss): Promise<void>;
  onSignal(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  logger: WorkerLogger;
  terminate(code: number): void;
  cleanupTimeoutMs?: number;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("worker cleanup timed out"));
    }, timeoutMs);
    timeout.unref();
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function closeWorkerResources({
  heartbeat,
  boss,
  database,
}: WorkerResources, options: CloseWorkerOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 35_000;
  let firstError: unknown;

  async function attempt(operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation();
    } catch (error: unknown) {
      firstError ??= error;
    }
  }

  if (heartbeat) {
    await attempt(() => heartbeat.stop());
  }
  if (boss) {
    await attempt(() =>
      withTimeout(
        boss.stop({ graceful: true, timeout: 30_000 }),
        timeoutMs,
      ),
    );
  }
  if (database) {
    await attempt(() => withTimeout(database.$client.end(), timeoutMs));
  }

  if (firstError) {
    throw firstError;
  }
}

export async function runWorkerProcess<
  Boss extends WorkerBoss,
  Database extends WorkerDatabase,
>(
  dependencies: WorkerProcessDependencies<Boss, Database>,
): Promise<void> {
  let database: Database | undefined;
  let boss: Boss | undefined;
  let heartbeat: WorkerHeartbeatController | undefined;

  try {
    database = dependencies.createDatabase();
    boss = dependencies.createBoss();
    await boss.start();
    await dependencies.ensureQueues(boss);
    await dependencies.registerWorker(boss);
    heartbeat = await dependencies.startHeartbeat(database);

    let shutdownPromise: Promise<void> | undefined;
    const shutdown = () => {
      shutdownPromise ??= (async () => {
        try {
          await closeWorkerResources(
            { heartbeat, boss, database },
            { timeoutMs: dependencies.cleanupTimeoutMs },
          );
          dependencies.terminate(0);
        } catch (error: unknown) {
          dependencies.logger.error("worker shutdown failed", {
            name: errorName(error),
          });
          dependencies.terminate(1);
        }
      })();
    };

    dependencies.onSignal("SIGINT", shutdown);
    dependencies.onSignal("SIGTERM", shutdown);
  } catch (error: unknown) {
    dependencies.logger.error("worker startup failed", {
      name: errorName(error),
    });

    try {
      await closeWorkerResources(
        { heartbeat, boss, database },
        { timeoutMs: dependencies.cleanupTimeoutMs },
      );
    } catch (cleanupError: unknown) {
      dependencies.logger.error("worker startup cleanup failed", {
        name: errorName(cleanupError),
      });
    }

    dependencies.terminate(1);
  }
}
