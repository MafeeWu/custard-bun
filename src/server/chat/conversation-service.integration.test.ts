// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { characterContentDigest } from "@/server/characters/content-digest";
import { ChatDomainError } from "@/server/chat/chat-errors";
import { createDatabase, type Database } from "@/server/db/client";
import {
  character,
  characterVersion,
  chatSettings,
  conversation,
  conversationMessage,
  generationAttempt,
  generationLease,
  quotaBucket,
  usageLedger,
  user,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import { lockUserChatMutation } from "./chat-locks";
import { createConversationService } from "./conversation-service";
import { getConversationForUser } from "./conversation-queries";

const database = createDatabase(testDatabaseUrl());
const service = createConversationService(database);

const baseContent = {
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
  await database.insert(chatSettings).values({
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
  });
});

afterAll(async () => {
  await database.$client.end();
});

async function insertUser(name = "Chat User"): Promise<string> {
  const id = randomUUID();
  await database.insert(user).values({
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
  });
  return id;
}

async function insertCharacterFixture(options?: {
  lifecycle?: "active" | "archived";
  slug?: string;
}) {
  const characterId = randomUUID();
  const versionOneId = randomUUID();
  const versionTwoId = randomUUID();
  const versionOne = {
    ...baseContent,
    displayName: "Mira v1",
    openingMessage: "Opening from version one.",
  };
  const versionTwo = {
    ...baseContent,
    displayName: "Mira v2",
    openingMessage: "Opening from version two.",
  };
  const lifecycle = options?.lifecycle ?? "active";

  await database.insert(character).values({
    id: characterId,
    slug: options?.slug ?? `mira-${characterId}`,
    lifecycle,
    archivedAt: lifecycle === "archived" ? new Date() : null,
  });
  await database.insert(characterVersion).values([
    {
      id: versionOneId,
      characterId,
      versionNumber: 1,
      ...versionOne,
      contentDigest: characterContentDigest(versionOne),
      publishedAt: new Date("2026-10-01T00:00:00.000Z"),
    },
    {
      id: versionTwoId,
      characterId,
      versionNumber: 2,
      ...versionTwo,
      contentDigest: characterContentDigest(versionTwo),
      publishedAt: new Date("2026-10-02T00:00:00.000Z"),
    },
  ]);
  await database
    .update(character)
    .set({ defaultVersionId: versionOneId })
    .where(eq(character.id, characterId));

  return { characterId, versionOneId, versionTwoId, versionOne, versionTwo };
}

async function selectDefaultVersion(
  characterId: string,
  versionId: string | null,
) {
  await database
    .update(character)
    .set({ defaultVersionId: versionId })
    .where(eq(character.id, characterId));
}

async function setCharacterLifecycle(
  characterId: string,
  lifecycle: "active" | "archived",
) {
  await database
    .update(character)
    .set({
      lifecycle,
      archivedAt: lifecycle === "archived" ? new Date() : null,
    })
    .where(eq(character.id, characterId));
}

async function getConversationVersion(conversationId: string) {
  const [row] = await database
    .select({ versionId: conversation.characterVersionId })
    .from(conversation)
    .where(eq(conversation.id, conversationId));
  return row?.versionId;
}

async function getConversationRows(userId: string, characterId: string) {
  return database
    .select({
      id: conversation.id,
      lifecycle: conversation.lifecycle,
      archivedAt: conversation.archivedAt,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.userId, userId),
        eq(conversation.characterId, characterId),
      ),
    );
}

