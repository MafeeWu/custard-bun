// @vitest-environment node
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { MemoryDeploymentConfig } from "@/server/config/schema";
import { createDatabase } from "@/server/db/client";
import { memorySettings } from "@/server/db/memory-schema";
import { testDatabaseUrl } from "@/test/database-target";
import { seedMemorySettings } from "./memory-settings-seed";

const database = createDatabase(testDatabaseUrl());

const deploymentConfig: MemoryDeploymentConfig = {
  enabled: true,
  promptTokenBudget: 2_048,
  relationshipSummaryTokenBudget: 512,
  memoryItemsTokenBudget: 1_536,
  maxActiveItemsPerCharacter: 200,
  maxItemCharacters: 500,
  maxSummaryCharacters: 4_000,
  extractionRetryLimit: 5,
  extractionRetryDelaySeconds: 60,
  exportRetentionHours: 24,
  maxExportArchiveBytes: 262_144_000,
};

beforeEach(async () => {
  await database.execute(sql`TRUNCATE TABLE memory_settings`);
});

afterAll(async () => {
  await database.$client.end();
});

async function readSettings() {
  const [settings] = await database
    .select()
    .from(memorySettings)
    .where(eq(memorySettings.id, "global"));
  return settings;
}

describe("seedMemorySettings", () => {
  test("creates the global singleton from the deployment default", async () => {
    expect(await seedMemorySettings(database, deploymentConfig)).toBe(
      "created",
    );

    expect(await readSettings()).toMatchObject({
      id: "global",
      enabled: true,
      deploymentDefaultEnabled: true,
      revision: 1,
    });
  });

  test("preserves administrator operational values and revision on repeated deploys", async () => {
    await seedMemorySettings(database, deploymentConfig);
    await database
      .update(memorySettings)
      .set({ enabled: false, revision: 4 })
      .where(eq(memorySettings.id, "global"));

    expect(await seedMemorySettings(database, deploymentConfig)).toBe(
      "existing",
    );
    expect(await readSettings()).toMatchObject({
      enabled: false,
      deploymentDefaultEnabled: true,
      revision: 4,
    });
  });

  test("refreshes the stored deployment default without replacing the administrator value", async () => {
    await seedMemorySettings(database, deploymentConfig);
    await database
      .update(memorySettings)
      .set({ enabled: true, revision: 3 })
      .where(eq(memorySettings.id, "global"));

    expect(
      await seedMemorySettings(database, {
        ...deploymentConfig,
        enabled: false,
      }),
    ).toBe("existing");
    expect(await readSettings()).toMatchObject({
      enabled: true,
      deploymentDefaultEnabled: false,
      revision: 3,
    });
  });
});
