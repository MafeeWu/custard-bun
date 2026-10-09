// @vitest-environment node
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { chatSettings } from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import { lockUserChatMutation } from "./chat-locks";

const database = createDatabase(testDatabaseUrl());

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  await database.execute(sql`TRUNCATE TABLE chat_settings`);
  await database.insert(chatSettings).values({
    id: "global",
    userDailyRequestLimit: 10,
    userDailyTokenLimit: 10_000,
    instanceMonthlyRequestLimit: 100,
    instanceMonthlyTokenBudget: 100_000,
    maxConcurrentGenerations: 2,
    deploymentDefaultUserDailyRequestLimit: 10,
    deploymentDefaultUserDailyTokenLimit: 10_000,
    deploymentDefaultInstanceMonthlyRequestLimit: 100,
    deploymentDefaultInstanceMonthlyTokenBudget: 100_000,
    deploymentDefaultMaxConcurrentGenerations: 2,
  });
});

afterAll(async () => {
  await database.$client.end();
});

describe("lockUserChatMutation", () => {
  test("locks chat settings before taking a transaction-scoped user advisory lock", async () => {
    const blocker = await database.$client.connect();
    const applicationName = "chat-lock-order-test";
    const lockingDatabase = createDatabase(testDatabaseUrl(), {
      application_name: applicationName,
      max: 1,
    });
    const acquired = deferred();
    const release = deferred();
    let lockOperation: Promise<void> | undefined;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM chat_settings WHERE id = 'global' FOR UPDATE",
      );

      lockOperation = lockingDatabase.transaction(async (transaction) => {
        await lockUserChatMutation(transaction, "user-lock-order");
        acquired.resolve();
        await release.promise;
      });
      void lockOperation.catch(() => undefined);

      await expect
        .poll(
          async () => {
            const result = await database.$client.query<{
              wait_event_type: string | null;
            }>(
              `
                SELECT wait_event_type
                FROM pg_stat_activity
                WHERE application_name = $1
                  AND state = 'active'
              `,
              [applicationName],
            );
            return result.rows.some((row) => row.wait_event_type === "Lock");
          },
          { timeout: 2_000 },
        )
        .toBe(true);

      const advisoryWhileSettingsBlocked =
        await database.$client.query<{ count: string }>(
          `
            SELECT COUNT(*)::text AS count
            FROM pg_locks l
            JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE a.application_name = $1
              AND l.locktype = 'advisory'
              AND l.granted
          `,
          [applicationName],
        );
      expect(advisoryWhileSettingsBlocked.rows[0]?.count).toBe("0");

      await blocker.query("COMMIT");
      await acquired.promise;

      const advisoryAfterSettings =
        await database.$client.query<{ count: string }>(
          `
            SELECT COUNT(*)::text AS count
            FROM pg_locks l
            JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE a.application_name = $1
              AND l.locktype = 'advisory'
              AND l.granted
          `,
          [applicationName],
        );
      expect(advisoryAfterSettings.rows[0]?.count).toBe("1");

      release.resolve();
      await lockOperation;

      const advisoryAfterCommit =
        await database.$client.query<{ count: string }>(
          `
            SELECT COUNT(*)::text AS count
            FROM pg_locks l
            JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE a.application_name = $1
              AND l.locktype = 'advisory'
              AND l.granted
          `,
          [applicationName],
        );
      expect(advisoryAfterCommit.rows[0]?.count).toBe("0");
    } finally {
      release.resolve();
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.allSettled(lockOperation ? [lockOperation] : []);
      await lockingDatabase.$client.end();
    }
  });
});
