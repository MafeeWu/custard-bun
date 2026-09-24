// @vitest-environment node
import { afterAll, beforeAll, expect, test } from "vitest";
import type { PgBoss } from "pg-boss";
import { createBoss } from "@/server/jobs/boss";

const databaseUrl = "postgresql://companion:companion@127.0.0.1:55432/companion_test";
const queue = `retry-test-${Date.now()}`;
let boss: PgBoss;

beforeAll(async () => {
  boss = createBoss(databaseUrl);
  await boss.start();
  await boss.createQueue(queue, {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: false,
  });
});

afterAll(async () => {
  await boss.stop({ graceful: false });
});

test("retains an SMTP failure for retry", async () => {
  const id = await boss.send(queue, { to: "person@example.com" });
  if (!id) {
    throw new Error("retry test job was not accepted");
  }

  let attempted = false;
  await boss.work(queue, async () => {
    attempted = true;
    throw new Error("temporary SMTP failure");
  });

  await expect.poll(() => attempted, { timeout: 5_000 }).toBe(true);
  await expect.poll(async () => (await boss.getJobById(queue, id))?.state, {
    timeout: 5_000,
  }).toBe("retry");

  const job = await boss.getJobById(queue, id);
  expect(job?.output).toEqual(
    expect.objectContaining({ message: "temporary SMTP failure" }),
  );
  expect(job?.startedOn).toBeTruthy();
  expect(job?.state).not.toBe("completed");
});
