// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { adminAuditEvent } from "@/server/db/audit-schema";
import { user } from "@/server/db/auth-schema";
import { testDatabaseUrl } from "@/test/database-target";
import { listAdminAuditEvents } from "./audit-queries";

const database = createDatabase(testDatabaseUrl());

beforeEach(async () => {
  await database.execute(sql`
    TRUNCATE TABLE admin_audit_events, session, account, "user"
    RESTART IDENTITY CASCADE
  `);
  await database.insert(user).values({
    id: "admin-1",
    name: "Admin",
    email: "admin@example.com",
    emailVerified: true,
    role: "admin",
  });
});

afterAll(async () => {
  await database.$client.end();
});

test("lists paginated audit summaries without joining private auth data", async () => {
  await database.insert(adminAuditEvent).values([
    {
      id: "event-1",
      actorUserId: "admin-1",
      actorLabel: "Copied Label",
      action: "user.disable",
      targetType: "user",
      targetId: "ordinary-1",
      metadata: { previousState: "active", nextState: "disabled" },
      operationId: "op-1",
      createdAt: new Date("2026-10-08T01:00:00Z"),
    },
    {
      id: "event-2",
      actorUserId: null,
      actorLabel: "Deleted Admin Label",
      action: "user.restore",
      targetType: "user",
      targetId: "ordinary-1",
      metadata: { previousState: "disabled", nextState: "active" },
      operationId: "op-2",
      createdAt: new Date("2026-10-08T02:00:00Z"),
    },
  ]);

  const result = await listAdminAuditEvents(database, {
    page: 1,
    pageSize: 50,
  });

  expect(result.total).toBe(2);
  expect(result.events).toEqual([
    {
      actorLabel: "Deleted Admin Label",
      action: "user.restore",
      targetType: "user",
      targetId: "ordinary-1",
      metadata: { previousState: "disabled", nextState: "active" },
      operationId: "op-2",
      createdAt: new Date("2026-10-08T02:00:00Z"),
    },
    {
      actorLabel: "Copied Label",
      action: "user.disable",
      targetType: "user",
      targetId: "ordinary-1",
      metadata: { previousState: "active", nextState: "disabled" },
      operationId: "op-1",
      createdAt: new Date("2026-10-08T01:00:00Z"),
    },
  ]);
  expect(Object.keys(result.events[0]!)).toEqual([
    "actorLabel",
    "action",
    "targetType",
    "targetId",
    "metadata",
    "operationId",
    "createdAt",
  ]);
});

test("enforces the 50 row audit page size", async () => {
  await expect(
    listAdminAuditEvents(database, { page: 1, pageSize: 25 as 50 }),
  ).rejects.toThrow("Audit page size must be 50");
});
