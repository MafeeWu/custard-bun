// @vitest-environment node
import { afterAll, beforeAll, expect, test } from "vitest";
import type { PgBoss } from "pg-boss";
import { createBoss } from "./boss";
import {
  AUTH_EMAIL_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
  MEMORY_EXTRACTION_DEAD_LETTER_QUEUE,
  ensureQueues,
} from "./queues";
import { testDatabaseUrl } from "@/test/database-target";

const databaseUrl = testDatabaseUrl();
let boss: PgBoss;

beforeAll(async () => {
  boss = createBoss(databaseUrl);
  await boss.start();
  await ensureQueues(boss);
});

afterAll(async () => {
  await boss.deleteAllJobs(AUTH_EMAIL_QUEUE);
  await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
  await boss.deleteAllJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE);
  await boss.stop({ graceful: false });
});

test("extraction queue has five total executions, 60-second exponential backoff and an additive dead letter queue", async () => {
  expect(await boss.getQueue(MEMORY_EXTRACTION_QUEUE)).toMatchObject({
    retryLimit: 4,
    retryDelay: 60,
    retryBackoff: true,
  });
  expect((await boss.getQueue(MEMORY_EXTRACTION_QUEUE))?.deadLetter).toBeNull();
  expect(
    await boss.getQueue(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE),
  ).not.toBeNull();
  expect(await boss.getQueue(AUTH_EMAIL_QUEUE)).toMatchObject({
    retryLimit: 5,
    retryDelay: 30,
  });
  const runId = crypto.randomUUID();
  const first = await boss.send(
    MEMORY_EXTRACTION_QUEUE,
    { runId },
    { singletonKey: runId },
  );
  const duplicate = await boss.send(
    MEMORY_EXTRACTION_QUEUE,
    { runId },
    { singletonKey: runId },
  );
  expect(first).toEqual(expect.any(String));
  expect(duplicate).toBeNull();
});

test("persists an authentication email job", async () => {
  const id = await boss.send(AUTH_EMAIL_QUEUE, {
    kind: "verify-email",
    to: "person@example.com",
    actionUrl: "https://example.com/verify",
  });

  expect(id).toEqual(expect.any(String));
});
