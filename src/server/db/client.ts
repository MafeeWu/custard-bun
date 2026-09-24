import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDatabase(
  databaseUrl: string,
): NodePgDatabase<typeof schema> & { $client: Pool } {
  const pool = new Pool({ connectionString: databaseUrl });

  return drizzle(pool, { schema });
}
