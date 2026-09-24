interface WorkerBoss {
  stop(options: { graceful: true; timeout: number }): Promise<unknown>;
}

interface WorkerDatabase {
  $client: {
    end(): Promise<unknown>;
  };
}

interface WorkerResources {
  stopHeartbeat(): void;
  boss: WorkerBoss;
  database: WorkerDatabase;
}

export async function closeWorkerResources({
  stopHeartbeat,
  boss,
  database,
}: WorkerResources): Promise<void> {
  stopHeartbeat();

  try {
    await boss.stop({ graceful: true, timeout: 30_000 });
  } finally {
    await database.$client.end();
  }
}
