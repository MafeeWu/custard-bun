import type { PgBoss } from "pg-boss";
import { AUTH_EMAIL_QUEUE } from "@/server/jobs/queues";
import type { AuthEmailJob } from "./email-job";

export interface EmailQueue {
  enqueue(job: AuthEmailJob): Promise<string>;
}

export function createEmailQueue(boss: Pick<PgBoss, "send">): EmailQueue {
  return {
    async enqueue(job) {
      const id = await boss.send(AUTH_EMAIL_QUEUE, job);
      if (!id) {
        throw new Error("Authentication email job was not accepted");
      }

      return id;
    },
  };
}
