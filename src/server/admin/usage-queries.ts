import "server-only";

import { and, asc, gt, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { generationLease, usageLedger } from "@/server/db/schema";
import { instancePeriod, userPeriod } from "@/server/chat/quota-service";

export interface UsageDashboard {
  userDay: { requests: number; inputTokens: number; outputTokens: number };
  instanceMonth: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
  };
  activeGenerations: number;
  outcomes: Record<"complete" | "failed" | "interrupted", number>;
  failures: Array<{ category: string; count: number }>;
  automaticRetries: number;
  estimatedUsageRows: number;
  latencyMs: { p50: number | null; p95: number | null };
  modelIds: string[];
}

function numeric(value: number | string | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function nullableNumeric(
  value: number | string | null | undefined,
): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export async function getUsageDashboard(
  database: Database,
  now: Date,
): Promise<UsageDashboard> {
  const day = userPeriod(now);
  const month = instancePeriod(now);
  const monthPredicate = and(
    gte(usageLedger.periodStart, month.start),
    lt(usageLedger.periodStart, month.end),
  );

  const [dayRows, monthRows, failureRows, modelRows, activeRows] =
    await Promise.all([
      database
        .select({
          requests: sql<number>`coalesce(sum(${usageLedger.userRequestUnits}), 0)::bigint`,
          inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}), 0)::bigint`,
          outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}), 0)::bigint`,
        })
        .from(usageLedger)
        .where(
          and(
            gte(usageLedger.periodStart, day.start),
            lt(usageLedger.periodStart, day.end),
          ),
        ),
      database
        .select({
          requests: sql<number>`coalesce(sum(${usageLedger.userRequestUnits}), 0)::bigint`,
          inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}), 0)::bigint`,
          outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}), 0)::bigint`,
          complete: sql<number>`coalesce(sum(${usageLedger.userRequestUnits}) filter (where ${usageLedger.outcome} = 'complete'), 0)::bigint`,
          failed: sql<number>`coalesce(sum(${usageLedger.userRequestUnits}) filter (where ${usageLedger.outcome} = 'failed'), 0)::bigint`,
          interrupted: sql<number>`coalesce(sum(${usageLedger.userRequestUnits}) filter (where ${usageLedger.outcome} = 'interrupted'), 0)::bigint`,
          automaticRetries: sql<number>`coalesce(sum(${usageLedger.automaticRetryCount}), 0)::bigint`,
          estimatedUsageRows: sql<number>`count(*) filter (where ${usageLedger.usageIsEstimated})::int`,
          p50: sql<
            number | null
          >`percentile_cont(0.5) within group (order by ${usageLedger.latencyMs}) filter (where ${usageLedger.latencyMs} is not null)`,
          p95: sql<
            number | null
          >`percentile_cont(0.95) within group (order by ${usageLedger.latencyMs}) filter (where ${usageLedger.latencyMs} is not null)`,
        })
        .from(usageLedger)
        .where(monthPredicate),
      database
        .select({
          category: usageLedger.errorCategory,
          count: sql<number>`count(*)::int`,
        })
        .from(usageLedger)
        .where(and(monthPredicate, isNotNull(usageLedger.errorCategory)))
        .groupBy(usageLedger.errorCategory)
        .orderBy(asc(usageLedger.errorCategory)),
      database
        .select({ modelId: usageLedger.modelId })
        .from(usageLedger)
        .where(monthPredicate)
        .groupBy(usageLedger.modelId)
        .orderBy(asc(usageLedger.modelId)),
      database
        .select({ count: sql<number>`count(*)::int` })
        .from(generationLease)
        .where(gt(generationLease.expiresAt, now)),
    ]);

  const dayTotals = dayRows[0];
  const monthTotals = monthRows[0];
  return {
    userDay: {
      requests: numeric(dayTotals?.requests),
      inputTokens: numeric(dayTotals?.inputTokens),
      outputTokens: numeric(dayTotals?.outputTokens),
    },
    instanceMonth: {
      requests: numeric(monthTotals?.requests),
      inputTokens: numeric(monthTotals?.inputTokens),
      outputTokens: numeric(monthTotals?.outputTokens),
    },
    activeGenerations: numeric(activeRows[0]?.count),
    outcomes: {
      complete: numeric(monthTotals?.complete),
      failed: numeric(monthTotals?.failed),
      interrupted: numeric(monthTotals?.interrupted),
    },
    failures: failureRows.map((row) => ({
      category: row.category!,
      count: numeric(row.count),
    })),
    automaticRetries: numeric(monthTotals?.automaticRetries),
    estimatedUsageRows: numeric(monthTotals?.estimatedUsageRows),
    latencyMs: {
      p50: nullableNumeric(monthTotals?.p50),
      p95: nullableNumeric(monthTotals?.p95),
    },
    modelIds: modelRows.map((row) => row.modelId),
  };
}
