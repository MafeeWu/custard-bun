import "server-only";

import { asc, eq, inArray, sql, type AnyColumn } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import {
  accountDeletionRequest,
  dataExportJob,
  memoryExtractionRun,
  relationshipSummaryRun,
  usageLedger,
} from "@/server/db/schema";

export interface MemoryOperationsDashboard {
  jobs: Record<"pending" | "running" | "retrying" | "failed" | "deadLetter", number>;
  processingDelayMs: { p50: number | null; p95: number | null };
  tokens: { input: number; output: number; estimatedRows: number };
  exports: { active: number; expiredBytes: number };
  purges: Array<{ stage: string; count: number; oldestAt: Date | null }>;
  failures: Array<{ category: string; count: number }>;
}

export interface MemoryOperationsDetails {
  oldestPendingAt: Date | null;
  exportStates: Array<{ state: string; count: number }>;
}

export type MemoryOperationType =
  | "memory_extraction"
  | "summary_refresh"
  | "data_export"
  | "account_purge";

export const validOperationId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export interface MemoryRetryCandidate {
  operationType: MemoryOperationType;
  operationId: string;
  status: "failed" | "dead_letter";
}

const safeCategory = (column: AnyColumn) =>
  sql<string>`case when ${column} in ('validation', 'internal', 'instance_budget', 'provider_unavailable', 'provider_error', 'timeout', 'rate_limit', 'transport', 'PURGE_STAGE_FAILED') then ${column} else 'other' end`;
const safePurgeStage = sql<string>`case when ${accountDeletionRequest.currentStage}
  in ('settle', 'exports', 'memory', 'conversations', 'audit', 'auth', 'complete')
  then ${accountDeletionRequest.currentStage} else 'unknown' end`;

const number = (value: unknown) => Number(value ?? 0);
const nullableNumber = (value: unknown) => value == null ? null : Number(value);
const nullableDate = (value: Date | string | null): Date | null =>
  value == null ? null : new Date(value);

export async function getMemoryOperationsDashboard(
  database: Database,
  now: Date = new Date(),
): Promise<MemoryOperationsDashboard> {
  // Only numeric metadata from operation tables and the de-identified usage ledger is projected.
  const [extraction, summary, tokens, exports, purgeRows] = await Promise.all([
    database.select({
      pending: sql<number>`count(*) filter (where ${memoryExtractionRun.status} in ('pending', 'queued'))::int`,
      running: sql<number>`count(*) filter (where ${memoryExtractionRun.status} = 'running')::int`,
      retrying: sql<number>`count(*) filter (where ${memoryExtractionRun.status} = 'retrying')::int`,
      failed: sql<number>`count(*) filter (where ${memoryExtractionRun.status} = 'failed')::int`,
      deadLetter: sql<number>`count(*) filter (where ${memoryExtractionRun.status} = 'dead_letter')::int`,
    }).from(memoryExtractionRun),
    database.select({
      pending: sql<number>`count(*) filter (where ${relationshipSummaryRun.status} in ('pending', 'queued'))::int`,
      running: sql<number>`count(*) filter (where ${relationshipSummaryRun.status} = 'running')::int`,
      retrying: sql<number>`count(*) filter (where ${relationshipSummaryRun.status} = 'retrying')::int`,
      failed: sql<number>`count(*) filter (where ${relationshipSummaryRun.status} = 'failed')::int`,
      deadLetter: sql<number>`count(*) filter (where ${relationshipSummaryRun.status} = 'dead_letter')::int`,
    }).from(relationshipSummaryRun),
    database.select({
      input: sql<number>`coalesce(sum(${usageLedger.inputTokens}), 0)::bigint`,
      output: sql<number>`coalesce(sum(${usageLedger.outputTokens}), 0)::bigint`,
      estimated: sql<number>`count(*) filter (where ${usageLedger.usageIsEstimated})::int`,
    }).from(usageLedger).where(inArray(usageLedger.workloadType, ["memory_extraction", "summary_refresh"])),
    database.select({
      active: sql<number>`count(*) filter (where ${dataExportJob.status} in ('pending', 'running'))::int`,
      expiredBytes: sql<number>`coalesce(sum(${dataExportJob.archiveSize}) filter (where ${dataExportJob.status} = 'complete' and ${dataExportJob.expiresAt} <= ${now}), 0)::bigint`,
    }).from(dataExportJob),
    database.select({
      stage: safePurgeStage,
      count: sql<number>`count(*)::int`,
      oldestAt: sql<Date | string | null>`min(${accountDeletionRequest.lockedAt})`,
    }).from(accountDeletionRequest)
      .where(inArray(accountDeletionRequest.status, ["locked", "purging", "dead_letter"]))
      .groupBy(safePurgeStage).orderBy(safePurgeStage),
  ]);
  const [extractionFailures, summaryFailures, exportFailures, purgeFailures] = await Promise.all([
    database.select({ category: safeCategory(memoryExtractionRun.errorCategory), count: sql<number>`count(*)::int` })
      .from(memoryExtractionRun).where(inArray(memoryExtractionRun.status, ["failed", "dead_letter"]))
      .groupBy(safeCategory(memoryExtractionRun.errorCategory)),
    database.select({ category: safeCategory(relationshipSummaryRun.errorCategory), count: sql<number>`count(*)::int` })
      .from(relationshipSummaryRun).where(inArray(relationshipSummaryRun.status, ["failed", "dead_letter"]))
      .groupBy(safeCategory(relationshipSummaryRun.errorCategory)),
    database.select({ category: safeCategory(dataExportJob.errorCategory), count: sql<number>`count(*)::int` })
      .from(dataExportJob).where(eq(dataExportJob.status, "failed"))
      .groupBy(safeCategory(dataExportJob.errorCategory)),
    database.select({ category: safeCategory(accountDeletionRequest.errorCategory), count: sql<number>`count(*)::int` })
      .from(accountDeletionRequest).where(eq(accountDeletionRequest.status, "dead_letter"))
      .groupBy(safeCategory(accountDeletionRequest.errorCategory)),
  ]);
  const categories = new Map<string, number>();
  for (const row of [...extractionFailures, ...summaryFailures, ...exportFailures, ...purgeFailures])
    categories.set(row.category, (categories.get(row.category) ?? 0) + number(row.count));
  const e = extraction[0]!, s = summary[0]!;
  // Percentiles across both workloads must be weighted by individual operations, not by each workload's percentile.
  const combinedDelay = await database.execute<{
    p50: number | null; p95: number | null;
  }>(sql`select percentile_cont(0.5) within group (order by delay_ms) as p50,
    percentile_cont(0.95) within group (order by delay_ms) as p95
    from (
      select extract(epoch from (started_at - created_at)) * 1000 as delay_ms
      from memory_extraction_runs where started_at is not null
      union all
      select extract(epoch from (started_at - created_at)) * 1000 as delay_ms
      from relationship_summary_runs where started_at is not null
    ) delays`);
  return {
    jobs: {
      pending: number(e.pending) + number(s.pending),
      running: number(e.running) + number(s.running),
      retrying: number(e.retrying) + number(s.retrying),
      failed: number(e.failed) + number(s.failed),
      deadLetter: number(e.deadLetter) + number(s.deadLetter),
    },
    processingDelayMs: {
      p50: nullableNumber(combinedDelay.rows[0]?.p50),
      p95: nullableNumber(combinedDelay.rows[0]?.p95),
    },
    tokens: { input: number(tokens[0]?.input), output: number(tokens[0]?.output), estimatedRows: number(tokens[0]?.estimated) },
    exports: { active: number(exports[0]?.active), expiredBytes: number(exports[0]?.expiredBytes) },
    purges: purgeRows.map((row) => ({ stage: row.stage, count: number(row.count), oldestAt: nullableDate(row.oldestAt) })),
    failures: [...categories].sort(([a], [b]) => a.localeCompare(b))
      .map(([category, count]) => ({ category, count })),
  };
}

