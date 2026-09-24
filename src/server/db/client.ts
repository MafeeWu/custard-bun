import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export interface DatabaseClient {
  db: ReturnType<typeof drizzle<typeof schema>>;
  pool: Pool;
}

export function createDatabase(databaseUrl: string): DatabaseClient {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}
