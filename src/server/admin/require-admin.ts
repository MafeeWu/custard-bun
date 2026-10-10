import "server-only";

import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth";
import { toAdminActor, type AdminActor } from "./admin-actor";

export async function requireAdmin(headers: Headers): Promise<AdminActor> {
  const operationId = randomUUID();
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });

  if (
    !session ||
    session.user.banned === true ||
    session.user.deletionPendingAt
  ) {
    redirect("/auth/sign-in");
  }

  if (session.user.role !== "admin") {
    notFound();
  }

  return toAdminActor(session, operationId);
}
