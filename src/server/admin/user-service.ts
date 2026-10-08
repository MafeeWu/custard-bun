import "server-only";

import { eq } from "drizzle-orm";
import { recordAdminAudit } from "@/server/admin/audit";
import type { AdminActor } from "@/server/admin/admin-actor";
import type { Database } from "@/server/db/client";
import { session, user } from "@/server/db/auth-schema";
import { requireAdminWrite } from "./require-admin-write";

export function validateDisableReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw new Error("Disable reason must be 1-500 characters");
  }
  return trimmed;
}

function rejectSelfTarget(actor: AdminActor, userId: string) {
  if (actor.userId === userId) {
    throw new Error("Administrators cannot manage their own account");
  }
}

export async function disableOrdinaryUser(
  database: Database,
  actor: AdminActor,
  input: {
    userId: string;
    reason: string;
  },
): Promise<void> {
  rejectSelfTarget(actor, input.userId);
  const reason = validateDisableReason(input.reason);

  await database.transaction(async (transaction) => {
    await requireAdminWrite(transaction, actor);
    const [target] = await transaction
      .select({ id: user.id, role: user.role, banned: user.banned })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update")
      .limit(1);

    if (!target || target.role !== "user") {
      throw new Error("Only ordinary users can be managed");
    }
    if (target.banned === true) {
      throw new Error("User is already disabled");
    }

    await transaction
      .update(user)
      .set({
        banned: true,
        banReason: reason,
        banExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, input.userId));
    await transaction.delete(session).where(eq(session.userId, input.userId));
    await recordAdminAudit(transaction, actor, {
      action: "user.disable",
      targetType: "user",
      targetId: input.userId,
      metadata: { previousState: "active", nextState: "disabled" },
    });
  });
}

export async function restoreOrdinaryUser(
  database: Database,
  actor: AdminActor,
  input: {
    userId: string;
  },
): Promise<void> {
  rejectSelfTarget(actor, input.userId);

  await database.transaction(async (transaction) => {
    await requireAdminWrite(transaction, actor);
    const [target] = await transaction
      .select({ id: user.id, role: user.role, banned: user.banned })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update")
      .limit(1);

    if (!target || target.role !== "user") {
      throw new Error("Only ordinary users can be managed");
    }
    if (target.banned !== true) {
      throw new Error("User is already active");
    }

    await transaction
      .update(user)
      .set({
        banned: false,
        banReason: null,
        banExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, input.userId));
    await recordAdminAudit(transaction, actor, {
      action: "user.restore",
      targetType: "user",
      targetId: input.userId,
      metadata: { previousState: "disabled", nextState: "active" },
    });
  });
}
