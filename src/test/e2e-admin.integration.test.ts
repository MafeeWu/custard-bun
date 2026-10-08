// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { account, session, user } from "@/server/db/auth-schema";
import { character } from "@/server/db/character-schema";
import { createDatabase } from "@/server/db/client";
import { testDatabaseUrl } from "./database-target";
import {
  cleanupAdminTestData,
  createAdminTestDatabase,
  promoteVerifiedTestUser,
} from "../../tests/e2e/support/admin";

const database = createAdminTestDatabase(testDatabaseUrl());
const userIds: string[] = [];
const characterIds: string[] = [];

async function insertUser(verified = true) {
  const id = randomUUID();
  userIds.push(id);
  const email = `support-${id}@example.com`;
  await database.insert(user).values({
    id,
    email,
    name: "E2E support",
    emailVerified: verified,
    role: "user",
  });
  await database.insert(session).values({
    id: randomUUID(),
    token: randomUUID(),
    userId: id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { id, email };
}

afterAll(async () => {
  await database.delete(character).where(inArray(character.id, characterIds));
  await database.delete(user).where(inArray(user.id, userIds));
  await database.$client.end();
});

test.each([
  "postgresql://example.com/companion_test",
  "postgresql://127.0.0.1/production",
  "postgresql://127.0.0.1/companion_test?host=example.com",
])("rejects unsafe admin bootstrap database %s before connecting", (url) => {
  expect(() => createAdminTestDatabase(url)).toThrow(/loopback.*_test/);
});

test("promotes only the verified target and revokes only its existing sessions", async () => {
  const target = await insertUser();
  const other = await insertUser();
  await promoteVerifiedTestUser(database, target.email);
  const users = await database
    .select()
    .from(user)
    .where(inArray(user.id, [target.id, other.id]));
  expect(users.find((row) => row.id === target.id)?.role).toBe("admin");
  expect(users.find((row) => row.id === other.id)?.role).toBe("user");
  const sessions = await database
    .select()
    .from(session)
    .where(inArray(session.userId, [target.id, other.id]));
  expect(sessions.map((row) => row.userId)).toEqual([other.id]);
});

test("does not promote unverified or missing users", async () => {
  const target = await insertUser(false);
  await expect(promoteVerifiedTestUser(database, target.email)).rejects.toThrow(
    /verified/,
  );
  await expect(
    promoteVerifiedTestUser(database, `missing-${randomUUID()}@example.com`),
  ).rejects.toThrow(/verified/);
  const [unchanged] = await database
    .select()
    .from(user)
    .where(eq(user.id, target.id));
  expect(unchanged?.role).toBe("user");
});

test("refuses a database not opened by the guarded factory", async () => {
  const unguarded = createDatabase(testDatabaseUrl());
  try {
    await expect(
      promoteVerifiedTestUser(unguarded, "unused@example.com"),
    ).rejects.toThrow(/guarded/);
    await expect(cleanupAdminTestData(unguarded, [], [])).rejects.toThrow(
      /guarded/,
    );
  } finally {
    await unguarded.$client.end();
  }
});

test("cleanup retires only owned fixtures without deleting character history or unrelated sessions", async () => {
  const target = await insertUser();
  const other = await insertUser();
  await promoteVerifiedTestUser(database, target.email);
  await database.insert(session).values({
    id: randomUUID(),
    token: randomUUID(),
    userId: target.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await database.insert(account).values({
    id: randomUUID(),
    userId: target.id,
    accountId: target.id,
    providerId: "credential",
    password: "test-hash",
  });
  const id = randomUUID();
  const slug = `e2e-${id}`;
  const unrelatedId = randomUUID();
  const unrelatedSlug = `e2e-${unrelatedId}`;
  characterIds.push(id, unrelatedId);
  await database.insert(character).values([
    { id, slug, createdBy: target.id },
    { id: unrelatedId, slug: unrelatedSlug, createdBy: other.id },
  ]);
  await cleanupAdminTestData(database, [target.email], [slug, unrelatedSlug]);
  const [retired] = await database
    .select()
    .from(user)
    .where(eq(user.id, target.id));
  expect(retired).toMatchObject({ role: "user", banned: true });
  expect(
    await database.select().from(session).where(eq(session.userId, target.id)),
  ).toEqual([]);
  expect(
    await database.select().from(account).where(eq(account.userId, target.id)),
  ).toEqual([]);
  const [archived] = await database
    .select()
    .from(character)
    .where(eq(character.id, id));
  expect(archived).toMatchObject({
    lifecycle: "archived",
    createdBy: target.id,
  });
  expect(archived?.archivedAt).toBeInstanceOf(Date);
  const [unrelated] = await database
    .select()
    .from(character)
    .where(eq(character.id, unrelatedId));
  expect(unrelated).toMatchObject({ lifecycle: "active", archivedAt: null });
  expect(
    await database.select().from(session).where(eq(session.userId, other.id)),
  ).toHaveLength(1);
});
