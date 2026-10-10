import { createDatabase } from "../../src/server/db/client";
import { testDatabaseUrl } from "../../src/test/database-target";
import { getDataExportForUser } from "../../src/server/privacy/data-export-service";

async function main() {
  const database = createDatabase(testDatabaseUrl());
  try {
    const exportId = process.argv[2];
    const result = await database.$client.query(
      "SELECT user_id, expires_at FROM data_export_jobs WHERE id = $1",
      [exportId],
    );
    if (!result.rows[0]) throw new Error("Expected completed export fixture");
    await getDataExportForUser(database, {
      userId: result.rows[0].user_id,
      exportId,
      now: new Date(new Date(result.rows[0].expires_at).getTime() + 1),
    });
  } finally {
    await database.$client.end();
  }
}
void main().catch(() => {
  console.error("Export expiry gate failed");
  process.exitCode = 1;
});
