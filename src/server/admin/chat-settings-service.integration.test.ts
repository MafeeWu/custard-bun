// @vitest-environment node
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  adminAuditEvent,
  chatSettings,
  user,
  userChatQuotaOverride,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import type { AdminActor } from "./admin-actor";
import {
  resetGlobalChatSettings,
  setUserChatQuotaOverride,
  updateGlobalChatSettings,
} from "./chat-settings-service";

const database = createDatabase(testDatabaseUrl());
const actor: AdminActor = {
  userId: "admin-1",
  label: "admin@example.com",
  operationId: "operation-1",
};

beforeEach(async () => {
  await database.execute(sql`
    TRUNCATE TABLE
      admin_audit_events,
      user_chat_quota_overrides,
      chat_settings,
      session,
      account,
      "user"
    RESTART IDENTITY CASCADE
  `);
  await database.insert(user).values([
    {
      id: actor.userId,
      name: "Admin",
      email: actor.label,
      emailVerified: true,
      role: "admin",
    },
    {
      id: "ordinary-1",
      name: "Ordinary",
      email: "ordinary@example.com",
      emailVerified: true,
      role: "user",
    },
    {
      id: "admin-2",
      name: "Admin Two",
      email: "admin2@example.com",
      emailVerified: true,
      role: "admin",
    },
    {
      id: "future-1",
      name: "Future",
      email: "future@example.com",
      emailVerified: true,
      role: "moderator",
    },
  ]);
  await database.insert(chatSettings).values({
    id: "global",
    revision: 3,
    userDailyRequestLimit: 100,
    userDailyTokenLimit: 10_000,
    instanceMonthlyRequestLimit: 1_000,
    instanceMonthlyTokenBudget: 100_000,
    maxConcurrentGenerations: 4,
    deploymentDefaultUserDailyRequestLimit: 50,
    deploymentDefaultUserDailyTokenLimit: 5_000,
    deploymentDefaultInstanceMonthlyRequestLimit: 500,
    deploymentDefaultInstanceMonthlyTokenBudget: 50_000,
    deploymentDefaultMaxConcurrentGenerations: 2,
  });
});

afterAll(async () => {
  await database.$client.end();
});

async function settings() {
  const [row] = await database.select().from(chatSettings);
  return row!;
}

