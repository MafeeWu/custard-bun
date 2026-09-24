import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export function createDatabase(
  databaseUrl: string,
  poolConfig: Omit<PoolConfig, "connectionString"> = {},
): NodePgDatabase<typeof schema> & { $client: Pool } {
  const pool = new Pool({ ...poolConfig, connectionString: databaseUrl });

  return drizzle(pool, { schema });
}
