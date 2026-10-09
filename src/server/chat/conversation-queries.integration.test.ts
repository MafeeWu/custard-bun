// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { characterContentDigest } from "@/server/characters/content-digest";
import { createDatabase } from "@/server/db/client";
import {
  character,
  characterVersion,
  conversation,
  conversationMessage,
  generationAttempt,
  user,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  getConversationForUser,
  listActiveConversations,
  listArchivedCharacterConversations,
} from "./conversation-queries";

const database = createDatabase(testDatabaseUrl());

const versionContent = {
  displayName: "Mira",
  avatarPath: "/characters/mira.svg",
  shortDescription: "A calm companion.",
  longDescription: "A calm companion who listens carefully.",
  personalityPrinciples: ["Listen first."],
  speakingStyle: "Warm and direct.",
  responseRhythm: "Short paragraphs.",
  relationshipBoundaries: ["Do not encourage dependency."],
  openingMessage: "What would you like to talk about?",
  exampleConversations: [
    { user: "Hello", assistant: "Hello. How are you feeling?" },
  ],
  generationParameters: {
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: 800,
  },
  safetyAdditions: ["Use grounding language."],
};

beforeEach(async () => {
  await database.execute(
    sql.raw(`
      TRUNCATE TABLE
        usage_ledger,
        generation_leases,
        quota_reservations,
        quota_buckets,
        user_chat_quota_overrides,
        chat_settings,
        generation_attempts,
        conversation_messages,
        conversations,
        character_drafts,
        character_versions,
        characters,
        "user"
      RESTART IDENTITY CASCADE
    `),
  );
});

afterAll(async () => {
  await database.$client.end();
});

async function insertUser(name: string): Promise<string> {
  const id = randomUUID();
  await database.insert(user).values({
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
  });
  return id;
}

async function insertCharacterFixture() {
  const characterId = randomUUID();
  const pinnedVersionId = randomUUID();
  const currentVersionId = randomUUID();

  await database.insert(character).values({
    id: characterId,
    slug: "mira",
  });
  await database.insert(characterVersion).values([
    {
      id: pinnedVersionId,
      characterId,
      versionNumber: 1,
      ...versionContent,
      displayName: "Mira v1",
      avatarPath: "/characters/mira-v1.svg",
      contentDigest: characterContentDigest({
        ...versionContent,
        displayName: "Mira v1",
        avatarPath: "/characters/mira-v1.svg",
      }),
      publishedAt: new Date("2026-10-01T00:00:00.000Z"),
    },
    {
      id: currentVersionId,
      characterId,
      versionNumber: 2,
      ...versionContent,
      displayName: "Mira v2",
      avatarPath: "/characters/mira-v2.svg",
      contentDigest: characterContentDigest({
        ...versionContent,
        displayName: "Mira v2",
        avatarPath: "/characters/mira-v2.svg",
      }),
      publishedAt: new Date("2026-10-02T00:00:00.000Z"),
    },
  ]);
  await database
    .update(character)
    .set({ defaultVersionId: currentVersionId })
    .where(eq(character.id, characterId));

  return { characterId, pinnedVersionId, currentVersionId };
}

async function insertConversationFixture(input: {
  userId: string;
  characterId: string;
  characterVersionId: string;
  lifecycle?: "active" | "archived";
  createdAt: Date;
}) {
  const conversationId = randomUUID();
  const lifecycle = input.lifecycle ?? "active";
  await database.insert(conversation).values({
    id: conversationId,
    userId: input.userId,
    characterId: input.characterId,
    characterVersionId: input.characterVersionId,
    lifecycle,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    lastMessageAt: input.createdAt,
    archivedAt: lifecycle === "archived" ? input.createdAt : null,
  });
  return conversationId;
}

