import { loadDatabaseUrl } from "@/server/config/database-url";
import { seedOfficialCharacters } from "@/server/characters/seed-characters";
import { createDatabase } from "./client";

async function main() {
  const databaseUrl = loadDatabaseUrl();
  const database = createDatabase(databaseUrl);

  try {
    const result = await seedOfficialCharacters(database);
    console.log(
      `Official character seeding complete: created ${result.created}, existing ${result.existing}`,
    );
  } finally {
    await database.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
