import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { parsePostgresConfig } from "../config/postgres-config";
import * as schema from "./schema";

export function createDatabase(
  databaseUrl: string,
  poolConfig: Omit<PoolConfig, "connectionString"> = {},
): NodePgDatabase<typeof schema> & { $client: Pool } {
  const pool = new Pool({
    ...parsePostgresConfig(databaseUrl),
    ...poolConfig,
  });

  return drizzle(pool, { schema });
}
