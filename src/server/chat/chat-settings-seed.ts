import { eq } from "drizzle-orm";
import type { ChatDeploymentConfig } from "@/server/config/schema";
import { chatSettings } from "@/server/db/chat-schema";
import type { Database } from "@/server/db/client";

function operationalValues(config: ChatDeploymentConfig) {
  return {
    userDailyRequestLimit: config.defaultUserDailyRequestLimit,
    userDailyTokenLimit: config.defaultUserDailyTokenLimit,
    instanceMonthlyRequestLimit: config.defaultInstanceMonthlyRequestLimit,
    instanceMonthlyTokenBudget: config.defaultInstanceMonthlyTokenBudget,
    maxConcurrentGenerations: config.maxConcurrentGenerations,
  };
}

function deploymentDefaultValues(config: ChatDeploymentConfig) {
  return {
    deploymentDefaultUserDailyRequestLimit: config.defaultUserDailyRequestLimit,
    deploymentDefaultUserDailyTokenLimit: config.defaultUserDailyTokenLimit,
    deploymentDefaultInstanceMonthlyRequestLimit:
      config.defaultInstanceMonthlyRequestLimit,
    deploymentDefaultInstanceMonthlyTokenBudget:
      config.defaultInstanceMonthlyTokenBudget,
    deploymentDefaultMaxConcurrentGenerations: config.maxConcurrentGenerations,
  };
}

export async function seedChatSettings(
  database: Database,
  config: ChatDeploymentConfig,
): Promise<"created" | "existing"> {
  return database.transaction(async (transaction) => {
    const inserted = await transaction
      .insert(chatSettings)
      .values({
        id: "global",
        revision: 1,
        ...operationalValues(config),
        ...deploymentDefaultValues(config),
      })
      .onConflictDoNothing({ target: chatSettings.id })
      .returning({ id: chatSettings.id });

    if (inserted.length > 0) {
      return "created";
    }

    await transaction
      .update(chatSettings)
      .set({
        ...deploymentDefaultValues(config),
        deploymentDefaultsUpdatedAt: new Date(),
      })
      .where(eq(chatSettings.id, "global"));

    return "existing";
  });
}
