// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { adminAuditEvent } from "@/server/db/audit-schema";
import { session, user } from "@/server/db/auth-schema";
import {
  character,
  characterVersion,
  chatSettings,
  conversation,
  conversationMessage,
  generationAttempt,
  generationLease,
  memorySettings,
  quotaBucket,
  quotaReservation,
} from "@/server/db/schema";
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
  await database
    .insert(chatSettings)
    .values({
      id: "global",
      userDailyRequestLimit: 10,
      userDailyTokenLimit: 10_000,
      instanceMonthlyRequestLimit: 100,
      instanceMonthlyTokenBudget: 100_000,
      maxConcurrentGenerations: 2,
      deploymentDefaultUserDailyRequestLimit: 10,
      deploymentDefaultUserDailyTokenLimit: 10_000,
      deploymentDefaultInstanceMonthlyRequestLimit: 100,
      deploymentDefaultInstanceMonthlyTokenBudget: 100_000,
      deploymentDefaultMaxConcurrentGenerations: 2,
    })
    .onConflictDoNothing();
  await database
    .insert(memorySettings)
    .values({
      id: "global",
      enabled: true,
      deploymentDefaultEnabled: true,
    })
    .onConflictDoNothing();
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

test("requests cancellation before revoking sessions without releasing active quota", async () => {
  const now = new Date("2026-10-09T14:00:00Z");
  await database.insert(session).values({
    id: "target-session",
    token: "target-token",
    userId: "ordinary-1",
    expiresAt: new Date("2026-10-10T00:00:00Z"),
  });
  await database.insert(character).values({
    id: "character-1",
    slug: "listener",
  });
  await database.insert(characterVersion).values({
    id: "version-1",
    characterId: "character-1",
    versionNumber: 1,
    displayName: "Listener",
    avatarPath: "/listener.png",
    shortDescription: "Short",
    longDescription: "Long",
    personalityPrinciples: ["Kind"],
    speakingStyle: "Warm",
    responseRhythm: "Measured",
    relationshipBoundaries: ["No dependency"],
    openingMessage: "Hello",
    exampleConversations: [],
    generationParameters: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 100,
    },
    safetyAdditions: [],
    contentDigest: "a".repeat(64),
    publishedBy: "admin@example.com",
    publishedAt: now,
  });
  await database
    .update(character)
    .set({ defaultVersionId: "version-1" })
    .where(eq(character.id, "character-1"));
  await database.insert(conversation).values({
    id: "conversation-1",
    userId: "ordinary-1",
    characterId: "character-1",
    characterVersionId: "version-1",
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  });
  await database.insert(conversationMessage).values([
    {
      id: "user-message-1",
      conversationId: "conversation-1",
      sequence: 1,
      role: "user",
      kind: "user",
      content: "Hello",
      clientRequestId: "client-request-1",
      createdAt: now,
    },
    {
      id: "assistant-message-1",
      conversationId: "conversation-1",
      sequence: 2,
      role: "assistant",
      kind: "generated",
      inReplyTo: "user-message-1",
      createdAt: now,
    },
  ]);
  await database.insert(generationAttempt).values({
    id: "attempt-1",
    userId: "ordinary-1",
    assistantMessageId: "assistant-message-1",
    clientRequestId: "client-request-1",
    attemptNumber: 1,
    status: "streaming",
    content: "partial",
    modelId: "model-a",
    leaseExpiresAt: new Date("2026-10-09T14:05:00Z"),
    leaseOwner: "owner-1",
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(quotaBucket).values([
    {
      id: "user-bucket-1",
      scope: "user",
      userId: "ordinary-1",
      periodStart: new Date("2026-10-09T00:00:00Z"),
      periodEnd: new Date("2026-10-10T00:00:00Z"),
      reservedRequests: 1,
      reservedTokens: 500,
    },
    {
      id: "instance-bucket-1",
      scope: "instance",
      periodStart: new Date("2026-10-01T00:00:00Z"),
      periodEnd: new Date("2026-11-01T00:00:00Z"),
      reservedRequests: 1,
      reservedTokens: 500,
    },
  ]);
  await database.insert(quotaReservation).values({
    id: "reservation-1",
    userId: "ordinary-1",
    conversationId: "conversation-1",
    attemptId: "attempt-1",
    userBucketId: "user-bucket-1",
    instanceBucketId: "instance-bucket-1",
    reservedTokens: 500,
  });
  await database.insert(generationLease).values({
    attemptId: "attempt-1",
    userId: "ordinary-1",
    ownerToken: "owner-1",
    expiresAt: new Date("2026-10-09T14:05:00Z"),
    createdAt: now,
    updatedAt: now,
  });
  await database.execute(sql`
    CREATE OR REPLACE FUNCTION assert_generation_cancelled_before_session_delete()
    RETURNS trigger AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM generation_attempts
        WHERE user_id = OLD.user_id
          AND status IN ('pending', 'streaming')
          AND cancel_requested_at IS NULL
      ) THEN
        RAISE EXCEPTION 'active generation was not cancelled before session deletion';
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql
  `);
  await database.execute(sql`
    CREATE TRIGGER assert_generation_cancelled_before_session_delete
    BEFORE DELETE ON session
    FOR EACH ROW EXECUTE FUNCTION assert_generation_cancelled_before_session_delete()
  `);

  try {
    await disableOrdinaryUser(database, actor, {
      userId: "ordinary-1",
      reason: "Valid reason",
    });
  } finally {
    await database.execute(sql`
      DROP TRIGGER IF EXISTS assert_generation_cancelled_before_session_delete
      ON session
    `);
    await database.execute(sql`
      DROP FUNCTION IF EXISTS assert_generation_cancelled_before_session_delete()
    `);
  }

  expect(await database.select().from(session)).toHaveLength(0);
  expect(await database.select().from(generationAttempt)).toMatchObject([
    {
      id: "attempt-1",
      status: "streaming",
      cancelRequestedAt: expect.any(Date),
    },
  ]);
  expect(await database.select().from(generationLease)).toMatchObject([
    { attemptId: "attempt-1", ownerToken: "owner-1" },
  ]);
  expect(await database.select().from(quotaReservation)).toMatchObject([
    { id: "reservation-1", status: "active", reservedTokens: 500 },
  ]);
  expect(await database.select().from(quotaBucket)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "user-bucket-1",
        reservedRequests: 1,
        reservedTokens: 500,
        consumedRequests: 0,
        consumedTokens: 0,
      }),
      expect.objectContaining({
        id: "instance-bucket-1",
        reservedRequests: 1,
        reservedTokens: 500,
        consumedRequests: 0,
        consumedTokens: 0,
      }),
    ]),
  );
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
