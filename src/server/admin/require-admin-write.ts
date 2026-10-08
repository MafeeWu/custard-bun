import "server-only";

import { eq } from "drizzle-orm";
import { user } from "@/server/db/auth-schema";
import type { Database } from "@/server/db/client";
import type { AdminActor } from "./admin-actor";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function requireAdminWrite(
  transaction: Transaction,
  actor: AdminActor,
): Promise<void> {
  const [current] = await transaction
    .select({ role: user.role, banned: user.banned })
    .from(user)
    .where(eq(user.id, actor.userId))
    .for("share")
    .limit(1);

  if (current?.role !== "admin" || current.banned === true) {
    throw new Error("Administrator access required");
  }
}
