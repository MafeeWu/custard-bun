import { eq } from "drizzle-orm";
import type { MemoryDeploymentConfig } from "@/server/config/schema";
import type { Database } from "@/server/db/client";
import { memorySettings } from "@/server/db/memory-schema";

export async function seedMemorySettings(
  database: Database,
  config: MemoryDeploymentConfig,
): Promise<"created" | "existing"> {
  return database.transaction(async (transaction) => {
    const inserted = await transaction
      .insert(memorySettings)
      .values({
        id: "global",
        enabled: config.enabled,
        deploymentDefaultEnabled: config.enabled,
        revision: 1,
      })
      .onConflictDoNothing({ target: memorySettings.id })
      .returning({ id: memorySettings.id });

    if (inserted.length > 0) {
      return "created";
    }

    await transaction
      .update(memorySettings)
      .set({
        deploymentDefaultEnabled: config.enabled,
        updatedAt: new Date(),
      })
      .where(eq(memorySettings.id, "global"));

    return "existing";
  });
}
