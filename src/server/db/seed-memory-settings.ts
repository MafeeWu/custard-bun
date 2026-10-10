import { loadRuntimeConfig } from "@/server/config/runtime-config-core";
import { seedMemorySettings } from "@/server/memory/memory-settings-seed";
import { createDatabase } from "./client";

async function main() {
  const config = await loadRuntimeConfig();
  const database = createDatabase(config.secret.databaseUrl);

  try {
    const result = await seedMemorySettings(database, config.public.memory);
    console.log(`Memory settings seeding complete: ${result}`);
  } finally {
    await database.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
