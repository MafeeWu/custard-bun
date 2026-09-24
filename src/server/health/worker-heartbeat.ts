import { and, eq, gt } from "drizzle-orm";
import type { createDatabase } from "@/server/db/client";
import { workerHeartbeat } from "@/server/db/system-schema";

export type HeartbeatDatabase = ReturnType<typeof createDatabase>;

export async function recordWorkerHeartbeat(
  database: HeartbeatDatabase,
  worker: string,
): Promise<void> {
  const updatedAt = new Date();

  await database
    .insert(workerHeartbeat)
    .values({ worker, updatedAt })
    .onConflictDoUpdate({
      target: workerHeartbeat.worker,
      set: { updatedAt },
    });
}

export async function requireRecentWorkerHeartbeat(
  database: HeartbeatDatabase,
  worker: string,
  newerThan: Date,
): Promise<void> {
  const [row] = await database
    .select({ worker: workerHeartbeat.worker })
    .from(workerHeartbeat)
    .where(
      and(
        eq(workerHeartbeat.worker, worker),
        gt(workerHeartbeat.updatedAt, newerThan),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error("worker heartbeat is stale");
  }
}

interface HeartbeatLogger {
  error(message: string, metadata: { name: string }): void;
}

interface StartWorkerHeartbeatOptions {
  recordHeartbeat?: typeof recordWorkerHeartbeat;
  logger?: HeartbeatLogger;
  setIntervalFn?: (
    callback: () => void,
    delay: number,
  ) => NodeJS.Timeout;
  clearIntervalFn?: (timer: NodeJS.Timeout) => void;
}

export async function startWorkerHeartbeat(
  database: HeartbeatDatabase,
  options: StartWorkerHeartbeatOptions = {},
): Promise<() => void> {
  const recordHeartbeat = options.recordHeartbeat ?? recordWorkerHeartbeat;
  const logger = options.logger ?? console;
  const setIntervalFn =
    options.setIntervalFn ??
    ((callback, delay) => setInterval(callback, delay));
  const clearIntervalFn =
    options.clearIntervalFn ?? ((timer) => clearInterval(timer));

  await recordHeartbeat(database, "auth-email-worker");

  const timer = setIntervalFn(() => {
    void recordHeartbeat(database, "auth-email-worker").catch(
      (error: unknown) => {
        logger.error("worker heartbeat failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      },
    );
  }, 20_000);
  timer.unref();

  return () => clearIntervalFn(timer);
}
