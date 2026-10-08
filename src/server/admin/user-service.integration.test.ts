// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { adminAuditEvent } from "@/server/db/audit-schema";
import { session, user } from "@/server/db/auth-schema";
import { testDatabaseUrl } from "@/test/database-target";
import type { AdminActor } from "./admin-actor";
import { disableOrdinaryUser, restoreOrdinaryUser } from "./user-service";

const database = createDatabase(testDatabaseUrl());
const actor: AdminActor = {
  userId: "admin-1",
  label: "admin@example.com",
  operationId: "operation-1",
};

beforeEach(async () => {
  await database.execute(sql`
    TRUNCATE TABLE admin_audit_events, session, account, "user"
    RESTART IDENTITY CASCADE
  `);
  await database.insert(user).values([
    {
      id: actor.userId,
      name: "Admin",
      email: actor.label,
      emailVerified: true,
      role: "admin",
    },
    {
      id: "ordinary-1",
      name: "Ordinary",
      email: "ordinary@example.com",
      emailVerified: true,
      role: "user",
    },
    {
      id: "admin-2",
      name: "Other Admin",
      email: "other-admin@example.com",
      emailVerified: true,
      role: "admin",
    },
    {
      id: "future-1",
      name: "Future Role",
      email: "future@example.com",
      emailVerified: true,
      role: "moderator",
    },
  ]);
});

afterAll(async () => {
  await database.$client.end();
});

async function getUser(id: string) {
  const [row] = await database.select().from(user).where(eq(user.id, id));
  return row!;
}

test("disables an ordinary user, deletes sessions, and audits without reason text", async () => {
  await database.insert(session).values([
    {
      id: "target-session-1",
      token: "target-token-1",
      userId: "ordinary-1",
      expiresAt: new Date("2026-10-09T00:00:00Z"),
    },
    {
      id: "target-session-2",
      token: "target-token-2",
      userId: "ordinary-1",
      expiresAt: new Date("2026-10-09T00:00:00Z"),
    },
    {
      id: "admin-session",
      token: "admin-token",
      userId: actor.userId,
      expiresAt: new Date("2026-10-09T00:00:00Z"),
    },
  ]);

  await disableOrdinaryUser(database, actor, {
    userId: "ordinary-1",
    reason: "  Repeated abuse of instance rules  ",
  });

  const target = await getUser("ordinary-1");
  expect(target.banned).toBe(true);
  expect(target.banReason).toBe("Repeated abuse of instance rules");
  const remainingSessions = await database.select().from(session);
  expect(remainingSessions).toHaveLength(1);
  expect(remainingSessions[0]!.userId).toBe(actor.userId);

  const events = await database.select().from(adminAuditEvent);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: "user.disable",
    targetType: "user",
    targetId: "ordinary-1",
    operationId: actor.operationId,
    metadata: { previousState: "active", nextState: "disabled" },
  });
  expect(JSON.stringify(events)).not.toContain("Repeated abuse");
});

test.each([
  { title: "empty reason", reason: "   " },
  { title: "over-500-character reason", reason: "a".repeat(501) },
])("rejects $title before mutating", async ({ reason }) => {
  await expect(
    disableOrdinaryUser(database, actor, { userId: "ordinary-1", reason }),
  ).rejects.toThrow("Disable reason must be 1-500 characters");

  const target = await getUser("ordinary-1");
  expect(target.banned).not.toBe(true);
  expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
});

test("rejects self-target, administrators, future roles, and already-disabled users", async () => {
  await database.insert(user).values({
    id: "disabled-1",
    name: "Disabled",
    email: "disabled@example.com",
    emailVerified: true,
    role: "user",
    banned: true,
    banReason: "existing",
  });

  await expect(
    disableOrdinaryUser(database, actor, {
      userId: actor.userId,
      reason: "valid",
    }),
  ).rejects.toThrow("Administrators cannot manage their own account");
  await expect(
    disableOrdinaryUser(database, actor, {
      userId: "admin-2",
      reason: "valid",
    }),
  ).rejects.toThrow("Only ordinary users can be managed");
  await expect(
    disableOrdinaryUser(database, actor, {
      userId: "future-1",
      reason: "valid",
    }),
  ).rejects.toThrow("Only ordinary users can be managed");
  await expect(
    disableOrdinaryUser(database, actor, {
      userId: "disabled-1",
      reason: "valid",
    }),
  ).rejects.toThrow("User is already disabled");

  expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
});

