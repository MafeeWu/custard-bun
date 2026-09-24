import { getRuntimeConfig } from "@/server/config/load-config";
import { createDatabase } from "@/server/db/client";
import { createEmailQueue } from "@/server/email/email-queue";
import { getBoss } from "@/server/jobs/boss";
import { ensureQueues } from "@/server/jobs/queues";
import { createAuth } from "./create-auth";

const config = await getRuntimeConfig();
const database = createDatabase(config.secret.databaseUrl);
const boss = await getBoss(config.secret.databaseUrl);
await ensureQueues(boss);

export const auth = createAuth({
  database,
  config,
  emailQueue: createEmailQueue(boss),
});
