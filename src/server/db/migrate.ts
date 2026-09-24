import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadRuntimeConfig } from "@/server/config/load-config";
import { createDatabase } from "./client";

async function main() {
  const config = await loadRuntimeConfig();
  const { db, pool } = createDatabase(config.secret.databaseUrl);

  try {
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
