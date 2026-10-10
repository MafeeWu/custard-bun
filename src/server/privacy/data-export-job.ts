import "server-only";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { lockUserChatMutation } from "@/server/chat/chat-locks";
import type { Database } from "@/server/db/client";
import { dataExportJob } from "@/server/db/schema";
import {
  DATA_EXPORT_QUEUE,
  DATA_EXPORT_DEAD_LETTER_QUEUE,
  DATA_EXPORT_EXPIRY_QUEUE,
} from "@/server/jobs/queues";
import {
  MAX_EXPORT_ARCHIVE_BYTES,
  validateArchiveLimit,
} from "./data-export-archive";
import {
  EXPORT_LEASE_MS,
  EXPORT_MAX_ATTEMPTS,
  expireDataExports,
  processDataExport,
  type DataExportPolicy,
} from "./data-export-service";

export interface DataExportQueueJob {
  exportId: string;
}
export function validExportId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export async function enqueuePendingDataExports(
  database: Database,
  boss: Pick<PgBoss, "send">,
  now: Date,
): Promise<number> {
  const rows = await database
    .select({ id: dataExportJob.id, userId: dataExportJob.userId })
    .from(dataExportJob)
    .where(
      and(
        or(
          and(
            eq(dataExportJob.status, "pending"),
            or(
              isNull(dataExportJob.nextRetryAt),
              lte(dataExportJob.nextRetryAt, now),
            ),
          ),
          and(
            eq(dataExportJob.status, "running"),
            or(
              isNull(dataExportJob.startedAt),
              lte(
                dataExportJob.startedAt,
                new Date(now.getTime() - EXPORT_LEASE_MS),
              ),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(dataExportJob.createdAt), asc(dataExportJob.id))
    .limit(50);
  let sent = 0;
  for (const row of rows) {
    const jobId = await boss.send(
      DATA_EXPORT_QUEUE,
      { exportId: row.id },
      {
        singletonKey: row.id,
        retryLimit: EXPORT_MAX_ATTEMPTS - 1,
        retryDelay: 60,
        retryBackoff: true,
        expireInSeconds: EXPORT_LEASE_MS / 1000,
      },
    );
    if (!jobId) continue;
    await database.transaction(async (tx) => {
      await lockUserChatMutation(tx, row.userId);
      await tx
        .update(dataExportJob)
        .set({ jobId, updatedAt: now })
        .where(
          and(
            eq(dataExportJob.id, row.id),
            inArray(dataExportJob.status, ["pending", "running"]),
          ),
        );
    });
    sent++;
  }
  return sent;
}

export async function publishDataExportDeadLetters(
  database: Database,
  boss: Pick<PgBoss, "send">,
  now: Date,
): Promise<number> {
  const rows = await database
    .select({ id: dataExportJob.id })
    .from(dataExportJob)
    .where(
      and(
        eq(dataExportJob.status, "failed"),
        isNull(dataExportJob.deadLetterPublishedAt),
      ),
    )
    .orderBy(asc(dataExportJob.createdAt), asc(dataExportJob.id))
    .limit(50);
  let sent = 0;
  for (const row of rows) {
    const client = await database.$client.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT id FROM data_export_jobs WHERE id = $1 AND status = 'failed' AND dead_letter_published_at IS NULL FOR UPDATE",
        [row.id],
      );
      if (locked.rowCount) {
        const id = await boss.send(
          DATA_EXPORT_DEAD_LETTER_QUEUE,
          { exportId: row.id },
          {
            id: row.id,
            singletonKey: row.id,
            db: { executeSql: (text, values) => client.query(text, values) },
          },
        );
        if (id) {
          await client.query(
            "UPDATE data_export_jobs SET dead_letter_published_at = $2 WHERE id = $1",
            [row.id, now],
          );
          sent++;
        }
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
      throw new Error("Data export dead-letter publication failed.");
    } finally {
      client.release();
    }
  }
  return sent;
}

interface ExportLogger {
  error(message: string, metadata: { exportId?: string; status: string }): void;
}
export async function registerDataExportWorker(
  database: Database,
  boss: PgBoss,
  logger: ExportLogger,
  policy: DataExportPolicy = { maxArchiveBytes: MAX_EXPORT_ARCHIVE_BYTES },
): Promise<() => Promise<void>> {
  validateArchiveLimit(policy.maxArchiveBytes);
  let pending: Promise<unknown> | undefined;
  let stopped = false;
  const reconcile = () => {
    if (stopped) return Promise.resolve();
    pending ??= (async () => {
      await expireDataExports(database, new Date());
      await enqueuePendingDataExports(database, boss, new Date());
      await publishDataExportDeadLetters(database, boss, new Date());
    })()
      .catch(() =>
        logger.error("data export reconciliation failed", { status: "failed" }),
      )
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  await boss.work<DataExportQueueJob>(DATA_EXPORT_QUEUE, async ([job]) => {
    const exportId = job.data?.exportId;
    if (!validExportId(exportId)) throw new Error("Invalid data export job.");
    try {
      await processDataExport(database, exportId, new Date(), policy);
      await publishDataExportDeadLetters(database, boss, new Date());
    } catch {
      logger.error("data export execution failed", {
        exportId,
        status: "failed",
      });
      await publishDataExportDeadLetters(database, boss, new Date()).catch(
        () => undefined,
      );
      throw new Error("Data export execution failed.");
    }
  });
  await boss.work(DATA_EXPORT_EXPIRY_QUEUE, async () => {
    try {
      await expireDataExports(database, new Date());
    } catch {
      logger.error("data export expiry failed", { status: "failed" });
      throw new Error("Data export expiry failed.");
    }
  });
  await boss.schedule(DATA_EXPORT_EXPIRY_QUEUE, "* * * * *", {});
  await reconcile();
  const timer = setInterval(() => {
    void reconcile();
  }, 30_000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        pending,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 10_000);
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}
