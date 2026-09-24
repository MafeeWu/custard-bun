import { loadRuntimeConfig } from "@/server/config/runtime-config-core";
import { createDatabase } from "@/server/db/client";
import type { EmailQueue } from "@/server/email/email-queue";
import { createAuth } from "./create-auth";

const config = await loadRuntimeConfig();
const database = createDatabase(config.secret.databaseUrl);

const schemaOnlyEmailQueue: EmailQueue = {
  async enqueue() {
    return "schema-generation";
  },
};

export const auth = createAuth({
  database,
  config,
  emailQueue: schemaOnlyEmailQueue,
});
