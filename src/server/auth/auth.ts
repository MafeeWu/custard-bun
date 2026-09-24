import { getRuntimeConfig } from "@/server/config/load-config";
import { createDatabase } from "@/server/db/client";
import { createEmailQueue } from "@/server/email/email-queue";
import { getBoss } from "@/server/jobs/boss";
import { ensureQueues } from "@/server/jobs/queues";
import { createAuth } from "./create-auth";

async function initializeAuth() {
  const config = await getRuntimeConfig();
  const database = createDatabase(config.secret.databaseUrl);
  const boss = await getBoss(config.secret.databaseUrl);
  await ensureQueues(boss);

  return createAuth({
    database,
    config,
    emailQueue: createEmailQueue(boss),
  });
}

let authPromise: ReturnType<typeof initializeAuth> | undefined;

export function getAuth(): ReturnType<typeof initializeAuth> {
  authPromise ??= initializeAuth();
  return authPromise;
}