describe("global chat settings", () => {
  test("increments revision and audits flat numeric values", async () => {
    await expect(
      updateGlobalChatSettings(database, actor, {
        expectedRevision: 3,
        userDailyRequestLimit: 120,
        userDailyTokenLimit: 12_000,
        instanceMonthlyRequestLimit: 1_200,
        instanceMonthlyTokenBudget: 120_000,
        maxConcurrentGenerations: 6,
      }),
    ).resolves.toEqual({ revision: 4 });

    expect(await settings()).toMatchObject({
      revision: 4,
      userDailyRequestLimit: 120,
      userDailyTokenLimit: 12_000,
      instanceMonthlyRequestLimit: 1_200,
      instanceMonthlyTokenBudget: 120_000,
      maxConcurrentGenerations: 6,
    });
    const [event] = await database.select().from(adminAuditEvent);
    expect(event).toMatchObject({
      action: "chat.settings.update",
      targetType: "chat_settings",
      targetId: "global",
      metadata: {
        previousRevision: 3,
        nextRevision: 4,
        userDailyRequestLimit: 120,
        userDailyTokenLimit: 12_000,
        instanceMonthlyRequestLimit: 1_200,
        instanceMonthlyTokenBudget: 120_000,
        maxConcurrentGenerations: 6,
      },
    });
    expect(JSON.stringify(event?.metadata)).not.toMatch(
      /message|prompt|provider|secret/i,
    );
  });

  test("rejects stale revisions and invalid limits without mutation", async () => {
    const before = await settings();
    await expect(
      updateGlobalChatSettings(database, actor, {
        expectedRevision: 2,
        userDailyRequestLimit: 10,
        userDailyTokenLimit: 100,
        instanceMonthlyRequestLimit: 100,
        instanceMonthlyTokenBudget: 1_000,
        maxConcurrentGenerations: 1,
      }),
    ).rejects.toMatchObject({ code: "SETTINGS_CONFLICT" });
    await expect(
      updateGlobalChatSettings(database, actor, {
        expectedRevision: 3,
        userDailyRequestLimit: 1_001,
        userDailyTokenLimit: 100,
        instanceMonthlyRequestLimit: 1_000,
        instanceMonthlyTokenBudget: 1_000,
        maxConcurrentGenerations: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SETTINGS" });
    await expect(
      updateGlobalChatSettings(database, actor, {
        expectedRevision: 3,
        userDailyRequestLimit: 1,
        userDailyTokenLimit: 1,
        instanceMonthlyRequestLimit: 1,
        instanceMonthlyTokenBudget: 1,
        maxConcurrentGenerations: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SETTINGS" });

    expect(await settings()).toEqual(before);
    expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
  });

  test("rechecks the administrator inside the transaction", async () => {
    await database
      .update(user)
      .set({ role: "user" })
      .where(eq(user.id, actor.userId));

    await expect(
      updateGlobalChatSettings(database, actor, {
        expectedRevision: 3,
        userDailyRequestLimit: 120,
        userDailyTokenLimit: 12_000,
        instanceMonthlyRequestLimit: 1_200,
        instanceMonthlyTokenBudget: 120_000,
        maxConcurrentGenerations: 6,
      }),
    ).rejects.toThrow("Administrator access required");
    expect((await settings()).revision).toBe(3);
  });

  test("serializes concurrent updates so only one optimistic revision wins", async () => {
    const firstDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "settings-update-first",
      max: 1,
    });
    const secondDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "settings-update-second",
      max: 1,
    });
    try {
      const results = await Promise.allSettled([
        updateGlobalChatSettings(firstDatabase, actor, {
          expectedRevision: 3,
          userDailyRequestLimit: 120,
          userDailyTokenLimit: 12_000,
          instanceMonthlyRequestLimit: 1_200,
          instanceMonthlyTokenBudget: 120_000,
          maxConcurrentGenerations: 5,
        }),
        updateGlobalChatSettings(secondDatabase, actor, {
          expectedRevision: 3,
          userDailyRequestLimit: 130,
          userDailyTokenLimit: 13_000,
          instanceMonthlyRequestLimit: 1_300,
          instanceMonthlyTokenBudget: 130_000,
          maxConcurrentGenerations: 6,
        }),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ code: "SETTINGS_CONFLICT" }),
        }),
      ]);
      expect((await settings()).revision).toBe(4);
      expect(await database.select().from(adminAuditEvent)).toHaveLength(1);
    } finally {
      await firstDatabase.$client.end();
      await secondDatabase.$client.end();
    }
  });

  test("resets to stored deployment defaults with optimistic revision", async () => {
    await expect(
      resetGlobalChatSettings(database, actor, { expectedRevision: 3 }),
    ).resolves.toEqual({
      revision: 4,
      userDailyRequestLimit: 50,
      userDailyTokenLimit: 5_000,
      instanceMonthlyRequestLimit: 500,
      instanceMonthlyTokenBudget: 50_000,
      maxConcurrentGenerations: 2,
    });
    expect(await settings()).toMatchObject({
      revision: 4,
      userDailyRequestLimit: 50,
      userDailyTokenLimit: 5_000,
      instanceMonthlyRequestLimit: 500,
      instanceMonthlyTokenBudget: 50_000,
      maxConcurrentGenerations: 2,
    });
    expect(await database.select().from(adminAuditEvent)).toMatchObject([
      {
        action: "chat.settings.reset",
        metadata: {
          previousRevision: 3,
          nextRevision: 4,
          userDailyRequestLimit: 50,
          userDailyTokenLimit: 5_000,
          instanceMonthlyRequestLimit: 500,
          instanceMonthlyTokenBudget: 50_000,
          maxConcurrentGenerations: 2,
        },
      },
    ]);
  });
});

describe("user chat quota overrides", () => {
  test("stores independently nullable values and clears the row", async () => {
    await setUserChatQuotaOverride(database, actor, {
      userId: "ordinary-1",
      dailyRequestLimit: 25,
      dailyTokenLimit: null,
    });
    expect(await database.select().from(userChatQuotaOverride)).toMatchObject([
      {
        userId: "ordinary-1",
        dailyRequestLimit: 25,
        dailyTokenLimit: null,
        revision: 1,
      },
    ]);
    expect(await database.select().from(adminAuditEvent)).toMatchObject([
      {
        action: "user.chat_quota.update",
        targetId: "ordinary-1",
        metadata: {
          dailyRequestLimit: 25,
          dailyTokenLimit: null,
        },
      },
    ]);

    await setUserChatQuotaOverride(database, actor, {
      userId: "ordinary-1",
      dailyRequestLimit: null,
      dailyTokenLimit: null,
    });
    expect(await database.select().from(userChatQuotaOverride)).toHaveLength(0);
    expect(
      (await database.select().from(adminAuditEvent)).map(
        (event) => event.action,
      ),
    ).toEqual(["user.chat_quota.update", "user.chat_quota.clear"]);
  });

  test.each([
    ["self", actor.userId, "Administrators cannot manage their own account"],
    ["administrator", "admin-2", "Only ordinary users can be managed"],
    ["future role", "future-1", "Only ordinary users can be managed"],
  ])("rejects %s targets", async (_title, userId, message) => {
    await expect(
      setUserChatQuotaOverride(database, actor, {
        userId,
        dailyRequestLimit: 10,
        dailyTokenLimit: 100,
      }),
    ).rejects.toThrow(message);
    expect(await database.select().from(userChatQuotaOverride)).toHaveLength(0);
  });

  test("rejects invalid override limits before mutation", async () => {
    await expect(
      setUserChatQuotaOverride(database, actor, {
        userId: "ordinary-1",
        dailyRequestLimit: 0,
        dailyTokenLimit: 100,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SETTINGS" });
    expect(await database.select().from(userChatQuotaOverride)).toHaveLength(0);
    expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
  });
});
