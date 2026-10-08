import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { parsePostgresConfig } from "../config/postgres-config";
import * as schema from "./schema";
import { safeErrorName, type SafeLogger } from "../logging/safe-error";

export function createDatabase(
  databaseUrl: string,
  poolConfig: Omit<PoolConfig, "connectionString"> = {},
  logger: SafeLogger = console,
): NodePgDatabase<typeof schema> & { $client: Pool } {
  const pool = new Pool({
    ...parsePostgresConfig(databaseUrl),
    ...poolConfig,
  });
  pool.on("error", (error: unknown) => {
    if (!pool.ending) {
      logger.error("database idle connection failed", {
        name: safeErrorName(error),
      });
    }
  });

  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDatabase>;
