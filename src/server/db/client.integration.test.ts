// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Client, escapeIdentifier } from "pg";
import { expect, test } from "vitest";
import { createBoss } from "../jobs/boss";
import { buildPostgresUrl } from "../config/postgres-url";
import { createDatabase } from "./client";
import { testDatabaseUrl } from "@/test/database-target";

const adminUrl = testDatabaseUrl();

test("pg and pg-boss connect to a temporary delimiter-rich database name", async () => {
  const admin = new Client({ connectionString: adminUrl });
  const databaseName = `companion /?#@ %2F $ ${randomUUID()}_test`;
  const databaseUrl = buildPostgresUrl({
    username: "companion",
    password: "companion",
    host: "127.0.0.1",
    port: 55432,
    database: databaseName,
  });
  let database: ReturnType<typeof createDatabase> | undefined;
  let boss: ReturnType<typeof createBoss> | undefined;

  await admin.connect();
  await admin.query(`CREATE DATABASE ${escapeIdentifier(databaseName)}`);

  try {
    database = createDatabase(databaseUrl);
    const result = await database.$client.query<{
      current_database: string;
    }>("select current_database()");
    expect(result.rows[0]?.current_database).toBe(databaseName);

    boss = createBoss(databaseUrl);
    await boss.start();
    expect(await boss.schemaVersion()).toEqual(expect.any(Number));
  } finally {
    if (boss) {
      await boss.stop({ graceful: false });
    }
    if (database) {
      await database.$client.end();
    }
    await admin.query(`DROP DATABASE ${escapeIdentifier(databaseName)}`);
    await admin.end();
  }
});