test("rolls back ban fields and session deletion when audit insertion fails", async () => {
  await database.insert(session).values({
    id: "target-session-1",
    token: "target-token-1",
    userId: "ordinary-1",
    expiresAt: new Date("2026-10-09T00:00:00Z"),
  });
  const invalidAuditActor: AdminActor = {
    userId: actor.userId,
    label: null as never,
    operationId: "operation-fails",
  };

  await expect(
    disableOrdinaryUser(database, invalidAuditActor, {
      userId: "ordinary-1",
      reason: "Repeated abuse of instance rules",
    }),
  ).rejects.toThrow();

  const target = await getUser("ordinary-1");
  expect(target.banned).not.toBe(true);
  expect(target.banReason).toBeNull();
  expect(await database.select().from(session)).toHaveLength(1);
  expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
});

test("restores a disabled ordinary user and rejects already-active restores", async () => {
  await database
    .update(user)
    .set({
      banned: true,
      banReason: "Better Auth ban reason",
      banExpires: new Date("2026-10-09T00:00:00Z"),
    })
    .where(eq(user.id, "ordinary-1"));

  await restoreOrdinaryUser(database, actor, { userId: "ordinary-1" });

  const target = await getUser("ordinary-1");
  expect(target.banned).toBe(false);
  expect(target.banReason).toBeNull();
  expect(target.banExpires).toBeNull();
  await expect(
    restoreOrdinaryUser(database, actor, { userId: "ordinary-1" }),
  ).rejects.toThrow("User is already active");

  const events = await database.select().from(adminAuditEvent);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    action: "user.restore",
    targetType: "user",
    targetId: "ordinary-1",
    metadata: { previousState: "disabled", nextState: "active" },
  });
});

test.each(
  (["disable", "restore"] as const).flatMap((operation) =>
    (
      ["ordinary", "disabled", "demoted", "combined-role", "missing"] as const
    ).map((actorState) => ({ operation, actorState })),
  ),
)(
  "$operation rejects a $actorState actor without modifying users or sessions",
  async ({ operation, actorState }) => {
    const candidate = {
      userId: "candidate",
      label: "candidate@example.com",
      operationId: "untrusted-actor",
    };
    if (actorState !== "missing") {
      await database.insert(user).values({
        id: candidate.userId,
        name: "Candidate",
        email: candidate.label,
        role:
          actorState === "ordinary"
            ? "user"
            : actorState === "combined-role"
              ? "admin,user"
              : "admin",
        banned: actorState === "disabled",
      });
    }
    if (actorState === "demoted") {
      await database
        .update(user)
        .set({ role: "user" })
        .where(eq(user.id, candidate.userId));
    }
    await database.insert(session).values({
      id: "preserved-session",
      token: "preserved-token",
      userId: "ordinary-1",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    if (operation === "restore") {
      await database
        .update(user)
        .set({ banned: true })
        .where(eq(user.id, "ordinary-1"));
    }
    const beforeUser = await getUser("ordinary-1");
    const beforeSessions = await database.select().from(session);
    const result =
      operation === "disable"
        ? disableOrdinaryUser(database, candidate, {
            userId: "ordinary-1",
            reason: "Valid reason",
          })
        : restoreOrdinaryUser(database, candidate, { userId: "ordinary-1" });

    await expect(result).rejects.toThrow("Administrator access required");
    expect(await getUser("ordinary-1")).toEqual(beforeUser);
    expect(await database.select().from(session)).toEqual(beforeSessions);
    expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
  },
);
