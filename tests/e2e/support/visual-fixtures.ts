import { createHash } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { eq } from "drizzle-orm";
import { user } from "../../../src/server/db/auth-schema";
import {
  character,
  characterVersion,
} from "../../../src/server/db/character-schema";
import {
  conversation,
  conversationMessage,
} from "../../../src/server/db/chat-schema";
import { seedOfficialCharacters } from "../../../src/server/characters/seed-characters";
import {
  dataExportJob,
  memoryItem,
  userCharacterMemorySetting,
} from "../../../src/server/db/memory-schema";
import type { Database } from "../../../src/server/db/client";
import { createAdminTestDatabase, promoteVerifiedTestUser } from "./admin";
import { registerAndSignIn, resetFakeModel } from "./chat";
import { e2eEnvironment } from "./environment";

export const visualFixtureValues = {
  providerKey: "task12_visual_provider_key_19b4df2d9a4d4ff0",
  providerEndpoint: "task12-visual-provider-endpoint-7d4de48a",
  email: "task12-visual-private-user@example.invalid",
  userId: "task12_visual_user_id_8de0fb6a",
  privateMessage: "task12_visual_private_message_324c850d",
  memoryContent: "task12_visual_private_memory_d9c318dd",
  exportId: "task12_visual_export_id_862b4067",
  rawError: "task12_visual_raw_error_17a454df",
} as const;

export const visualPrivacySentinels = Object.freeze(
  Object.values(visualFixtureValues),
) as readonly string[];

export const visualBrandName =
  "Clear Daylight Companion Space For Thoughtful Private Chats!";
export const longCharacterName =
  "Thoughtful Companion for Long Names, Calm Reflection, and Patient Conversations.";

const visualPassword = "visual fixture correct horse battery staple";
const longCharacterId = "task12-visual-long-character";
const longCharacterVersionId = "task12-visual-long-character-v1";
const longCharacterSlug = "visual-long-name";
const sentinelConversationId = "task12-visual-private-conversation";
const sentinelMessageId = "task12-visual-private-message";
const sentinelMemoryId = "task12-visual-private-memory";

export function visualUserEmail(projectName: string): string {
  return `visual-${projectName.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}@example.com`;
}

async function resetVisualDatabaseState(database: Database) {
  const client = database.$client;
  await client.query('TRUNCATE TABLE "user" CASCADE');
  await client.query("TRUNCATE TABLE rate_limit, verification");
  await seedOfficialCharacters(database);
}

async function replaceLongCharacter(database: Database) {
  const [existing] = await database
    .select({ id: character.id })
    .from(character)
    .where(eq(character.slug, longCharacterSlug));
  if (existing) {
    const [version] = await database
      .select({ id: characterVersion.id })
      .from(characterVersion)
      .where(eq(characterVersion.id, longCharacterVersionId));
    if (!version) {
      throw new Error("Visual long-character fixture is incomplete");
    }
    await database
      .update(character)
      .set({
        defaultVersionId: longCharacterVersionId,
        lifecycle: "active",
        archivedAt: null,
      })
      .where(eq(character.id, existing.id));
    return;
  }

  const [sourceCharacter] = await database
    .select()
    .from(character)
    .where(eq(character.slug, "calm-listener"));
  if (!sourceCharacter?.defaultVersionId) {
    throw new Error("Visual fixtures require the calm-listener seed");
  }
  const [sourceVersion] = await database
    .select()
    .from(characterVersion)
    .where(eq(characterVersion.id, sourceCharacter.defaultVersionId));
  if (!sourceVersion) {
    throw new Error("Visual fixtures require the calm-listener version");
  }

  const publishedAt = new Date("2026-10-13T12:00:00.000Z");
  await database.insert(character).values({
    id: longCharacterId,
    slug: longCharacterSlug,
    lifecycle: "active",
    createdAt: publishedAt,
    updatedAt: publishedAt,
  });
  await database.insert(characterVersion).values({
    ...sourceVersion,
    id: longCharacterVersionId,
    characterId: longCharacterId,
    versionNumber: 1,
    displayName: longCharacterName,
    contentDigest: createHash("sha256")
      .update(`visual:${longCharacterName}`)
      .digest("hex"),
    publishedBy: null,
    publishedAt,
  });
  await database
    .update(character)
    .set({
      defaultVersionId: longCharacterVersionId,
      updatedAt: publishedAt,
    })
    .where(eq(character.id, longCharacterId));
}

