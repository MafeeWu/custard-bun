import "server-only";

import { desc, sql } from "drizzle-orm";
import {
  adminAuditEvent,
  type AdminAuditAction,
} from "@/server/db/audit-schema";
import type { Database } from "@/server/db/client";

export type AdminAuditSummaryMetadata = Record<
  string,
  string | number | boolean | null
>;

export interface AdminAuditSummary {
  actorLabel: string;
  action: AdminAuditAction;
  targetType: string;
  targetId: string;
  metadata: AdminAuditSummaryMetadata;
  operationId: string;
  createdAt: Date;
}

const blockedMetadataKeys = new Set([
  "prompt",
  "password",
  "token",
  "reason",
  "message",
  "memory",
]);

function sanitizeMetadata(metadata: unknown): AdminAuditSummaryMetadata {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return {};
  }

  const safe: AdminAuditSummaryMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (blockedMetadataKeys.has(key.toLowerCase())) {
      continue;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

export async function listAdminAuditEvents(
  database: Database,
  input: {
    page: number;
    pageSize: 50;
  },
): Promise<{ events: AdminAuditSummary[]; total: number }> {
  if (input.pageSize !== 50) {
    throw new Error("Audit page size must be 50");
  }

  const page = Math.max(1, Math.trunc(input.page));
  const rows = await database
    .select({
      actorLabel: adminAuditEvent.actorLabel,
      action: adminAuditEvent.action,
      targetType: adminAuditEvent.targetType,
      targetId: adminAuditEvent.targetId,
      metadata: adminAuditEvent.metadata,
      operationId: adminAuditEvent.operationId,
      createdAt: adminAuditEvent.createdAt,
    })
    .from(adminAuditEvent)
    .orderBy(desc(adminAuditEvent.createdAt), desc(adminAuditEvent.id))
    .limit(input.pageSize)
    .offset((page - 1) * input.pageSize);

  const [countRow] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(adminAuditEvent);

  return {
    events: rows.map((row) => ({
      ...row,
      metadata: sanitizeMetadata(row.metadata),
    })),
    total: countRow?.total ?? 0,
  };
}
