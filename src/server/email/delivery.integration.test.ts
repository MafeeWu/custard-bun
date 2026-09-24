// @vitest-environment node
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDatabase } from "../db/client";
import { createBoss } from "../jobs/boss";
import { AUTH_EMAIL_QUEUE, ensureQueues } from "../jobs/queues";
import {
  recordWorkerHeartbeat,
  requireRecentWorkerHeartbeat,
} from "../health/worker-heartbeat";
import { checkReadiness } from "../health/check-readiness";
import { testDatabaseUrl } from "@/test/database-target";
import { processEmail } from "./process-email";
import { deliverAuthEmail } from "./smtp-delivery";
import type { EmailQueueJob } from "./email-job";

const database = createDatabase(testDatabaseUrl());
const boss = createBoss(testDatabaseUrl());
const worker = "auth-email-worker";
const ready = () =>
  checkReadiness({
    checkDatabase: async () => {
      await database.$client.query("select 1");
    },
    checkWorker: () =>
      requireRecentWorkerHeartbeat(
        database,
        worker,
        new Date(Date.now() - 60_000),
      ),
  });

beforeAll(async () => {
  await boss.start();
  await ensureQueues(boss, { authEmailRetryDelay: 60 });
  await boss.deleteAllJobs(AUTH_EMAIL_QUEUE);
  await database.$client.query("delete from worker_heartbeat where worker=$1", [
    worker,
  ]);
  await recordWorkerHeartbeat(database, worker);
});
afterAll(async () => {
  await boss.offWork(AUTH_EMAIL_QUEUE);
  await boss.deleteAllJobs(AUTH_EMAIL_QUEUE);
  await boss.stop({ graceful: false });
  await database.$client.end();
});

test("SMTP failure degrades readiness with retry retained; success restores delivery health", async () => {
  expect((await ready()).ready).toBe(true);
  const id = await boss.send(AUTH_EMAIL_QUEUE, {
    kind: "verify-email",
    to: "delivery-health@example.com",
    actionUrl: "http://localhost/verify?token=delivery-private-token",
  });
  expect(id).toBeTruthy();
  let smtpPort = 1;
  await boss.work<EmailQueueJob>(
    AUTH_EMAIL_QUEUE,
    { pollingIntervalSeconds: 0.5 },
    async ([job]) =>
      processEmail(database, job.data, (email) =>
        deliverAuthEmail(email, {
          brandName: "Health Test",
          smtp: {
            host: "127.0.0.1",
            port: smtpPort,
            secure: false,
            user: "test",
            password: "test",
            from: "test@example.com",
          },
        }),
      ),
  );
  await expect
    .poll(async () => (await boss.getJobById(AUTH_EMAIL_QUEUE, id!))?.state, {
      timeout: 10_000,
    })
    .toBe("retry");
  const failure = await ready();
  expect(failure).toEqual({
    ready: false,
    checks: { database: "ok", worker: "error" },
  });
  const persisted = await boss.getJobById(AUTH_EMAIL_QUEUE, id!);
  expect(JSON.stringify(persisted?.output)).not.toContain(
    "delivery-private-token",
  );
  await recordWorkerHeartbeat(database, worker);
  expect((await ready()).checks.worker).toBe("error");
  await processEmail(database, { kind: "noop" }, async () => {
    throw new Error("noop must not deliver");
  });
  expect((await ready()).checks.worker).toBe("error");
  smtpPort = 1025;
  // Advance only this observed retry, without sleeping through production backoff.
  await database.$client.query(
    "update job.job set start_after=now() where id=$1",
    [id],
  );
  await expect
    .poll(async () => (await boss.getJobById(AUTH_EMAIL_QUEUE, id!))?.state, {
      timeout: 10_000,
    })
    .toBe("completed");
  expect(await ready()).toEqual({
    ready: true,
    checks: { database: "ok", worker: "ok" },
  });
}, 25_000);

test("synthetic accepted work never dispatches SMTP", async () => {
  await expect(
    processEmail(database, { kind: "noop" }, async () => {
      throw new Error("unexpected SMTP dispatch");
    }),
  ).resolves.toBeUndefined();
});

test("delivery exceptions are sanitized before pg-boss persists them", async () => {
  await expect(
    processEmail(
      database,
      {
        kind: "verify-email",
        to: "test@example.com",
        actionUrl: "http://localhost",
      },
      async () => {
        throw new Error("private-token smtp-password");
      },
    ),
  ).rejects.toThrow(/^SMTP_DELIVERY_FAILED$/);
});
