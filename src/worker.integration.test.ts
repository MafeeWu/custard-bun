// @vitest-environment node
import { afterAll, beforeAll, expect, test } from "vitest";
import type { PgBoss } from "pg-boss";
import { createBoss } from "@/server/jobs/boss";
import { AUTH_EMAIL_QUEUE, ensureQueues } from "@/server/jobs/queues";

const databaseUrl = "postgresql://companion:companion@127.0.0.1:55432/companion_test";
let boss: PgBoss;

beforeAll(async () => {
  boss = createBoss(databaseUrl);
  await boss.start();
  await ensureQueues(boss, { authEmailRetryDelay: 60 });
});

afterAll(async () => {
  await boss.stop({ graceful: false });
});

test("retains an SMTP failure for retry on the production queue", async () => {
  const queue = await boss.getQueue(AUTH_EMAIL_QUEUE);

  expect(queue?.name).toBe(AUTH_EMAIL_QUEUE);
  expect(queue?.retryLimit).toBe(5);
  expect(queue?.retryDelay).toBe(60);
  expect(queue?.retryBackoff).toBe(true);
  expect(queue?.deadLetter).toBe("auth-email-dead-letter");

  const id = await boss.send(AUTH_EMAIL_QUEUE, { to: "person@example.com" });
  if (!id) {
    throw new Error("retry test job was not accepted");
  }

  let attempts = 0;
  await boss.work(AUTH_EMAIL_QUEUE, async () => {
    attempts += 1;
    throw new Error("temporary SMTP failure");
  });

  await expect.poll(() => attempts, { timeout: 5_000 }).toBe(1);
  await expect
    .poll(async () => (await boss.getJobById(AUTH_EMAIL_QUEUE, id))?.state, {
      timeout: 5_000,
    })
    .toBe("retry");

  const job = await boss.getJobById(AUTH_EMAIL_QUEUE, id);
  // pg-boss 12.33.6 reports retryCount as 0 immediately after the first failure;
  // the durable signal for "will retry" is the retry state plus persisted output.
  expect(job?.retryCount).toBe(0);
  expect(job?.output).toEqual(
    expect.objectContaining({ message: "temporary SMTP failure" }),
  );
  expect(job?.startedOn).toBeTruthy();
  expect(job?.state).toBe("retry");
});
