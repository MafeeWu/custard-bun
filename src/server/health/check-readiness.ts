export interface ReadinessDependencies {
  checkDatabase(): Promise<void>;
  checkWorker(): Promise<void>;
  checkModelConfiguration(): Promise<void>;
}

export interface ReadinessResult {
  ready: boolean;
  checks: {
    database: "ok" | "error";
    worker: "ok" | "error";
    modelConfiguration: "ok" | "error";
  };
}

export async function checkReadiness(
  dependencies: ReadinessDependencies,
): Promise<ReadinessResult> {
  const [database, worker, modelConfiguration] = await Promise.allSettled([
    dependencies.checkDatabase(),
    dependencies.checkWorker(),
    dependencies.checkModelConfiguration(),
  ]);
  const checks: ReadinessResult["checks"] = {
    database: database.status === "fulfilled" ? "ok" : "error",
    worker: worker.status === "fulfilled" ? "ok" : "error",
    modelConfiguration:
      modelConfiguration.status === "fulfilled" ? "ok" : "error",
  };

  return {
    ready:
      checks.database === "ok" &&
      checks.worker === "ok" &&
      checks.modelConfiguration === "ok",
    checks,
  };
}
