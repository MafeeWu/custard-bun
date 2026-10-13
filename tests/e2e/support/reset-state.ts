import { eq, sql } from "drizzle-orm";
import { rateLimit } from "../../../src/server/db/auth-schema";
import {
  chatSettings,
  quotaBucket,
  quotaReservation,
} from "../../../src/server/db/chat-schema";
import { createAdminTestDatabase } from "./admin";
import { e2eEnvironment } from "./environment";

async function main() {
  const database = createAdminTestDatabase(e2eEnvironment.TEST_DATABASE_URL!);
  try {
    await database.transaction(async (transaction) => {
      await transaction.delete(quotaReservation);
      await transaction.delete(quotaBucket);
      await transaction.delete(rateLimit);
      await transaction
        .update(chatSettings)
        .set({
          revision: sql`${chatSettings.revision} + 1`,
          userDailyRequestLimit: sql`${chatSettings.deploymentDefaultUserDailyRequestLimit}`,
          userDailyTokenLimit: sql`${chatSettings.deploymentDefaultUserDailyTokenLimit}`,
          instanceMonthlyRequestLimit: sql`${chatSettings.deploymentDefaultInstanceMonthlyRequestLimit}`,
          instanceMonthlyTokenBudget: sql`${chatSettings.deploymentDefaultInstanceMonthlyTokenBudget}`,
          maxConcurrentGenerations: sql`${chatSettings.deploymentDefaultMaxConcurrentGenerations}`,
          updatedAt: new Date(),
        })
        .where(eq(chatSettings.id, "global"));
    });
  } finally {
    await database.$client.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
