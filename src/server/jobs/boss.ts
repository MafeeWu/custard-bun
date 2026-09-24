import { PgBoss } from "pg-boss";

interface BossLogger {
  error(message: string, metadata: { name: string }): void;
}

interface CreateBossOptions {
  logger?: BossLogger;
}

interface BossLifecycleOptions {
  stopTimeoutMs?: number;
}

const BOSS_GRACEFUL_STOP_TIMEOUT_MS = 30_000;
const DEFAULT_BOSS_STOP_TIMEOUT_MS = 35_000;

export function createBoss(
  databaseUrl: string,
  options: CreateBossOptions = {},
): PgBoss {
  const logger = options.logger ?? console;
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: "job",
  });

  boss.on("error", (error) => {
    logger.error("job queue error", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  });

  return boss;
}

interface BossState {
  promise?: Promise<PgBoss>;
  instance?: PgBoss;
  resetPromise?: Promise<void>;
}

const globalBoss = globalThis as typeof globalThis & {
  companionBossState?: BossState;
};

function getBossState(): BossState {
  globalBoss.companionBossState ??= {};
  return globalBoss.companionBossState;
}

function stopBoss(
  boss: PgBoss,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopping: Promise<void>;
  try {
    stopping = Promise.resolve(
      boss.stop({
        graceful: true,
        timeout: BOSS_GRACEFUL_STOP_TIMEOUT_MS,
      }),
    );
  } catch (error: unknown) {
    stopping = Promise.reject(error);
  }
  void stopping.catch(() => undefined);

  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(`pg-boss stop timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
    timeout.unref?.();
  });

  return Promise.race([stopping, timedOut]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export function getBoss(
  databaseUrl: string,
  options: BossLifecycleOptions = {},
): Promise<PgBoss> {
  const state = getBossState();
  const stopTimeoutMs =
    options.stopTimeoutMs ?? DEFAULT_BOSS_STOP_TIMEOUT_MS;

  if (state.resetPromise) {
    return state.resetPromise.then(
      () => getBoss(databaseUrl, options),
      () => getBoss(databaseUrl, options),
    );
  }

  if (state.promise) {
    return state.promise;
  }

  const pending = (async () => {
    const boss = createBoss(databaseUrl);
    try {
      await boss.start();
      return boss;
    } catch (error: unknown) {
      await Promise.allSettled([stopBoss(boss, stopTimeoutMs)]);
      throw error;
    }
  })();
  state.promise = pending;

  void pending.then(
    (boss) => {
      if (state.promise === pending) {
        state.instance = boss;
      }
    },
    () => {
      if (state.promise === pending) {
        state.promise = undefined;
        state.instance = undefined;
      }
    },
  );

  return pending;
}

export function resetBoss(
  boss: PgBoss,
  options: BossLifecycleOptions = {},
): Promise<void> {
  const state = getBossState();
  const stopTimeoutMs =
    options.stopTimeoutMs ?? DEFAULT_BOSS_STOP_TIMEOUT_MS;

  if (state.resetPromise) {
    return state.resetPromise;
  }
  if (state.instance !== boss) {
    return Promise.resolve();
  }

  const reset = stopBoss(boss, stopTimeoutMs).finally(() => {
    if (state.resetPromise === reset) {
      state.promise = undefined;
      state.instance = undefined;
      state.resetPromise = undefined;
    }
  });
  state.resetPromise = reset;
  return reset;
}
