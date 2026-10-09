import { seedChatSettings } from "@/server/chat/chat-settings-seed";
import { loadRuntimeConfig } from "@/server/config/runtime-config-core";
import { createDatabase } from "./client";

async function main() {
  const config = await loadRuntimeConfig();
  const database = createDatabase(config.secret.databaseUrl);

  try {
    const result = await seedChatSettings(database, config.public.chat);
    console.log(`Chat settings seeding complete: ${result}`);
  } finally {
    await database.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
