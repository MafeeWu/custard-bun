import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import type { Database } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import {
  lockUserChatMutation,
  type ChatTransaction,
} from "@/server/chat/chat-locks";
import { dataExportJob, user } from "@/server/db/schema";
import {
  archiveDigest,
  ExportArchiveError,
  MAX_EXPORT_ARCHIVE_BYTES,
  validateArchiveLimit,
} from "./data-export-archive";
import { readDataExportSnapshot } from "./data-export-snapshot";

export const EXPORT_MAX_ATTEMPTS = 5;
export const EXPORT_LEASE_MS = 15 * 60_000;
export interface DataExportPolicy {
  maxArchiveBytes: number;
  clock?: () => Date;
  afterClaim?: (claim: {
    exportId: string;
    userId: string;
    attemptCount: number;
  }) => Promise<void>;
}
export interface DataExportView {
  id: string;
  status: typeof dataExportJob.$inferSelect.status;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}
export class DataExportError extends Error {
  constructor(
    readonly code:
      | "EXPORT_UNAVAILABLE"
      | "EXPORT_NOT_FOUND"
      | "EXPORT_CONFLICT"
      | "EXPORT_INTERNAL",
  ) {
    super(
      code === "EXPORT_CONFLICT"
        ? "Another data export is already in progress."
        : "Data export is unavailable.",
    );
    this.name = "DataExportError";
  }
}

async function privateTransaction<T>(
  database: Database,
  operation: (tx: ChatTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await database.transaction(operation);
  } catch (error) {
    if (error instanceof DataExportError) throw error;
    throw new DataExportError("EXPORT_INTERNAL");
  }
}

const snapshotCheckouts = new WeakMap<Database["$client"], Promise<void>>();

async function withReservedExportSnapshot<T>(
  database: Database,
  operation: (
    tx: ChatTransaction,
    snapshot: NodePgDatabase<typeof schema>,
  ) => Promise<T>,
): Promise<T> {
  const pool = database.$client;
  const previous = snapshotCheckouts.get(pool) ?? Promise.resolve();
  let unlock!: () => void;
  const checkout = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  snapshotCheckouts.set(pool, checkout);
  await previous;
  const releaseCheckout = () => {
    unlock();
    if (snapshotCheckouts.get(pool) === checkout) snapshotCheckouts.delete(pool);
  };
  let snapshotClient: PoolClient | undefined;
  try {
    // Serialize paired checkout so concurrent exports cannot each reserve half the pool.
    // Reserve snapshot capacity before the owning transaction can wait on canonical locks.
    snapshotClient = await pool.connect();
    const snapshot = drizzle(snapshotClient, { schema });
    return await database.transaction(async (tx) => {
      releaseCheckout();
      return operation(tx, snapshot);
    });
  } finally {
    releaseCheckout();
    snapshotClient?.release();
  }
}

