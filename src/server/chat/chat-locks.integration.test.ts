// @vitest-environment node
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { chatSettings, memorySettings } from "@/server/db/schema";
import { lockUserMemoryMutation } from "@/server/memory/memory-locks";
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
  await database.execute(sql`TRUNCATE TABLE chat_settings, memory_settings`);
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
  await database.insert(memorySettings).values({
    id: "global",
    enabled: true,
    deploymentDefaultEnabled: true,
  });
});

afterAll(async () => {
  await database.$client.end();
});

describe("lockUserChatMutation", () => {
  test("locks chat settings then memory settings before taking the user advisory lock", async () => {
    const chatBlocker = await database.$client.connect();
    const memoryBlocker = await database.$client.connect();
    const applicationName = "chat-lock-order-test";
    const lockingDatabase = createDatabase(testDatabaseUrl(), {
      application_name: applicationName,
      max: 1,
    });
    const acquired = deferred();
    const release = deferred();
    let lockOperation: Promise<void> | undefined;

    try {
      await chatBlocker.query("BEGIN");
      await chatBlocker.query(
        "SELECT id FROM chat_settings WHERE id = 'global' FOR UPDATE",
      );
      await memoryBlocker.query("BEGIN");
      await memoryBlocker.query(
        "SELECT id FROM memory_settings WHERE id = 'global' FOR UPDATE",
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

      await chatBlocker.query("COMMIT");
      await expect
        .poll(
          async () => {
            const result = await database.$client.query<{
              query: string;
              wait_event_type: string | null;
            }>(
              `
                SELECT query, wait_event_type
                FROM pg_stat_activity
                WHERE application_name = $1
                  AND state = 'active'
              `,
              [applicationName],
            );
            return result.rows.some(
              (row) =>
                row.wait_event_type === "Lock" &&
                row.query.includes('"memory_settings"'),
            );
          },
          { timeout: 2_000 },
        )
        .toBe(true);

      const advisoryWhileMemoryBlocked =
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
      expect(advisoryWhileMemoryBlocked.rows[0]?.count).toBe("0");

      await memoryBlocker.query("COMMIT");
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
      await chatBlocker.query("ROLLBACK").catch(() => undefined);
      await memoryBlocker.query("ROLLBACK").catch(() => undefined);
      chatBlocker.release();
      memoryBlocker.release();
      await Promise.allSettled(lockOperation ? [lockOperation] : []);
      await lockingDatabase.$client.end();
    }
  });

  test("chat and memory mutation helpers serialize on the same observed user lock without deadlock", async () => {
    const memoryDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "memory-shared-user-lock-holder",
      max: 1,
    });
    const chatDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "chat-shared-user-lock-waiter",
      max: 1,
    });
    const memoryAcquired = deferred();
    const releaseMemory = deferred();
    const chatAcquired = deferred();
    let memoryOperation: Promise<void> | undefined;
    let chatOperation: Promise<void> | undefined;

    try {
      memoryOperation = memoryDatabase.transaction(async (transaction) => {
        await lockUserMemoryMutation(transaction, "shared-user");
        memoryAcquired.resolve();
        await releaseMemory.promise;
      });
      void memoryOperation.catch(() => undefined);
      await memoryAcquired.promise;

      chatOperation = chatDatabase.transaction(async (transaction) => {
        await lockUserChatMutation(transaction, "shared-user");
        chatAcquired.resolve();
      });
      void chatOperation.catch(() => undefined);

      await expect
        .poll(async () => {
          const result = await database.$client.query<{
            wait_event_type: string | null;
          }>(
            `
              SELECT wait_event_type
              FROM pg_stat_activity
              WHERE application_name = 'chat-shared-user-lock-waiter'
                AND state = 'active'
            `,
          );
          return result.rows.some((row) => row.wait_event_type === "Lock");
        })
        .toBe(true);

      releaseMemory.resolve();
      await chatAcquired.promise;
      await expect(
        Promise.all([memoryOperation, chatOperation]),
      ).resolves.toEqual([undefined, undefined]);
    } finally {
      releaseMemory.resolve();
      await Promise.allSettled(
        [memoryOperation, chatOperation].filter(
          (operation): operation is Promise<void> => Boolean(operation),
        ),
      );
      await memoryDatabase.$client.end();
      await chatDatabase.$client.end();
    }
  });
});
