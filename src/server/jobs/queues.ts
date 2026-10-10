import type { PgBoss } from "pg-boss";

export const AUTH_EMAIL_QUEUE = "auth-email";
export const AUTH_EMAIL_DEAD_LETTER_QUEUE = "auth-email-dead-letter";
export const MEMORY_EXTRACTION_QUEUE = "memory-extraction";
export const MEMORY_EXTRACTION_DEAD_LETTER_QUEUE =
  "memory-extraction-dead-letter";
export const RELATIONSHIP_SUMMARY_QUEUE = "relationship-summary";
export const RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE =
  "relationship-summary-dead-letter";

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
  await boss.createQueue(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE);
  const extractionOptions = {
    retryLimit: 4,
    retryBackoff: true,
    retryDelay: 60,
  };
  await boss.createQueue(MEMORY_EXTRACTION_QUEUE, {
    ...extractionOptions,
    policy: "exclusive",
  });
  // Database execution state owns forwarding; replacement jobs have independent retry clocks.
  await boss.updateQueue(MEMORY_EXTRACTION_QUEUE, {
    ...extractionOptions,
    deadLetter: null,
  });
  await boss.createQueue(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE);
  await boss.createQueue(RELATIONSHIP_SUMMARY_QUEUE, {
    ...extractionOptions,
    policy: "exclusive",
  });
  await boss.updateQueue(RELATIONSHIP_SUMMARY_QUEUE, {
    ...extractionOptions,
    deadLetter: null,
  });
}