export async function getMemoryOperationsDetails(database: Database): Promise<MemoryOperationsDetails> {
  const [extraction, summary, exportStates] = await Promise.all([
    database.select({
      oldest: sql<Date | string | null>`min(${memoryExtractionRun.createdAt}) filter (where ${memoryExtractionRun.status} in ('pending', 'queued'))`,
    }).from(memoryExtractionRun),
    database.select({
      oldest: sql<Date | string | null>`min(${relationshipSummaryRun.createdAt}) filter (where ${relationshipSummaryRun.status} in ('pending', 'queued'))`,
    }).from(relationshipSummaryRun),
    database.select({ state: dataExportJob.status, count: sql<number>`count(*)::int` })
      .from(dataExportJob).groupBy(dataExportJob.status).orderBy(asc(dataExportJob.status)),
  ]);
  return {
    oldestPendingAt: [extraction[0]?.oldest, summary[0]?.oldest]
      .map((value) => nullableDate(value ?? null))
      .filter((date): date is Date => date !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    exportStates: exportStates.map((row) => ({ state: row.state, count: number(row.count) })),
  };
}

export async function getMemoryRetryCandidates(database: Database): Promise<MemoryRetryCandidate[]> {
  const [extraction, summary, exports, purges] = await Promise.all([
    database.select({ operationId: memoryExtractionRun.id, status: memoryExtractionRun.status })
      .from(memoryExtractionRun)
      .where(inArray(memoryExtractionRun.status, ["failed", "dead_letter"]))
      .orderBy(asc(memoryExtractionRun.createdAt)).limit(20),
    database.select({ operationId: relationshipSummaryRun.id, status: relationshipSummaryRun.status })
      .from(relationshipSummaryRun)
      .where(inArray(relationshipSummaryRun.status, ["failed", "dead_letter"]))
      .orderBy(asc(relationshipSummaryRun.createdAt)).limit(20),
    database.select({ operationId: dataExportJob.id, status: dataExportJob.status })
      .from(dataExportJob)
      .where(eq(dataExportJob.status, "failed"))
      .orderBy(asc(dataExportJob.createdAt)).limit(20),
    database.select({ operationId: accountDeletionRequest.id, status: accountDeletionRequest.status })
      .from(accountDeletionRequest).where(eq(accountDeletionRequest.status, "dead_letter"))
      .orderBy(asc(accountDeletionRequest.lockedAt)).limit(20),
  ]);
  return [
    ...extraction.map(({ operationId, status }) => ({ operationType: "memory_extraction" as const, operationId, status: status as "failed" | "dead_letter" })),
    ...summary.map(({ operationId, status }) => ({ operationType: "summary_refresh" as const, operationId, status: status as "failed" | "dead_letter" })),
    ...exports.map(({ operationId }) => ({ operationType: "data_export" as const, operationId, status: "failed" as const })),
    ...purges.map(({ operationId }) => ({ operationType: "account_purge" as const, operationId, status: "dead_letter" as const })),
  ].filter((candidate) => validOperationId(candidate.operationId));
}