async function injectPrivateDecoy(database: Database) {
  const [seed] = await database
    .select({
      characterId: character.id,
      versionId: character.defaultVersionId,
    })
    .from(character)
    .where(eq(character.slug, "energetic-friend"));
  if (!seed?.versionId) {
    throw new Error("Visual fixtures require the energetic-friend seed");
  }
  const now = new Date("2026-10-13T11:00:00.000Z");
  await database.insert(user).values({
    id: visualFixtureValues.userId,
    name: "Private decoy",
    email: "visual-private-decoy@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(conversation).values({
    id: sentinelConversationId,
    userId: visualFixtureValues.userId,
    characterId: seed.characterId,
    characterVersionId: seed.versionId,
    lifecycle: "active",
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  });
  await database.insert(conversationMessage).values({
    id: sentinelMessageId,
    conversationId: sentinelConversationId,
    sequence: 1,
    role: "user",
    kind: "user",
    content: `${visualFixtureValues.email} ${visualFixtureValues.privateMessage}`,
    clientRequestId: "task12-visual-private-request",
    createdAt: now,
  });
  await database.insert(userCharacterMemorySetting).values({
    userId: visualFixtureValues.userId,
    characterId: seed.characterId,
    recordingEnabled: true,
    usageEnabled: true,
    memoryEpoch: 0,
    memoryRevision: 0,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(memoryItem).values({
    id: sentinelMemoryId,
    userId: visualFixtureValues.userId,
    characterId: seed.characterId,
    memoryEpoch: 0,
    type: "preference",
    content: visualFixtureValues.memoryContent,
    normalizedContent: visualFixtureValues.memoryContent,
    normalizedDigest: createHash("sha256")
      .update(visualFixtureValues.memoryContent)
      .digest("hex"),
    isActive: true,
    origin: "automatic",
    sensitivity: "ordinary",
    explicitness: "direct",
    confidence: 100,
    importance: 50,
    firstObservedAt: now,
    lastConfirmedAt: now,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  });
}

export async function resetVisualFixtures(projectName: string): Promise<{
  database: Database;
  email: string;
  password: string;
  longCharacterSlug: string;
}> {
  const database = createAdminTestDatabase(e2eEnvironment.TEST_DATABASE_URL!);
  const email = visualUserEmail(projectName);
  await resetVisualDatabaseState(database);
  await replaceLongCharacter(database);
  await injectPrivateDecoy(database);
  await resetFakeModel();
  return {
    database,
    email,
    password: visualPassword,
    longCharacterSlug,
  };
}

export async function registerVisualUser(
  page: Page,
  input: { email: string; password: string },
) {
  await registerAndSignIn(page, {
    email: input.email,
    name: "Visual fixture user",
    password: input.password,
  });
}

export async function promoteVisualUser(
  page: Page,
  database: Database,
  input: { email: string; password: string },
) {
  await promoteVerifiedTestUser(database, input.email);
  await page.context().clearCookies();
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(input.email);
  await page.getByLabel("Password", { exact: true }).fill(input.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

export async function injectOwnerExportError(
  database: Database,
  email: string,
) {
  const [owner] = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  if (!owner) throw new Error("Visual export fixture requires its owner");
  const now = new Date("2026-10-13T13:00:00.000Z");
  await database
    .delete(dataExportJob)
    .where(eq(dataExportJob.id, visualFixtureValues.exportId));
  await database.insert(dataExportJob).values({
    id: visualFixtureValues.exportId,
    userId: owner.id,
    status: "failed",
    attemptCount: 1,
    errorCategory: visualFixtureValues.rawError,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
  });
}

export async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

export async function expectVisibleBox(locator: ReturnType<Page["locator"]>) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
}

export async function captureMain(
  page: Page,
  testInfo: TestInfo,
  name: string,
  primaryAction?: ReturnType<Page["locator"]>,
) {
  const main = page.locator("main");
  await expect(main).toBeVisible();
  for (const sentinel of visualPrivacySentinels) {
    await expect(page.locator("body")).not.toContainText(sentinel);
  }
  await expectNoHorizontalOverflow(page);
  if (primaryAction) await expectVisibleBox(primaryAction);
  await expect(main).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.015,
    scale: "css",
  });
  await main.screenshot({
    animations: "disabled",
    caret: "hide",
    path: testInfo.outputPath(`${name}-${testInfo.project.name}.png`),
    scale: "css",
  });
}
