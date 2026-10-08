import "server-only";

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { user } from "@/server/db/auth-schema";

export interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  banned: boolean;
}

export async function listOrdinaryUsers(
  database: Database,
  input: {
    query?: string;
    page: number;
    pageSize: 25;
  },
): Promise<{ users: AdminUserSummary[]; total: number }> {
  if (input.pageSize !== 25) {
    throw new Error("User page size must be 25");
  }

  const page = Math.max(1, Math.trunc(input.page));
  const query = input.query?.trim();
  const searchPredicate = query
    ? or(ilike(user.email, `%${query}%`), ilike(user.name, `%${query}%`))
    : undefined;
  const where = searchPredicate
    ? and(eq(user.role, "user"), searchPredicate)
    : eq(user.role, "user");

  const rows = await database
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      banned: user.banned,
    })
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt), desc(user.id))
    .limit(input.pageSize)
    .offset((page - 1) * input.pageSize);

  const [countRow] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(user)
    .where(where);

  return {
    users: rows.map((row) => ({ ...row, banned: row.banned === true })),
    total: countRow?.total ?? 0,
  };
}
