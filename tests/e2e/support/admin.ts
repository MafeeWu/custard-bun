import type { Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase, type Database } from "../../../src/server/db/client";
import { account, session, user } from "../../../src/server/db/auth-schema";
import { character } from "../../../src/server/db/character-schema";
import { testDatabaseUrl } from "../../../src/test/database-target";
import { waitForActionUrl } from "../helpers/mailbox";

const guardedDatabases = new WeakSet<Database>();

export function createAdminTestDatabase(databaseUrl: string): Database {
  const database = createDatabase(
    testDatabaseUrl({ TEST_DATABASE_URL: databaseUrl }),
  );
  guardedDatabases.add(database);
  return database;
}

function requireGuardedDatabase(database: Database) {
  if (!guardedDatabases.has(database)) {
    throw new Error("Admin E2E helpers require a guarded test database");
  }
}

export async function promoteVerifiedTestUser(
  database: Database,
  email: string,
): Promise<void> {
  requireGuardedDatabase(database);
  await database.transaction(async (tx) => {
    const [target] = await tx
      .update(user)
      .set({ role: "admin", updatedAt: new Date() })
      .where(
        and(
          eq(user.email, email),
          eq(user.emailVerified, true),
          eq(user.role, "user"),
        ),
      )
      .returning({ id: user.id });
    if (!target) throw new Error("Expected one verified ordinary test user");
    await tx.delete(session).where(eq(session.userId, target.id));
  });
}

export async function cleanupAdminTestData(
  database: Database,
  emails: string[],
  slugs: string[],
): Promise<void> {
  requireGuardedDatabase(database);
  await database.transaction(async (tx) => {
    const users = emails.length
      ? await tx
          .select({ id: user.id })
          .from(user)
          .where(inArray(user.email, emails))
      : [];
    const ids = users.map(({ id }) => id);
    if (ids.length && slugs.length) {
      await tx
        .update(character)
        .set({
          lifecycle: "archived",
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(character.slug, slugs),
            inArray(character.createdBy, ids),
          ),
        );
    }
    if (ids.length) {
      await tx.delete(session).where(inArray(session.userId, ids));
      await tx.delete(account).where(inArray(account.userId, ids));
      // Keep publisher identities: deleting them would update immutable versions via the FK.
      await tx
        .update(user)
        .set({
          role: "user",
          banned: true,
          banReason: null,
          banExpires: null,
          updatedAt: new Date(),
        })
        .where(inArray(user.id, ids));
    }
  });
}

export async function bootstrapAdmin(
  page: Page,
  email: string,
  password: string,
  database: Database,
): Promise<void> {
  requireGuardedDatabase(database);
  const existing = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  if (existing.length)
    throw new Error("Admin bootstrap requires a unique test email");

  await page.goto("/auth/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("E2E administrator");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByText(/check your email/i).waitFor();
  await page.goto(await waitForActionUrl(email, "Verify your"));
  await promoteVerifiedTestUser(database, email);
  await page.context().clearCookies();
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/app$/);
}
