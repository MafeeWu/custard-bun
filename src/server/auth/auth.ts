import { getRuntimeConfig } from "@/server/config/load-config";
import { createDatabase } from "@/server/db/client";
import { createEmailQueue } from "@/server/email/email-queue";
import { getBoss, resetBoss } from "@/server/jobs/boss";
import { ensureQueues } from "@/server/jobs/queues";
import { createAuth } from "./create-auth";

async function initializeAuth() {
  const config = await getRuntimeConfig();
  const database = createDatabase(config.secret.databaseUrl);
  let boss: Awaited<ReturnType<typeof getBoss>> | undefined;

  try {
    boss = await getBoss(config.secret.databaseUrl);
    await ensureQueues(boss);

    return createAuth({
      database,
      config,
      emailQueue: createEmailQueue(boss),
    });
  } catch (error: unknown) {
    await Promise.allSettled([
      database.$client.end(),
      ...(boss ? [resetBoss(boss)] : []),
    ]);
    throw error;
  }
}

let authPromise: ReturnType<typeof initializeAuth> | undefined;

export function getAuth(): ReturnType<typeof initializeAuth> {
  if (!authPromise) {
    const pending = initializeAuth();
    authPromise = pending;
    void pending.catch(() => {
      if (authPromise === pending) {
        authPromise = undefined;
      }
    });
  }
  return authPromise;
}
