import { PgBoss } from "pg-boss";

export function createBoss(databaseUrl: string): PgBoss {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: "job",
  });

  boss.on("error", (error) => {
    console.error("job queue error", {
      name: error.name,
      message: error.message,
    });
  });

  return boss;
}

const globalBoss = globalThis as typeof globalThis & {
  companionBoss?: Promise<PgBoss>;
};

export function getBoss(databaseUrl: string): Promise<PgBoss> {
  globalBoss.companionBoss ??= (async () => {
    const boss = createBoss(databaseUrl);
    await boss.start();
    return boss;
  })();

  return globalBoss.companionBoss;
}
