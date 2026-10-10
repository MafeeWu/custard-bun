// @vitest-environment node
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { chatSettings, memorySettings } from "@/server/db/schema";
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
  test("fails before the user lock when memory settings appear between nested calls", async () => {
    await database.delete(memorySettings);
    const applicationName = "chat-missing-memory-settings";
    const lockingDatabase = createDatabase(testDatabaseUrl(), {
      application_name: applicationName,
      max: 1,
    });
    const creatorDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "memory-settings-late-creator",
      max: 1,
    });
    const firstAttemptFinished = deferred();
    const continueNestedCall = deferred();
    const nestedCallAcquired = deferred();
    const release = deferred();
    let firstError: unknown;
    let lockOperation: Promise<void> | undefined;

    try {
      lockOperation = lockingDatabase.transaction(async (transaction) => {
        try {
          await lockUserChatMutation(transaction, "late-settings-user");
        } catch (error) {
          firstError = error;
        }
        firstAttemptFinished.resolve();
        await continueNestedCall.promise;
        await lockUserChatMutation(transaction, "late-settings-user");
        nestedCallAcquired.resolve();
        await release.promise;
      });
      void lockOperation.catch(() => undefined);
      await firstAttemptFinished.promise;

      const advisoryBeforeCreation = await database.$client.query<{
        count: string;
      }>(
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

      await creatorDatabase.insert(memorySettings).values({
        id: "global",
        enabled: true,
        deploymentDefaultEnabled: true,
      });
      continueNestedCall.resolve();
      await nestedCallAcquired.promise;

      expect(firstError).toMatchObject({
        code: "CHAT_INTERNAL",
        message: "Memory settings are not initialized.",
      });
      expect(advisoryBeforeCreation.rows[0]?.count).toBe("0");
    } finally {
      continueNestedCall.resolve();
      release.resolve();
      await Promise.allSettled(lockOperation ? [lockOperation] : []);
      await lockingDatabase.$client.end();
      await creatorDatabase.$client.end();
    }
  });

  test("does not revisit global settings after a nested helper owns the user lock", async () => {
    await database.transaction(async (transaction) => {
      let selectCount = 0;
      const trackedTransaction = new Proxy(transaction, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (property === "select") {
            return (...args: unknown[]) => {
              selectCount += 1;
              return Reflect.apply(
                value as (...callArgs: unknown[]) => unknown,
                target,
                args,
              );
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      await lockUserChatMutation(trackedTransaction, "nested-lock-user");
      const selectsAfterFirstCall = selectCount;
      await lockUserChatMutation(trackedTransaction, "nested-lock-user");

      expect(selectCount).toBe(selectsAfterFirstCall);
    });
  });

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

      const advisoryWhileSettingsBlocked = await database.$client.query<{
        count: string;
      }>(
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

      const advisoryWhileMemoryBlocked = await database.$client.query<{
        count: string;
      }>(
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

      const advisoryAfterSettings = await database.$client.query<{
        count: string;
      }>(
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

      const advisoryAfterCommit = await database.$client.query<{
        count: string;
      }>(
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

  test("the chat helper waits on the canonical user advisory lock rather than a settings row", async () => {
    const memoryDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "memory-shared-user-lock-holder",
      max: 1,
    });
    const chatDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "chat-shared-user-lock-waiter",
      max: 1,
    });
    const chatAcquired = deferred();
    let chatOperation: Promise<void> | undefined;

    try {
      await memoryDatabase.$client.query("BEGIN");
      await memoryDatabase.$client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        ["chat-user:shared-user"],
      );

      chatOperation = chatDatabase.transaction(async (transaction) => {
        await lockUserChatMutation(transaction, "shared-user");
        chatAcquired.resolve();
      });
      void chatOperation.catch(() => undefined);

      await expect
        .poll(async () => {
          const result = await database.$client.query<{
            blocker_name: string;
            blocker_granted: boolean;
            query: string;
            waiter_granted: boolean;
            wait_event_type: string | null;
          }>(
            `
              SELECT
                blocker.application_name AS blocker_name,
                blocker_lock.granted AS blocker_granted,
                waiter.query,
                waiter_lock.granted AS waiter_granted,
                waiter.wait_event_type
              FROM pg_stat_activity waiter
              JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) blocker_pid
                ON true
              JOIN pg_stat_activity blocker ON blocker.pid = blocker_pid
              JOIN pg_locks waiter_lock
                ON waiter_lock.pid = waiter.pid
               AND waiter_lock.locktype = 'advisory'
               AND NOT waiter_lock.granted
              JOIN pg_locks blocker_lock
                ON blocker_lock.pid = blocker.pid
               AND blocker_lock.locktype = 'advisory'
               AND blocker_lock.granted
               AND blocker_lock.classid = waiter_lock.classid
               AND blocker_lock.objid = waiter_lock.objid
               AND blocker_lock.objsubid = waiter_lock.objsubid
              WHERE waiter.application_name = 'chat-shared-user-lock-waiter'
            `,
          );
          return result.rows[0] ?? null;
        })
        .toMatchObject({
          blocker_name: "memory-shared-user-lock-holder",
          blocker_granted: true,
          query: expect.stringContaining("pg_advisory_xact_lock"),
          waiter_granted: false,
          wait_event_type: "Lock",
        });

      await memoryDatabase.$client.query("COMMIT");
      await chatAcquired.promise;
      await expect(chatOperation).resolves.toBeUndefined();
    } finally {
      await memoryDatabase.$client.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled(chatOperation ? [chatOperation] : []);
      await memoryDatabase.$client.end();
      await chatDatabase.$client.end();
    }
  });
});
