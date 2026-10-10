// @vitest-environment node
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { createDatabase } from "@/server/db/client";
import { dataExportJob, user } from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionNow,
  resetExtractionDatabase,
} from "@/test/memory-extraction-fixture";
import { summaryFixture } from "@/test/memory-summary-fixture";
import {
  EXPORT_LEASE_MS,
  requestDataExport,
  processDataExport,
  retryDataExport,
} from "./data-export-service";
import {
  enqueuePendingDataExports,
  registerDataExportWorker,
  publishDataExportDeadLetters,
} from "./data-export-job";
import {
  DATA_EXPORT_QUEUE,
  DATA_EXPORT_DEAD_LETTER_QUEUE,
  DATA_EXPORT_EXPIRY_QUEUE,
  AUTH_EMAIL_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
  RELATIONSHIP_SUMMARY_QUEUE,
  ensureQueues,
} from "@/server/jobs/queues";
import { createBoss } from "@/server/jobs/boss";

const database = createDatabase(testDatabaseUrl());
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());
test("queue registration is additive with safe retry/dead-letter and scheduled expiry", async () => {
  const createQueue = vi.fn();
  const updateQueue = vi.fn();
  await ensureQueues({ createQueue, updateQueue } as unknown as PgBoss);
  for (const name of [
    AUTH_EMAIL_QUEUE,
    MEMORY_EXTRACTION_QUEUE,
    RELATIONSHIP_SUMMARY_QUEUE,
    DATA_EXPORT_QUEUE,
    DATA_EXPORT_DEAD_LETTER_QUEUE,
    DATA_EXPORT_EXPIRY_QUEUE,
  ])
    expect(createQueue).toHaveBeenCalledWith(
      name,
      ...([
        AUTH_EMAIL_QUEUE,
        MEMORY_EXTRACTION_QUEUE,
        RELATIONSHIP_SUMMARY_QUEUE,
        DATA_EXPORT_QUEUE,
      ].includes(name)
        ? [expect.any(Object)]
        : []),
    );
});
test("enqueue is recoverable from database state and publishes ID-only payloads", async () => {
  const { userId } = await summaryFixture(database);
  const { exportId } = await requestDataExport(database, {
    userId,
    now: extractionNow,
  });
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("private database error"))
    .mockResolvedValue("queue-id");
  await expect(
    enqueuePendingDataExports(database, { send }, extractionNow),
  ).rejects.toThrow();
  expect(
    await enqueuePendingDataExports(database, { send }, extractionNow),
  ).toBe(1);
  expect(send).toHaveBeenLastCalledWith(
    DATA_EXPORT_QUEUE,
    { exportId },
    expect.objectContaining({ singletonKey: exportId }),
  );
  expect((await database.select().from(dataExportJob))[0].jobId).toBe(
    "queue-id",
  );
});
test("transient failures persist bounded retry state; exhausted work is failed without private errors; owner can retry", async () => {
  const { userId } = await summaryFixture(database);
  const { exportId } = await requestDataExport(database, {
    userId,
    now: extractionNow,
  });
  const original = database.transaction.bind(database);
  const spy = vi
    .spyOn(database, "transaction")
    .mockImplementation((callback, config) => {
      if (config?.isolationLevel === "repeatable read")
        return Promise.reject(new Error("private-provider-body-secret"));
      return original(callback, config);
    });
  try {
    for (let i = 0; i < 5; i++)
      await expect(
        processDataExport(
          database,
          exportId,
          new Date(extractionNow.getTime() + i * 3600000),
        ),
      ).rejects.toThrow("Data export execution failed.");
  } finally {
    spy.mockRestore();
  }
  const [failed] = await database.select().from(dataExportJob);
  expect(failed).toMatchObject({
    status: "failed",
    attemptCount: 5,
    archiveBytes: null,
    errorCategory: "internal",
  });
  expect(JSON.stringify(failed)).not.toContain("private-");
  const retried = await retryDataExport(database, {
    userId,
    exportId,
    now: new Date(extractionNow.getTime() + 86400000),
  });
  expect(retried.exportId).not.toBe(exportId);
  await processDataExport(
    database,
    retried.exportId,
    new Date(extractionNow.getTime() + 86400000),
  );
  expect(
    (
      await database
        .select()
        .from(dataExportJob)
        .where(eq(dataExportJob.id, retried.exportId))
    )[0],
  ).toMatchObject({ status: "complete", attemptCount: 1 });
});
test("worker validates IDs, sanitizes failure logs, registers expiry, and stops reconciliation", async () => {
  const work = vi.fn();
  const schedule = vi.fn();
  const send = vi.fn();
  const logger = { error: vi.fn() };
  const stop = await registerDataExportWorker(
    database,
    { work, schedule, send } as unknown as PgBoss,
    logger,
  );
  try {
    expect(schedule).toHaveBeenCalledWith(
      DATA_EXPORT_EXPIRY_QUEUE,
      expect.any(String),
      {},
    );
    const handler = work.mock.calls.find(
      ([name]) => name === DATA_EXPORT_QUEUE,
    )![1];
    await expect(
      handler([{ data: { exportId: "private-secret" } }]),
    ).rejects.toThrow("Invalid data export job.");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "private-secret",
    );
    await handler([
      { data: { exportId: "00000000-0000-4000-8000-000000000000" } },
    ]);
  } finally {
    await stop();
  }
});
test("crash after claim retains a durable lease/attempt; expired work recovers without duplicate snapshots", async () => {
  const { userId } = await summaryFixture(database);
  const { exportId } = await requestDataExport(database, {
    userId,
    now: extractionNow,
  });
  const original = database.transaction.bind(database);
  let calls = 0;
  const spy = vi
    .spyOn(database, "transaction")
    .mockImplementation((callback, config) => {
      if (++calls === 2)
        return Promise.reject(new Error("private worker crashed"));
      return original(callback, config);
    });
  try {
    await expect(
      processDataExport(database, exportId, extractionNow),
    ).rejects.toThrow("Data export execution failed.");
  } finally {
    spy.mockRestore();
  }
  expect((await database.select().from(dataExportJob))[0]).toMatchObject({
    status: "running",
    attemptCount: 1,
    archiveBytes: null,
  });
  await processDataExport(
    database,
    exportId,
    new Date(extractionNow.getTime() + EXPORT_LEASE_MS - 1),
  );
  expect((await database.select().from(dataExportJob))[0].attemptCount).toBe(1);
  const send = vi.fn().mockResolvedValue(null);
  expect(
    await enqueuePendingDataExports(
      database,
      { send },
      new Date(extractionNow.getTime() + EXPORT_LEASE_MS - 1),
    ),
  ).toBe(0);
  await processDataExport(
    database,
    exportId,
    new Date(extractionNow.getTime() + EXPORT_LEASE_MS),
  );
  expect((await database.select().from(dataExportJob))[0]).toMatchObject({
    status: "complete",
    attemptCount: 2,
  });
});
test("five crashed attempts become terminal instead of restarting with a replacement queue clock", async () => {
  const { userId } = await summaryFixture(database);
  const { exportId } = await requestDataExport(database, {
    userId,
    now: extractionNow,
  });
  await database
    .update(dataExportJob)
    .set({ status: "running", startedAt: extractionNow, attemptCount: 5 })
    .where(eq(dataExportJob.id, exportId));
  await processDataExport(
    database,
    exportId,
    new Date(extractionNow.getTime() + EXPORT_LEASE_MS),
  );
  expect((await database.select().from(dataExportJob))[0]).toMatchObject({
    status: "failed",
    attemptCount: 5,
    archiveBytes: null,
  });
});
test("pending deletion cancels queued processing and retry cannot resurrect it", async () => {
  const { userId } = await summaryFixture(database);
  const { exportId } = await requestDataExport(database, {
    userId,
    now: extractionNow,
  });
  await database
    .update(user)
    .set({ deletionPendingAt: extractionNow })
    .where(eq(user.id, userId));
  await processDataExport(database, exportId, extractionNow);
  expect((await database.select().from(dataExportJob))[0]).toMatchObject({
    status: "cancelled",
    archiveBytes: null,
  });
  await expect(
    retryDataExport(database, { userId, exportId, now: extractionNow }),
  ).rejects.toThrow();
});
test("worker failures log only validated export ID and safe status and throw sanitized errors", async () => {
  const work = vi.fn();
  const logger = { error: vi.fn() };
  const stop = await registerDataExportWorker(
    database,
    {
      work,
      schedule: vi.fn(),
      send: vi.fn(),
    } as unknown as PgBoss,
    logger,
  );
  const { userId } = await summaryFixture(database);
  const { exportId } = await requestDataExport(database, {
    userId,
    now: new Date(),
  });
  const original = database.transaction.bind(database);
  const spy = vi
    .spyOn(database, "transaction")
    .mockImplementation((callback, config) => {
      if (config?.isolationLevel === "repeatable read")
        return Promise.reject(
          new Error("private messages provider body secret"),
        );
      return original(callback, config);
    });
  try {
    const handler = work.mock.calls.find(
      ([name]) => name === DATA_EXPORT_QUEUE,
    )![1];
    await expect(handler([{ data: { exportId } }])).rejects.toThrow(
      "Data export execution failed.",
    );
    expect(logger.error).toHaveBeenCalledWith("data export execution failed", {
      exportId,
      status: "failed",
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private");
    expect((await database.select().from(dataExportJob))[0]).toMatchObject({
      status: "pending",
      attemptCount: 1,
      archiveBytes: null,
    });
  } finally {
    spy.mockRestore();
    await stop();
  }
});

test("real pg-boss generation and transactional ID-only dead-letter receipt", async () => {
  const boss = createBoss(testDatabaseUrl());
  await boss.start();
  await ensureQueues(boss);
  await boss.deleteAllJobs(DATA_EXPORT_QUEUE);
  await boss.deleteAllJobs(DATA_EXPORT_DEAD_LETTER_QUEUE);
  const { userId } = await summaryFixture(database);
  const { exportId } = await requestDataExport(database, {
    userId,
    now: new Date(),
  });
  const logger = { error: vi.fn() };
  const stop = await registerDataExportWorker(database, boss, logger);
  try {
    let complete = false;
    for (let i = 0; i < 150; i++) {
      const [job] = await database
        .select()
        .from(dataExportJob)
        .where(eq(dataExportJob.id, exportId));
      if (job.status === "complete") {
        complete = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(complete).toBe(true);
    const failed = await requestDataExport(database, {
      userId,
      now: new Date(),
    });
    await processDataExport(database, failed.exportId, new Date(), {
      maxArchiveBytes: 1,
    });
    expect(await publishDataExportDeadLetters(database, boss, new Date())).toBe(
      1,
    );
    expect(await publishDataExportDeadLetters(database, boss, new Date())).toBe(
      0,
    );
    const jobs = await boss.fetch<{ exportId: string }>(
      DATA_EXPORT_DEAD_LETTER_QUEUE,
    );
    expect(jobs.some((job) => job.data.exportId === failed.exportId)).toBe(
      true,
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("green tea");
  } finally {
    await stop();
    await boss.deleteAllJobs(DATA_EXPORT_QUEUE);
    await boss.deleteAllJobs(DATA_EXPORT_DEAD_LETTER_QUEUE);
    await boss.stop({ graceful: true, timeout: 5000 });
  }
}, 25000);