const metadata = {
  id: dataExportJob.id,
  userId: dataExportJob.userId,
  status: dataExportJob.status,
  createdAt: dataExportJob.createdAt,
  completedAt: dataExportJob.completedAt,
  expiresAt: dataExportJob.expiresAt,
  attemptCount: dataExportJob.attemptCount,
  nextRetryAt: dataExportJob.nextRetryAt,
  startedAt: dataExportJob.startedAt,
};
const removedArchive = {
  archiveBytes: null,
  archiveSize: null,
  archiveSha256: null,
  expiresAt: null,
  downloadedAt: null,
};
function view(row: {
  id: string;
  status: DataExportView["status"];
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}): DataExportView {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

async function activeOwner(
  tx: ChatTransaction,
  userId: string,
): Promise<boolean> {
  const [owner] = await tx
    .select({
      id: user.id,
      banned: user.banned,
      deletionPendingAt: user.deletionPendingAt,
    })
    .from(user)
    .where(eq(user.id, userId));
  return !!owner && !owner.banned && !owner.deletionPendingAt;
}

// Task 10 must call this within the same canonical transaction that sets deletionPendingAt.
export async function cancelDataExportsForUser(
  tx: ChatTransaction,
  userId: string,
  now: Date,
): Promise<void> {
  await lockUserChatMutation(tx, userId);
  // Completed archive identity is immutable: deletion removes the row, never reclassifies it.
  await tx
    .delete(dataExportJob)
    .where(
      and(
        eq(dataExportJob.userId, userId),
        eq(dataExportJob.status, "complete"),
      ),
    );
  await tx
    .update(dataExportJob)
    .set({
      ...removedArchive,
      status: "cancelled",
      nextRetryAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(dataExportJob.userId, userId),
        inArray(dataExportJob.status, ["pending", "running"]),
      ),
    );
}

export async function requestDataExport(
  database: Database,
  input: { userId: string; now: Date },
): Promise<{ exportId: string }> {
  return privateTransaction(database, async (tx) => {
    await lockUserChatMutation(tx, input.userId);
    if (!(await activeOwner(tx, input.userId)))
      throw new DataExportError("EXPORT_UNAVAILABLE");
    const [existing] = await tx
      .select({ id: dataExportJob.id })
      .from(dataExportJob)
      .where(
        and(
          eq(dataExportJob.userId, input.userId),
          inArray(dataExportJob.status, ["pending", "running"]),
        ),
      );
    if (existing) return { exportId: existing.id };
    const exportId = randomUUID();
    await tx
      .insert(dataExportJob)
      .values({
        id: exportId,
        userId: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      });
    return { exportId };
  });
}

export async function retryDataExport(
  database: Database,
  input: { userId: string; exportId: string; now: Date },
): Promise<{ exportId: string }> {
  return privateTransaction(database, async (tx) => {
    await lockUserChatMutation(tx, input.userId);
    if (!(await activeOwner(tx, input.userId)))
      throw new DataExportError("EXPORT_UNAVAILABLE");
    const [job] = await tx
      .select(metadata)
      .from(dataExportJob)
      .where(
        and(
          eq(dataExportJob.id, input.exportId),
          eq(dataExportJob.userId, input.userId),
        ),
      );
    if (!job || job.status !== "failed")
      throw new DataExportError("EXPORT_NOT_FOUND");
    const [active] = await tx
      .select({ id: dataExportJob.id })
      .from(dataExportJob)
      .where(
        and(
          eq(dataExportJob.userId, input.userId),
          inArray(dataExportJob.status, ["pending", "running"]),
        ),
      );
    if (active) throw new DataExportError("EXPORT_CONFLICT");
    // Terminal job status cannot be reset. An explicit owner retry creates a fresh durable job.
    const exportId = randomUUID();
    await tx
      .insert(dataExportJob)
      .values({
        id: exportId,
        userId: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      });
    return { exportId };
  });
}

async function expireOwned(
  tx: ChatTransaction,
  userId: string,
  now: Date,
): Promise<number> {
  const rows = await tx
    .update(dataExportJob)
    .set({
      ...removedArchive,
      status: "expired",
      nextRetryAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(dataExportJob.userId, userId),
        eq(dataExportJob.status, "complete"),
        lte(dataExportJob.expiresAt, now),
      ),
    )
    .returning({ id: dataExportJob.id });
  return rows.length;
}

export async function getDataExportForUser(
  database: Database,
  input: { userId: string; exportId: string; now: Date },
): Promise<DataExportView | null> {
  return privateTransaction(database, async (tx) => {
    await lockUserChatMutation(tx, input.userId);
    if (!(await activeOwner(tx, input.userId))) return null;
    await expireOwned(tx, input.userId, input.now);
    const [row] = await tx
      .select(metadata)
      .from(dataExportJob)
      .where(
        and(
          eq(dataExportJob.id, input.exportId),
          eq(dataExportJob.userId, input.userId),
        ),
      );
    return row ? view(row) : null;
  });
}

export async function listDataExportsForUser(
  database: Database,
  input: { userId: string; now: Date },
): Promise<DataExportView[]> {
  return privateTransaction(database, async (tx) => {
    await lockUserChatMutation(tx, input.userId);
    if (!(await activeOwner(tx, input.userId))) return [];
    await expireOwned(tx, input.userId, input.now);
    const rows = await tx
      .select(metadata)
      .from(dataExportJob)
      .where(eq(dataExportJob.userId, input.userId))
      .orderBy(desc(dataExportJob.createdAt), desc(dataExportJob.id))
      .limit(20);
    return rows.map(view);
  });
}

export async function processDataExport(
  database: Database,
  exportId: string,
  now: Date,
  policy: DataExportPolicy = { maxArchiveBytes: MAX_EXPORT_ARCHIVE_BYTES },
): Promise<void> {
  try {
    await processDataExportInTransaction(database, exportId, now, policy);
  } catch {
    throw new Error("Data export execution failed.");
  }
}

async function processDataExportInTransaction(
  database: Database,
  exportId: string,
  now: Date,
  policy: DataExportPolicy,
): Promise<void> {
  validateArchiveLimit(policy.maxArchiveBytes);
  const [preview] = await database
    .select({ userId: dataExportJob.userId })
    .from(dataExportJob)
    .where(eq(dataExportJob.id, exportId));
  if (!preview) return;
  const claim = await privateTransaction(database, async (tx) => {
    await lockUserChatMutation(tx, preview.userId);
    const [job] = await tx
      .select(metadata)
      .from(dataExportJob)
      .where(eq(dataExportJob.id, exportId));
    if (!job || !["pending", "running"].includes(job.status)) return null;
    if (!(await activeOwner(tx, preview.userId))) {
      await cancelDataExportsForUser(tx, preview.userId, now);
      return null;
    }
    if (job.nextRetryAt && job.nextRetryAt > now) return null;
    if (
      job.status === "running" &&
      job.startedAt &&
      job.startedAt.getTime() + EXPORT_LEASE_MS > now.getTime()
    )
      return null;
    if (job.attemptCount >= EXPORT_MAX_ATTEMPTS) {
      await tx
        .update(dataExportJob)
        .set({
          status: "failed",
          errorCategory: "internal",
          nextRetryAt: null,
          updatedAt: now,
        })
        .where(eq(dataExportJob.id, exportId));
      return null;
    }
    const attemptCount = job.attemptCount + 1;
    await tx
      .update(dataExportJob)
      .set({
        status: "running",
        attemptCount,
        nextRetryAt: null,
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(dataExportJob.id, exportId));
    return { userId: preview.userId, attemptCount };
  });
  if (!claim) return;
  // Last yield point at which deletion can win: snapshot construction and
  // publication below hold the canonical owner locks as one indivisible unit.
  await policy.afterClaim?.({ exportId, ...claim });
  // The short claim commits before private work, so crashes consume a durable attempt and lease.
  const failed = await withReservedExportSnapshot(database, async (tx, snapshotDatabase) => {
    await lockUserChatMutation(tx, claim.userId);
    const [job] = await tx
      .select(metadata)
      .from(dataExportJob)
      .where(eq(dataExportJob.id, exportId));
    if (
      !job ||
      job.status !== "running" ||
      job.attemptCount !== claim.attemptCount
    )
      return false;
    if (!(await activeOwner(tx, claim.userId))) {
      await cancelDataExportsForUser(tx, claim.userId, now);
      return false;
    }
    const attemptCount = claim.attemptCount;
    try {
      // Lock acquisition is READ COMMITTED: a waiter must see deletion committed by its predecessor.
      // A separate read-only RR connection starts its MVCC snapshot only AFTER canonical locks are held.
      // The owning transaction keeps them through ZIP construction and publication; never reverse this order.
      const archive = await snapshotDatabase.transaction(
        (snapshot) =>
          readDataExportSnapshot(
            snapshot,
            preview.userId,
            now,
            policy.maxArchiveBytes,
          ),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      const completedAt = policy.clock?.() ?? new Date();
      await tx
        .update(dataExportJob)
        .set({
          status: "complete",
          archiveBytes: archive.bytes,
          archiveSize: archive.size,
          archiveSha256: archive.sha256,
          completedAt,
          expiresAt: new Date(completedAt.getTime() + 86_400_000),
          errorCategory: null,
          nextRetryAt: null,
          updatedAt: completedAt,
        })
        .where(eq(dataExportJob.id, exportId));
      return false;
    } catch (error) {
      const permanent = error instanceof ExportArchiveError;
      await tx
        .update(dataExportJob)
        .set({
          ...removedArchive,
          status:
            permanent || attemptCount >= EXPORT_MAX_ATTEMPTS
              ? "failed"
              : "pending",
          errorCategory: permanent ? error.category : "internal",
          nextRetryAt:
            permanent || attemptCount >= EXPORT_MAX_ATTEMPTS
              ? null
              : new Date(now.getTime() + 60_000 * 2 ** (attemptCount - 1)),
          updatedAt: now,
        })
        .where(eq(dataExportJob.id, exportId));
      return !permanent;
    }
  });
  if (failed) throw new Error("Data export execution failed.");
}

export async function expireDataExports(
  database: Database,
  now: Date,
): Promise<number> {
  const owners = await database
    .selectDistinct({ userId: dataExportJob.userId })
    .from(dataExportJob)
    .where(
      and(
        eq(dataExportJob.status, "complete"),
        lte(dataExportJob.expiresAt, now),
      ),
    )
    .orderBy(asc(dataExportJob.userId));
  let expired = 0;
  for (const owner of owners)
    expired += await database.transaction(async (tx) => {
      await lockUserChatMutation(tx, owner.userId);
      return expireOwned(tx, owner.userId, now);
    });
  return expired;
}

export async function downloadDataExport(
  database: Database,
  input: { userId: string; exportId: string; now: Date },
): Promise<{ bytes: Buffer; size: number } | null> {
  return privateTransaction(database, async (tx) => {
    await lockUserChatMutation(tx, input.userId);
    if (!(await activeOwner(tx, input.userId))) return null;
    await expireOwned(tx, input.userId, input.now);
    const [job] = await tx
      .select({
        status: dataExportJob.status,
        archiveBytes: dataExportJob.archiveBytes,
        archiveSize: dataExportJob.archiveSize,
        archiveSha256: dataExportJob.archiveSha256,
        expiresAt: dataExportJob.expiresAt,
      })
      .from(dataExportJob)
      .where(
        and(
          eq(dataExportJob.id, input.exportId),
          eq(dataExportJob.userId, input.userId),
          eq(dataExportJob.status, "complete"),
        ),
      );
    if (
      !job?.archiveBytes ||
      !job.expiresAt ||
      job.expiresAt <= input.now ||
      job.archiveSize !== job.archiveBytes.length ||
      job.archiveSize > MAX_EXPORT_ARCHIVE_BYTES ||
      job.archiveSha256 !== archiveDigest(job.archiveBytes)
    )
      return null;
    await tx
      .update(dataExportJob)
      .set({ downloadedAt: input.now })
      .where(eq(dataExportJob.id, input.exportId));
    return { bytes: job.archiveBytes, size: job.archiveSize };
  });
}
