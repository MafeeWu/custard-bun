import { createDatabase } from "../../src/server/db/client";
import { testDatabaseUrl } from "../../src/test/database-target";
import { createBoss } from "../../src/server/jobs/boss";
import { requestDataExport } from "../../src/server/privacy/data-export-service";
import {
  confirmAccountDeletion,
  requestAccountDeletion,
} from "../../src/server/privacy/account-deletion-service";

async function main() {
  const url = testDatabaseUrl();
  const database = createDatabase(url);
  const boss = createBoss(url);
  try {
    await boss.start();
    if (process.argv[2] === "export") {
      const { exportId } = await requestDataExport(database, {
        userId: "phase3-user",
        now: new Date(),
      });
      await boss.send("data-export", { exportId });
      console.log(JSON.stringify({ exportId }));
    } else if (process.argv[2] === "purge") {
      const request = await requestAccountDeletion(database, {
        userId: "phase3-user",
        email: "phase3-fixture@example.com",
        now: new Date(),
      });
      await confirmAccountDeletion(database, {
        token: request.verificationToken,
        now: new Date(),
      });
      await boss.send("account-purge", { requestId: request.requestId });
      console.log(JSON.stringify({ requestId: request.requestId }));
    } else throw new Error("Unknown production job gate");
  } finally {
    await boss.stop({ graceful: true, timeout: 30_000 });
    await database.$client.end();
  }
}
void main().catch(() => {
  console.error("Production processing gate failed");
  process.exitCode = 1;
});