async function insertGenerationWithLease(input: {
  conversationId: string;
  userId: string;
  executor?: Pick<Database, "insert">;
}) {
  const executor = input.executor ?? database;
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const attemptId = randomUUID();
  await executor.insert(conversationMessage).values([
    {
      id: userMessageId,
      conversationId: input.conversationId,
      sequence: 2,
      role: "user",
      kind: "user",
      content: "Continue",
      clientRequestId: randomUUID(),
    },
    {
      id: assistantMessageId,
      conversationId: input.conversationId,
      sequence: 3,
      role: "assistant",
      kind: "generated",
      inReplyTo: userMessageId,
    },
  ]);
  await executor.insert(generationAttempt).values({
    id: attemptId,
    assistantMessageId,
    attemptNumber: 1,
    status: "streaming",
    content: "Partial",
    modelId: "test-model",
  });
  await executor.insert(generationLease).values({
    attemptId,
    userId: input.userId,
    ownerToken: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  return attemptId;
}

function expectChatError(
  promise: Promise<unknown>,
  code: ChatDomainError["code"],
) {
  return expect(promise).rejects.toMatchObject({
    code,
  });
}

describe("conversation lifecycle service", () => {
  test("first open pins the current default with one opening and later opens reuse it", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();

    const first = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });
    expect(first.created).toBe(true);
    expect(await getConversationVersion(first.conversationId)).toBe(
      fixture.versionOneId,
    );

    const second = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });
    expect(second).toEqual({
      conversationId: first.conversationId,
      created: false,
    });

    const openings = await database
      .select({
        content: conversationMessage.content,
      })
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, first.conversationId));
    expect(openings).toEqual([{ content: fixture.versionOne.openingMessage }]);
  });

  test("two concurrent opens return one active conversation ID", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();
    const firstDatabase = createDatabase(testDatabaseUrl(), { max: 1 });
    const secondDatabase = createDatabase(testDatabaseUrl(), { max: 1 });

    try {
      const [first, second] = await Promise.all([
        createConversationService(firstDatabase).openOrCreate({
          userId,
          characterId: fixture.characterId,
        }),
        createConversationService(secondDatabase).openOrCreate({
          userId,
          characterId: fixture.characterId,
        }),
      ]);

      expect(first.conversationId).toBe(second.conversationId);
      expect([first.created, second.created].sort()).toEqual([false, true]);
      expect(
        await getConversationRows(userId, fixture.characterId),
      ).toHaveLength(1);
    } finally {
      await firstDatabase.$client.end();
      await secondDatabase.$client.end();
    }
  });

  test("changing the default keeps the old pin and restart uses the new default", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();
    const opened = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });

    expect(await getConversationVersion(opened.conversationId)).toBe(
      fixture.versionOneId,
    );
    await selectDefaultVersion(fixture.characterId, fixture.versionTwoId);
    expect(await getConversationVersion(opened.conversationId)).toBe(
      fixture.versionOneId,
    );

    const restarted = await service.restart({
      userId,
      conversationId: opened.conversationId,
    });
    expect(await getConversationVersion(restarted.conversationId)).toBe(
      fixture.versionTwoId,
    );

    const rows = await getConversationRows(userId, fixture.characterId);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: opened.conversationId,
          lifecycle: "archived",
          archivedAt: expect.any(Date),
        }),
        expect.objectContaining({
          id: restarted.conversationId,
          lifecycle: "active",
          archivedAt: null,
        }),
      ]),
    );
    const opening = await database
      .select({ content: conversationMessage.content })
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, restarted.conversationId));
    expect(opening).toEqual([{ content: fixture.versionTwo.openingMessage }]);
  });

  test("an archived character keeps its existing active conversation readable and reusable", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();
    const opened = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });
    await setCharacterLifecycle(fixture.characterId, "archived");

    await expect(
      service.openOrCreate({
        userId,
        characterId: fixture.characterId,
      }),
    ).resolves.toEqual({
      conversationId: opened.conversationId,
      created: false,
    });
    await expect(
      getConversationForUser(database, {
        userId,
        conversationId: opened.conversationId,
      }),
    ).resolves.toMatchObject({
      id: opened.conversationId,
      lifecycle: "active",
    });
    await expectChatError(
      service.restart({
        userId,
        conversationId: opened.conversationId,
      }),
      "CHAT_READ_ONLY",
    );

    const anotherUserId = await insertUser("Another user");
    await expectChatError(
      service.openOrCreate({
        userId: anotherUserId,
        characterId: fixture.characterId,
      }),
      "CHAT_READ_ONLY",
    );
  });

  test("restart failure leaves the original conversation active", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();
    const opened = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });
    await selectDefaultVersion(fixture.characterId, null);

    await expectChatError(
      service.restart({
        userId,
        conversationId: opened.conversationId,
      }),
      "CHAT_READ_ONLY",
    );
    await expect(getConversationRows(userId, fixture.characterId)).resolves.toEqual([
      expect.objectContaining({
        id: opened.conversationId,
        lifecycle: "active",
        archivedAt: null,
      }),
    ]);
  });

  test("archived rows are never restored and cannot be restarted", async () => {
    const userId = await insertUser();
    const fixture = await insertCharacterFixture();
    const first = await service.openOrCreate({
      userId,
      characterId: fixture.characterId,
    });
    const second = await service.restart({
      userId,
      conversationId: first.conversationId,
    });

    await expectChatError(
      service.restart({ userId, conversationId: first.conversationId }),
      "CHAT_READ_ONLY",
    );
    await expect(
      service.openOrCreate({
        userId,
        characterId: fixture.characterId,
      }),
    ).resolves.toEqual({
      conversationId: second.conversationId,
      created: false,
    });

    const [archived] = await database
      .select({
        lifecycle: conversation.lifecycle,
        archivedAt: conversation.archivedAt,
      })
      .from(conversation)
      .where(eq(conversation.id, first.conversationId));
    expect(archived).toEqual({
      lifecycle: "archived",
      archivedAt: expect.any(Date),
    });
  });

  test.each(["active", "archived"] as const)(
    "deleting an %s conversation removes content without reducing consumed quota",
    async (lifecycle) => {
      const userId = await insertUser();
      const fixture = await insertCharacterFixture();
      const opened = await service.openOrCreate({
        userId,
        characterId: fixture.characterId,
      });
      if (lifecycle === "archived") {
        await service.restart({
          userId,
          conversationId: opened.conversationId,
        });
      }

      const bucketId = randomUUID();
      const ledgerId = randomUUID();
      const periodStart = new Date("2026-10-09T00:00:00.000Z");
      const periodEnd = new Date("2026-10-10T00:00:00.000Z");
      await database.insert(quotaBucket).values({
        id: bucketId,
        scope: "user",
        userId,
        periodStart,
        periodEnd,
        consumedRequests: 3,
        consumedTokens: 150,
      });
      await database.insert(usageLedger).values({
        id: ledgerId,
        userId,
        conversationId: opened.conversationId,
        periodStart,
        periodEnd,
        userRequestUnits: 1,
        providerCallNumber: 1,
        inputTokens: 50,
        outputTokens: 100,
        usageIsEstimated: false,
        modelId: "test-model",
        outcome: "complete",
      });

      await service.delete({
        userId,
        conversationId: opened.conversationId,
      });

      await expect(
        database
          .select({ id: conversation.id })
          .from(conversation)
          .where(eq(conversation.id, opened.conversationId)),
      ).resolves.toEqual([]);
      await expect(
        database
          .select({
            consumedRequests: quotaBucket.consumedRequests,
            consumedTokens: quotaBucket.consumedTokens,
          })
          .from(quotaBucket)
          .where(eq(quotaBucket.id, bucketId)),
      ).resolves.toEqual([{ consumedRequests: 3, consumedTokens: 150 }]);
      await expect(
        database
          .select({
            id: usageLedger.id,
            conversationId: usageLedger.conversationId,
          })
          .from(usageLedger)
          .where(eq(usageLedger.id, ledgerId)),
      ).resolves.toEqual([{ id: ledgerId, conversationId: null }]);
    },
  );

  test.each(["restart", "delete"] as const)(
    "%s rejects a conversation with an active generation lease",
    async (operation) => {
      const userId = await insertUser();
      const fixture = await insertCharacterFixture();
      const opened = await service.openOrCreate({
        userId,
        characterId: fixture.characterId,
      });
      await insertGenerationWithLease({
        conversationId: opened.conversationId,
        userId,
      });

      const mutation =
        operation === "restart"
          ? service.restart({
              userId,
              conversationId: opened.conversationId,
            })
          : service.delete({
              userId,
              conversationId: opened.conversationId,
            });
      await expect(mutation).rejects.toEqual(
        new ChatDomainError(
          "CHAT_GENERATION_IN_PROGRESS",
          "Stop the current reply before changing this conversation.",
          { retryable: true },
        ),
      );
      await expect(
        getConversationForUser(database, {
          userId,
          conversationId: opened.conversationId,
        }),
      ).resolves.not.toBeNull();
    },
  );

  test.each(["restart", "delete"] as const)(
    "%s races admission without deadlocking and observes the committed lease",
    async (operation) => {
      const userId = await insertUser();
      const fixture = await insertCharacterFixture();
      const opened = await service.openOrCreate({
        userId,
        characterId: fixture.characterId,
      });
      const admissionDatabase = createDatabase(testDatabaseUrl(), {
        application_name: `conversation-${operation}-admission`,
        max: 1,
      });
      let releaseAdmission!: () => void;
      const admissionRelease = new Promise<void>((resolve) => {
        releaseAdmission = resolve;
      });
      let admissionLocked!: () => void;
      const admissionHasLease = new Promise<void>((resolve) => {
        admissionLocked = resolve;
      });

      try {
        const admission = admissionDatabase.transaction(async (transaction) => {
          await lockUserChatMutation(transaction, userId);
          await transaction
            .select({ id: conversation.id })
            .from(conversation)
            .where(
              and(
                eq(conversation.id, opened.conversationId),
                eq(conversation.userId, userId),
              ),
            )
            .for("update");
          await insertGenerationWithLease({
            conversationId: opened.conversationId,
            userId,
            executor: transaction,
          });
          admissionLocked();
          await admissionRelease;
        });

        await admissionHasLease;
        const mutation =
          operation === "restart"
            ? service.restart({
                userId,
                conversationId: opened.conversationId,
              })
            : service.delete({
                userId,
                conversationId: opened.conversationId,
              });
        void mutation.catch(() => undefined);
        releaseAdmission();

        await admission;
        await expect(mutation).rejects.toMatchObject({
          code: "CHAT_GENERATION_IN_PROGRESS",
          retryable: true,
        });
      } finally {
        releaseAdmission();
        await admissionDatabase.$client.end();
      }
    },
    5_000,
  );

  test("restart and delete hide other users' conversations as not found", async () => {
    const ownerId = await insertUser("Owner");
    const otherUserId = await insertUser("Other");
    const fixture = await insertCharacterFixture();
    const opened = await service.openOrCreate({
      userId: ownerId,
      characterId: fixture.characterId,
    });

    await expectChatError(
      service.restart({
        userId: otherUserId,
        conversationId: opened.conversationId,
      }),
      "CHAT_NOT_FOUND",
    );
    await expectChatError(
      service.delete({
        userId: otherUserId,
        conversationId: opened.conversationId,
      }),
      "CHAT_NOT_FOUND",
    );
    await expect(
      getConversationForUser(database, {
        userId: otherUserId,
        conversationId: opened.conversationId,
      }),
    ).resolves.toBeNull();
  });
});
