// @vitest-environment node
import { afterAll, beforeAll, expect, test } from "vitest";
import type { PgBoss } from "pg-boss";
import { createBoss } from "./boss";
import { AUTH_EMAIL_QUEUE, ensureQueues } from "./queues";

const databaseUrl =
  "postgresql://companion:companion@127.0.0.1:55432/companion_test";
let boss: PgBoss;

beforeAll(async () => {
  boss = createBoss(databaseUrl);
  await boss.start();
  await ensureQueues(boss);
});

afterAll(async () => {
  await boss.stop({ graceful: false });
});

test("persists an authentication email job", async () => {
  const id = await boss.send(AUTH_EMAIL_QUEUE, {
    kind: "verify-email",
    to: "person@example.com",
    actionUrl: "https://example.com/verify",
  });

  expect(id).toEqual(expect.any(String));
});
