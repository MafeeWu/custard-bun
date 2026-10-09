// @vitest-environment node
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { ChatDeploymentConfig } from "@/server/config/schema";
import { chatSettings } from "@/server/db/chat-schema";
import { createDatabase } from "@/server/db/client";
import { testDatabaseUrl } from "@/test/database-target";
import { seedChatSettings } from "./chat-settings-seed";

const database = createDatabase(testDatabaseUrl());

const deploymentConfig: ChatDeploymentConfig = {
  firstTokenTimeoutMs: 30_000,
  requestTimeoutMs: 120_000,
  promptTokenBudget: 8_192,
  maxInputCharacters: 12_000,
  maxOutputTokens: 1_024,
  defaultUserDailyRequestLimit: 100,
  defaultUserDailyTokenLimit: 100_000,
  defaultInstanceMonthlyRequestLimit: 10_000,
  defaultInstanceMonthlyTokenBudget: 10_000_000,
  maxConcurrentGenerations: 4,
};

const runtimeConfig = {
  public: {
    chat: deploymentConfig,
  },
};

beforeEach(async () => {
  await database.execute(sql`TRUNCATE TABLE chat_settings`);
});

afterAll(async () => {
  await database.$client.end();
});

async function readSettings() {
  const [settings] = await database
    .select()
    .from(chatSettings)
    .where(eq(chatSettings.id, "global"));
  return settings;
}

describe("seedChatSettings", () => {
  test("creates the global singleton from deployment chat defaults", async () => {
    expect(await seedChatSettings(database, runtimeConfig.public.chat)).toBe(
      "created",
    );

    expect(await readSettings()).toMatchObject({
      id: "global",
      revision: 1,
      userDailyRequestLimit: 100,
      userDailyTokenLimit: 100_000,
      instanceMonthlyRequestLimit: 10_000,
      instanceMonthlyTokenBudget: 10_000_000,
      maxConcurrentGenerations: 4,
      deploymentDefaultUserDailyRequestLimit: 100,
      deploymentDefaultUserDailyTokenLimit: 100_000,
      deploymentDefaultInstanceMonthlyRequestLimit: 10_000,
      deploymentDefaultInstanceMonthlyTokenBudget: 10_000_000,
      deploymentDefaultMaxConcurrentGenerations: 4,
    });
  });

  test("returns existing and preserves administrator values on repeated deployment", async () => {
    expect(await seedChatSettings(database, runtimeConfig.public.chat)).toBe(
      "created",
    );
    await database
      .update(chatSettings)
      .set({ userDailyRequestLimit: 7 })
      .where(eq(chatSettings.id, "global"));

    expect(await seedChatSettings(database, runtimeConfig.public.chat)).toBe(
      "existing",
    );
    expect(await readSettings()).toMatchObject({
      revision: 1,
      userDailyRequestLimit: 7,
      userDailyTokenLimit: 100_000,
      instanceMonthlyRequestLimit: 10_000,
      instanceMonthlyTokenBudget: 10_000_000,
      maxConcurrentGenerations: 4,
    });
  });

  test("refreshes stored deployment defaults without replacing operational values", async () => {
    await seedChatSettings(database, runtimeConfig.public.chat);
    await database
      .update(chatSettings)
      .set({
        userDailyRequestLimit: 7,
        maxConcurrentGenerations: 2,
      })
      .where(eq(chatSettings.id, "global"));

    expect(
      await seedChatSettings(database, {
        ...runtimeConfig.public.chat,
        defaultUserDailyRequestLimit: 250,
        maxConcurrentGenerations: 8,
      }),
    ).toBe("existing");

    expect(await readSettings()).toMatchObject({
      revision: 1,
      userDailyRequestLimit: 7,
      maxConcurrentGenerations: 2,
      deploymentDefaultUserDailyRequestLimit: 250,
      deploymentDefaultMaxConcurrentGenerations: 8,
    });
  });
});
