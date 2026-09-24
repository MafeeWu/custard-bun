import type { PgBoss } from "pg-boss";

export const AUTH_EMAIL_QUEUE = "auth-email";
export const AUTH_EMAIL_DEAD_LETTER_QUEUE = "auth-email-dead-letter";

export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(AUTH_EMAIL_DEAD_LETTER_QUEUE);
  await boss.createQueue(AUTH_EMAIL_QUEUE, {
    retryLimit: 5,
    retryBackoff: true,
    retryDelay: 30,
    deadLetter: AUTH_EMAIL_DEAD_LETTER_QUEUE,
  });
}
