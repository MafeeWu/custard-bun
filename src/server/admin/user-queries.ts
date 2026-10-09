import "server-only";

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { user } from "@/server/db/auth-schema";
import { quotaBucket, userChatQuotaOverride } from "@/server/db/chat-schema";
import { userPeriod } from "@/server/chat/quota-service";

export interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  banned: boolean;
  dailyRequestLimit: number | null;
  dailyTokenLimit: number | null;
  currentPeriodRequests: number;
  currentPeriodTokens: number;
}

export async function listOrdinaryUsers(
  database: Database,
  input: {
    query?: string;
    page: number;
    pageSize: 25;
    now?: Date;
  },
): Promise<{ users: AdminUserSummary[]; total: number }> {
  if (input.pageSize !== 25) {
    throw new Error("User page size must be 25");
  }

  const page = Math.max(1, Math.trunc(input.page));
  const period = userPeriod(input.now ?? new Date());
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
      dailyRequestLimit: userChatQuotaOverride.dailyRequestLimit,
      dailyTokenLimit: userChatQuotaOverride.dailyTokenLimit,
      currentPeriodRequests: sql<number>`
        coalesce(${quotaBucket.consumedRequests}, 0)
        + coalesce(${quotaBucket.reservedRequests}, 0)
      `,
      currentPeriodTokens: sql<number>`
        coalesce(${quotaBucket.consumedTokens}, 0)
        + coalesce(${quotaBucket.reservedTokens}, 0)
      `,
    })
    .from(user)
    .leftJoin(userChatQuotaOverride, eq(userChatQuotaOverride.userId, user.id))
    .leftJoin(
      quotaBucket,
      and(
        eq(quotaBucket.scope, "user"),
        eq(quotaBucket.userId, user.id),
        eq(quotaBucket.periodStart, period.start),
      ),
    )
    .where(where)
    .orderBy(desc(user.createdAt), desc(user.id))
    .limit(input.pageSize)
    .offset((page - 1) * input.pageSize);

  const [countRow] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(user)
    .where(where);

  return {
    users: rows.map((row) => ({
      ...row,
      banned: row.banned === true,
      currentPeriodRequests: Number(row.currentPeriodRequests),
      currentPeriodTokens: Number(row.currentPeriodTokens),
    })),
    total: countRow?.total ?? 0,
  };
}
