import { PgBoss } from "pg-boss";

interface BossLogger {
  error(message: string, metadata: { name: string }): void;
}

interface CreateBossOptions {
  logger?: BossLogger;
}

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

export function getBoss(databaseUrl: string): Promise<PgBoss> {
  const state = getBossState();

  if (state.resetPromise) {
    return state.resetPromise.then(() => getBoss(databaseUrl));
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
      await Promise.allSettled([
        boss.stop({ graceful: true, timeout: 30_000 }),
      ]);
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

export function resetBoss(boss: PgBoss): Promise<void> {
  const state = getBossState();

  if (state.resetPromise) {
    return state.resetPromise;
  }
  if (state.instance !== boss) {
    return Promise.resolve();
  }

  const reset = (async () => {
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
    } finally {
      state.promise = undefined;
      state.instance = undefined;
      state.resetPromise = undefined;
    }
  })();
  state.resetPromise = reset;
  return reset;
}
