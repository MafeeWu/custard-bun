export interface ReadinessDependencies {
  checkDatabase(): Promise<void>;
  checkWorker(): Promise<void>;
}

export interface ReadinessResult {
  ready: boolean;
  checks: {
    database: "ok" | "error";
    worker: "ok" | "error";
  };
}

export async function checkReadiness(
  dependencies: ReadinessDependencies,
): Promise<ReadinessResult> {
  const [database, worker] = await Promise.allSettled([
    dependencies.checkDatabase(),
    dependencies.checkWorker(),
  ]);
  const checks: ReadinessResult["checks"] = {
    database: database.status === "fulfilled" ? "ok" : "error",
    worker: worker.status === "fulfilled" ? "ok" : "error",
  };

  return {
    ready: checks.database === "ok" && checks.worker === "ok",
    checks,
  };
}
