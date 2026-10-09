// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  adminAuditActionEnum,
  adminAuditEvent,
  type AdminAuditAction,
} from "@/server/db/audit-schema";
import { user } from "@/server/db/auth-schema";
import { testDatabaseUrl } from "@/test/database-target";
import { recordAdminAudit } from "./audit";

const database = createDatabase(testDatabaseUrl());

const expectedActions = [
  "character.create",
  "character.draft.save",
  "character.version.publish",
  "character.default.change",
  "character.archive",
  "character.restore",
  "user.disable",
  "user.restore",
  "chat.settings.update",
  "chat.settings.reset",
  "user.chat_quota.update",
  "user.chat_quota.clear",
] satisfies AdminAuditAction[];

beforeEach(async () => {
  await database.execute(sql`
    TRUNCATE TABLE admin_audit_events, "user"
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await database.$client.end();
});

test("the audit action enum matches the administrator contract", () => {
  expect([...adminAuditActionEnum.enumValues]).toEqual(expectedActions);
});

test("writes audit events inside the caller transaction and rolls back with it", async () => {
  const actor = {
    userId: "admin-1",
    label: "a@example.com",
    operationId: "op-1",
  };
  await database.insert(user).values({
    id: actor.userId,
    name: "Admin",
    email: actor.label,
    emailVerified: true,
    role: "admin",
  });

  await expect(
    database.transaction(async (transaction) => {
      await recordAdminAudit(transaction, actor, {
        action: "character.create",
        targetType: "character",
        targetId: "character-1",
        metadata: {
          status: "draft",
          revision: 1,
          approved: false,
          note: null,
        },
      });
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");

  expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
});

test.each([
  {
    title: "rejects nested audit metadata",
    metadata: { nested: { value: true } },
  },
  {
    title: "rejects sensitive audit metadata keys",
    metadata: { Prompt: "secret" },
  },
  {
    title: "rejects audit metadata with too many keys",
    metadata: Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`key-${index}`, index]),
    ),
  },
])("$title", async ({ metadata }) => {
  const actor = {
    userId: "admin-2",
    label: "admin@example.com",
    operationId: "op-2",
  };
  await database.insert(user).values({
    id: actor.userId,
    name: "Admin",
    email: actor.label,
    emailVerified: true,
    role: "admin",
  });

  await expect(
    recordAdminAudit(database, actor, {
      action: "character.create",
      targetType: "character",
      targetId: "character-1",
      metadata: metadata as never,
    }),
  ).rejects.toThrow();

  expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
});
