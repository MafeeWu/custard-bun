// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { user } from "@/server/db/auth-schema";
import { testDatabaseUrl } from "@/test/database-target";
import { listOrdinaryUsers } from "./user-queries";

const database = createDatabase(testDatabaseUrl());

beforeEach(async () => {
  await database.execute(sql`
    TRUNCATE TABLE admin_audit_events, session, account, "user"
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await database.$client.end();
});

test("lists only exact ordinary users with safe fields in deterministic order", async () => {
  await database.insert(user).values([
    {
      id: "ordinary-b",
      name: "Beta User",
      email: "beta@example.com",
      emailVerified: true,
      role: "user",
      banned: true,
      banReason: "sensitive moderation reason",
      createdAt: new Date("2026-10-08T09:00:00Z"),
    },
    {
      id: "ordinary-c",
      name: "Gamma User",
      email: "gamma@example.com",
      emailVerified: true,
      role: "user",
      banned: false,
      createdAt: new Date("2026-10-08T09:00:00Z"),
    },
    {
      id: "ordinary-a",
      name: "Alpha User",
      email: "alpha@example.com",
      emailVerified: true,
      role: "user",
      banned: false,
      createdAt: new Date("2026-10-08T08:00:00Z"),
    },
    {
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      emailVerified: true,
      role: "admin",
      createdAt: new Date("2026-10-08T10:00:00Z"),
    },
    {
      id: "future-role-1",
      name: "Future",
      email: "future@example.com",
      emailVerified: true,
      role: "moderator",
      createdAt: new Date("2026-10-08T11:00:00Z"),
    },
    {
      id: "unknown-role-1",
      name: "Unknown",
      email: "unknown@example.com",
      emailVerified: true,
      role: null,
      createdAt: new Date("2026-10-08T12:00:00Z"),
    },
  ]);

  const result = await listOrdinaryUsers(database, { page: 1, pageSize: 25 });

  expect(result.total).toBe(3);
  expect(result.users).toEqual([
    {
      id: "ordinary-c",
      name: "Gamma User",
      email: "gamma@example.com",
      createdAt: new Date("2026-10-08T09:00:00Z"),
      banned: false,
    },
    {
      id: "ordinary-b",
      name: "Beta User",
      email: "beta@example.com",
      createdAt: new Date("2026-10-08T09:00:00Z"),
      banned: true,
    },
    {
      id: "ordinary-a",
      name: "Alpha User",
      email: "alpha@example.com",
      createdAt: new Date("2026-10-08T08:00:00Z"),
      banned: false,
    },
  ]);
  expect(Object.keys(result.users[1]!)).toEqual([
    "id",
    "name",
    "email",
    "createdAt",
    "banned",
  ]);
  expect(JSON.stringify(result.users)).not.toContain(
    "sensitive moderation reason",
  );
});

test("searches ordinary users by email or name case-insensitively", async () => {
  await database.insert(user).values([
    {
      id: "ordinary-1",
      name: "Mixed Case Name",
      email: "person@example.com",
      emailVerified: true,
      role: "user",
    },
    {
      id: "ordinary-2",
      name: "Other",
      email: "SEARCH-HIT@example.com",
      emailVerified: true,
      role: "user",
    },
    {
      id: "ordinary-3",
      name: "No Match",
      email: "miss@example.com",
      emailVerified: true,
      role: "user",
    },
  ]);

  await expect(
    listOrdinaryUsers(database, { query: "mixed case", page: 1, pageSize: 25 }),
  ).resolves.toMatchObject({
    users: [expect.objectContaining({ id: "ordinary-1" })],
    total: 1,
  });
  await expect(
    listOrdinaryUsers(database, { query: "search-hit", page: 1, pageSize: 25 }),
  ).resolves.toMatchObject({
    users: [expect.objectContaining({ id: "ordinary-2" })],
    total: 1,
  });
});

test("enforces the 25 row page size", async () => {
  await database.insert(user).values(
    Array.from({ length: 26 }, (_, index) => ({
      id: `ordinary-${index.toString().padStart(2, "0")}`,
      name: `User ${index}`,
      email: `user-${index}@example.com`,
      emailVerified: true,
      role: "user",
      createdAt: new Date(
        `2026-10-08T00:${index.toString().padStart(2, "0")}:00Z`,
      ),
    })),
  );

  const firstPage = await listOrdinaryUsers(database, {
    page: 1,
    pageSize: 25,
  });
  const secondPage = await listOrdinaryUsers(database, {
    page: 2,
    pageSize: 25,
  });

  expect(firstPage.users).toHaveLength(25);
  expect(firstPage.total).toBe(26);
  expect(secondPage.users).toHaveLength(1);
  await expect(
    listOrdinaryUsers(database, { page: 1, pageSize: 10 as 25 }),
  ).rejects.toThrow("User page size must be 25");
});
