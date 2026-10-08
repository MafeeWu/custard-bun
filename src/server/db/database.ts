import { getRuntimeConfig } from "@/server/config/load-config";
import { createDatabase, type Database } from "./client";

async function initializeDatabase(): Promise<Database> {
  const config = await getRuntimeConfig();
  return createDatabase(config.secret.databaseUrl);
}

let databasePromise: Promise<Database> | undefined;

export function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    const pending = initializeDatabase();
    databasePromise = pending;
    void pending.catch(() => {
      if (databasePromise === pending) {
        databasePromise = undefined;
      }
    });
  }

  return databasePromise;
}

export async function resetDatabaseForTests(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("resetDatabaseForTests is only available in tests");
  }

  const pending = databasePromise;
  databasePromise = undefined;

  if (!pending) {
    return;
  }

  const database = await pending.catch(() => undefined);
  await database?.$client.end();
}
