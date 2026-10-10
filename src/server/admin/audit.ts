import "server-only";

import { randomUUID } from "node:crypto";
import {
  adminAuditEvent,
  type AdminAuditAction,
  type UserAuditAction,
} from "@/server/db/audit-schema";
import type { Database } from "@/server/db/client";
import type { AdminActor } from "./admin-actor";

export interface AdminAuditEventInput {
  action: AdminAuditAction;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

export type AdminAuditMetadataValue = string | number | boolean | null;
export type AdminAuditMetadata = Record<string, AdminAuditMetadataValue>;

const blockedMetadataKeys = new Set([
  "archive",
  "content",
  "credential",
  "email",
  "prompt",
  "password",
  "secret",
  "summary",
  "token",
  "reason",
  "message",
  "memory",
]);

function isPrimitiveAuditMetadataValue(
  value: unknown,
): value is AdminAuditMetadataValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validateAuditMetadata(metadata: unknown): AdminAuditMetadata {
  const prototype = Object.getPrototypeOf(metadata);
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw new Error("Audit metadata must be a flat record of primitive values");
  }

  const entries = Object.entries(metadata);
  if (entries.length > 20) {
    throw new Error("Audit metadata must contain at most 20 keys");
  }

  const validatedMetadata: AdminAuditMetadata = {};
  for (const [key, value] of entries) {
    if (blockedMetadataKeys.has(key.toLowerCase())) {
      throw new Error(`Audit metadata key "${key}" is not allowed`);
    }

    if (!isPrimitiveAuditMetadataValue(value)) {
      throw new Error("Audit metadata must be a flat record of primitive values");
    }

    validatedMetadata[key] = value;
  }

  return validatedMetadata;
}

export async function recordAdminAudit(
  executor: Pick<Database, "insert">,
  actor: AdminActor,
  event: AdminAuditEventInput,
): Promise<void> {
  const metadata = validateAuditMetadata(event.metadata);

  await executor.insert(adminAuditEvent).values({
    id: randomUUID(),
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata,
    operationId: actor.operationId,
  });
}

export async function recordUserAudit(
  executor: Pick<Database, "insert">,
  event: {
    userId: string;
    action: UserAuditAction;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const metadata = validateAuditMetadata(event.metadata);

  await executor.insert(adminAuditEvent).values({
    id: randomUUID(),
    actorUserId: event.userId,
    actorLabel: "user",
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata,
    operationId: randomUUID(),
  });
}
