// @vitest-environment node
import { afterAll, beforeAll, expect, test } from "vitest";
import type { PgBoss } from "pg-boss";
import { createBoss } from "./boss";
import { AUTH_EMAIL_QUEUE, ensureQueues } from "./queues";
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
