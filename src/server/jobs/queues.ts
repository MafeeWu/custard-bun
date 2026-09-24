import type { PgBoss } from "pg-boss";

export const AUTH_EMAIL_QUEUE = "auth-email";
export const AUTH_EMAIL_DEAD_LETTER_QUEUE = "auth-email-dead-letter";

interface EnsureQueuesOptions {
  authEmailRetryDelay?: number;
}

export async function ensureQueues(
  boss: PgBoss,
  options: EnsureQueuesOptions = {},
): Promise<void> {
  const authEmailRetryDelay = options.authEmailRetryDelay ?? 30;

  await boss.createQueue(AUTH_EMAIL_DEAD_LETTER_QUEUE);
  await boss.createQueue(AUTH_EMAIL_QUEUE, {
    retryLimit: 5,
    retryBackoff: true,
    retryDelay: authEmailRetryDelay,
    deadLetter: AUTH_EMAIL_DEAD_LETTER_QUEUE,
  });
  await boss.updateQueue(AUTH_EMAIL_QUEUE, {
    retryLimit: 5,
    retryBackoff: true,
    retryDelay: authEmailRetryDelay,
    deadLetter: AUTH_EMAIL_DEAD_LETTER_QUEUE,
  });
}
