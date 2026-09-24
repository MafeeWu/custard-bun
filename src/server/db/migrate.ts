import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadDatabaseUrl } from "@/server/config/database-url";
import { createDatabase } from "./client";

async function main() {
  const databaseUrl = loadDatabaseUrl();
  const db = createDatabase(databaseUrl);

  try {
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