describe("conversation ownership queries", () => {
  test("returns pinned presentation and only the current generation attempt", async () => {
    const ownerId = await insertUser("Owner");
    const otherUserId = await insertUser("Other");
    const { characterId, pinnedVersionId } =
      await insertCharacterFixture();
    const conversationId = await insertConversationFixture({
      userId: ownerId,
      characterId,
      characterVersionId: pinnedVersionId,
      createdAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    const openingId = randomUUID();
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    await database.insert(conversationMessage).values([
      {
        id: openingId,
        conversationId,
        sequence: 1,
        role: "assistant",
        kind: "opening",
        content: versionContent.openingMessage,
      },
      {
        id: userMessageId,
        conversationId,
        sequence: 2,
        role: "user",
        kind: "user",
        content: "I need help.",
        clientRequestId: randomUUID(),
      },
      {
        id: assistantMessageId,
        conversationId,
        sequence: 3,
        role: "assistant",
        kind: "generated",
        inReplyTo: userMessageId,
      },
    ]);

    const oldAttemptId = randomUUID();
    const currentAttemptId = randomUUID();
    await database.insert(generationAttempt).values([
      {
        id: oldAttemptId,
        userId: ownerId,
        assistantMessageId,
        attemptNumber: 1,
        isCurrent: false,
        status: "failed",
        content: "Hidden failed attempt",
        modelId: "test-model",
        errorCategory: "CHAT_PROVIDER_TIMEOUT",
        retryable: true,
        completedAt: new Date(),
      },
      {
        id: currentAttemptId,
        userId: ownerId,
        assistantMessageId,
        attemptNumber: 2,
        isCurrent: true,
        status: "complete",
        content: "Visible current response",
        modelId: "test-model",
        retryable: false,
        completedAt: new Date(),
      },
    ]);

    await expect(
      getConversationForUser(database, { userId: ownerId, conversationId }),
    ).resolves.toEqual({
      id: conversationId,
      lifecycle: "active",
      character: {
        id: characterId,
        slug: "mira",
        displayName: "Mira v1",
        avatarPath: "/characters/mira-v1.svg",
        pinnedVersionId,
        isCurrentDefault: false,
      },
      messages: [
        {
          id: openingId,
          role: "assistant",
          kind: "opening",
          content: versionContent.openingMessage,
        },
        {
          id: userMessageId,
          role: "user",
          kind: "user",
          content: "I need help.",
        },
        {
          id: assistantMessageId,
          role: "assistant",
          kind: "generated",
          attemptId: currentAttemptId,
          status: "complete",
          content: "Visible current response",
          errorCode: null,
          retryable: false,
        },
      ],
    });
    await expect(
      getConversationForUser(database, {
        userId: otherUserId,
        conversationId,
      }),
    ).resolves.toBeNull();
  });

  test("lists only the authenticated user's active and archived conversations", async () => {
    const ownerId = await insertUser("Owner");
    const otherUserId = await insertUser("Other");
    const { characterId, pinnedVersionId } =
      await insertCharacterFixture();
    const activeId = await insertConversationFixture({
      userId: ownerId,
      characterId,
      characterVersionId: pinnedVersionId,
      createdAt: new Date("2026-10-05T00:00:00.000Z"),
    });
    const archivedId = await insertConversationFixture({
      userId: ownerId,
      characterId,
      characterVersionId: pinnedVersionId,
      lifecycle: "archived",
      createdAt: new Date("2026-10-04T00:00:00.000Z"),
    });
    await insertConversationFixture({
      userId: otherUserId,
      characterId,
      characterVersionId: pinnedVersionId,
      createdAt: new Date("2026-10-06T00:00:00.000Z"),
    });
    await insertConversationFixture({
      userId: otherUserId,
      characterId,
      characterVersionId: pinnedVersionId,
      lifecycle: "archived",
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
    });

    await expect(listActiveConversations(database, ownerId)).resolves.toEqual([
      {
        id: activeId,
        character: {
          id: characterId,
          slug: "mira",
          displayName: "Mira v1",
          avatarPath: "/characters/mira-v1.svg",
          pinnedVersionId,
          isCurrentDefault: false,
        },
        lastMessageAt: new Date("2026-10-05T00:00:00.000Z"),
      },
    ]);
    await expect(
      listArchivedCharacterConversations(database, {
        userId: ownerId,
        characterId,
      }),
    ).resolves.toEqual([
      {
        id: archivedId,
        character: {
          id: characterId,
          slug: "mira",
          displayName: "Mira v1",
          avatarPath: "/characters/mira-v1.svg",
          pinnedVersionId,
          isCurrentDefault: false,
        },
        archivedAt: new Date("2026-10-04T00:00:00.000Z"),
        lastMessageAt: new Date("2026-10-04T00:00:00.000Z"),
      },
    ]);
    await expect(
      listActiveConversations(database, randomUUID()),
    ).resolves.toEqual([]);
    await expect(
      listArchivedCharacterConversations(database, {
        userId: otherUserId,
        characterId: randomUUID(),
      }),
    ).resolves.toEqual([]);
  });
});
