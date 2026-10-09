// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { characterContentDigest } from "@/server/characters/content-digest";
import { testDatabaseUrl } from "@/test/database-target";
import { createDatabase } from "./client";

const database = createDatabase(testDatabaseUrl());

const characterContent = {
  displayName: "Mira",
  avatarPath: "/characters/calm-listener.svg",
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

async function expectDatabaseError(
  promise: Promise<unknown>,
  matcher: RegExp,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected database operation to fail");
  } catch (error: unknown) {
    const messageParts = [
      error instanceof Error ? error.message : "",
      error &&
      typeof error === "object" &&
      "cause" in error &&
      error.cause instanceof Error
        ? error.cause.message
        : "",
    ].filter(Boolean);

    expect(messageParts.join("\n")).toMatch(matcher);
  }
}

async function waitForApplicationLockWait(
  applicationName: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await database.$client.query<{
          wait_event_type: string | null;
        }>(
          `
            SELECT wait_event_type
            FROM pg_stat_activity
            WHERE application_name = $1
              AND state = 'active'
          `,
          [applicationName],
        );

        return result.rows.some((row) => row.wait_event_type === "Lock");
      },
      { timeout: 2_000 },
    )
    .toBe(true);
}

async function insertUser(id = randomUUID()) {
  await database.execute(sql`
    INSERT INTO "user" (
      id,
      name,
      email,
      email_verified,
      created_at,
      updated_at
    )
    VALUES (
      ${id},
      'Chat User',
      ${`${id}@example.com`},
      true,
      NOW(),
      NOW()
    )
  `);
  return id;
}

async function insertCharacterWithVersion(slug: string) {
  const characterId = randomUUID();
  const versionId = randomUUID();

  await database.execute(sql`
    INSERT INTO characters (id, slug, lifecycle)
    VALUES (${characterId}, ${slug}, 'active')
  `);
  await database.execute(sql`
    INSERT INTO character_versions (
      id,
      character_id,
      version_number,
      display_name,
      avatar_path,
      short_description,
      long_description,
      personality_principles,
      speaking_style,
      response_rhythm,
      relationship_boundaries,
      opening_message,
      example_conversations,
      generation_parameters,
      safety_additions,
      content_digest,
      published_at
    )
    VALUES (
      ${versionId},
      ${characterId},
      1,
      ${characterContent.displayName},
      ${characterContent.avatarPath},
      ${characterContent.shortDescription},
      ${characterContent.longDescription},
      ${JSON.stringify(characterContent.personalityPrinciples)}::jsonb,
      ${characterContent.speakingStyle},
      ${characterContent.responseRhythm},
      ${JSON.stringify(characterContent.relationshipBoundaries)}::jsonb,
      ${characterContent.openingMessage},
      ${JSON.stringify(characterContent.exampleConversations)}::jsonb,
      ${JSON.stringify(characterContent.generationParameters)}::jsonb,
      ${JSON.stringify(characterContent.safetyAdditions)}::jsonb,
      ${characterContentDigest(characterContent)},
      NOW()
    )
  `);

  return { characterId, versionId };
}

async function insertConversation(input: {
  userId: string;
  characterId: string;
  characterVersionId: string;
  lifecycle?: "active" | "archived";
}) {
  const id = randomUUID();
  const lifecycle = input.lifecycle ?? "active";
  await database.execute(sql`
    INSERT INTO conversations (
      id,
      user_id,
      character_id,
      character_version_id,
      lifecycle,
      archived_at
    )
    VALUES (
      ${id},
      ${input.userId},
      ${input.characterId},
      ${input.characterVersionId},
      ${lifecycle},
      ${lifecycle === "archived" ? new Date() : null}
    )
  `);
  return id;
}

async function insertMessage(input: {
  conversationId: string;
  sequence: number;
  role: "user" | "assistant";
  kind: "opening" | "user" | "generated";
  content?: string | null;
  clientRequestId?: string | null;
  inReplyTo?: string | null;
}) {
  const id = randomUUID();
  await database.execute(sql`
    INSERT INTO conversation_messages (
      id,
      conversation_id,
      sequence,
      role,
      kind,
      content,
      client_request_id,
      in_reply_to
    )
    VALUES (
      ${id},
      ${input.conversationId},
      ${input.sequence},
      ${input.role},
      ${input.kind},
      ${input.content ?? null},
      ${input.clientRequestId ?? null},
      ${input.inReplyTo ?? null}
    )
  `);
  return id;
}

async function insertAttempt(input: {
  assistantMessageId: string;
  clientRequestId?: string | null;
  attemptNumber?: number;
  isCurrent?: boolean;
  status?: "pending" | "streaming" | "complete" | "interrupted" | "failed";
  content?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}) {
  const id = randomUUID();
  await database.execute(sql`
    INSERT INTO generation_attempts (
      id,
      user_id,
      assistant_message_id,
      client_request_id,
      attempt_number,
      is_current,
      status,
      content,
      model_id,
      provider_retry_count,
      input_tokens,
      output_tokens,
      usage_is_estimated,
      started_at,
      completed_at
    )
    VALUES (
      ${id},
      (
        SELECT conversations.user_id
        FROM conversation_messages
        JOIN conversations
          ON conversations.id = conversation_messages.conversation_id
        WHERE conversation_messages.id = ${input.assistantMessageId}
      ),
      ${input.assistantMessageId},
      ${input.clientRequestId ?? null},
      ${input.attemptNumber ?? 1},
      ${input.isCurrent ?? true},
      ${input.status ?? "pending"},
      ${input.content ?? ""},
      'test-chat-model',
      0,
      ${input.inputTokens ?? null},
      ${input.outputTokens ?? null},
      ${input.inputTokens == null && input.outputTokens == null ? null : false},
      NOW(),
      ${
        input.status &&
        ["complete", "interrupted", "failed"].includes(input.status)
          ? new Date()
          : null
      }
    )
  `);
  return id;
}

async function chatFixture(slugSuffix = "") {
  const userId = await insertUser();
  const firstCharacter = await insertCharacterWithVersion(
    `mira${slugSuffix}`,
  );
  const secondCharacter = await insertCharacterWithVersion(`sol${slugSuffix}`);
  const conversationId = await insertConversation({
    userId,
    characterId: firstCharacter.characterId,
    characterVersionId: firstCharacter.versionId,
  });
  const userMessageId = await insertMessage({
    conversationId,
    sequence: 1,
    role: "user",
    kind: "user",
    content: "Hello",
    clientRequestId: randomUUID(),
  });
  const assistantMessageId = await insertMessage({
    conversationId,
    sequence: 2,
    role: "assistant",
    kind: "generated",
    inReplyTo: userMessageId,
  });

  return {
    userId,
    firstCharacter,
    secondCharacter,
    conversationId,
    userMessageId,
    assistantMessageId,
  };
}

describe("chat storage invariants", () => {
  test("allows only one active conversation per user and character", async () => {
    const userId = await insertUser();
    const { characterId, versionId } = await insertCharacterWithVersion("mira");
    await insertConversation({
      userId,
      characterId,
      characterVersionId: versionId,
    });

    await expectDatabaseError(
      insertConversation({
        userId,
        characterId,
        characterVersionId: versionId,
      }),
      /one active conversation/i,
    );
  });

  test("scopes generation idempotency keys to the owning user", async () => {
    const first = await chatFixture("-first-idempotency");
    const second = await chatFixture("-second-idempotency");
    const clientRequestId = randomUUID();
    await insertAttempt({
      assistantMessageId: first.assistantMessageId,
      clientRequestId,
    });

    await expect(
      insertAttempt({
        assistantMessageId: second.assistantMessageId,
        clientRequestId,
      }),
    ).resolves.toEqual(expect.any(String));
    await expectDatabaseError(
      insertAttempt({
        assistantMessageId: first.assistantMessageId,
        clientRequestId,
        attemptNumber: 2,
        isCurrent: false,
      }),
      /generation_attempts_user_client_request_unique/i,
    );
  });

  test("archived conversations cannot be restored", async () => {
    const userId = await insertUser();
    const { characterId, versionId } = await insertCharacterWithVersion("mira");
    const archivedId = await insertConversation({
      userId,
      characterId,
      characterVersionId: versionId,
      lifecycle: "archived",
    });

    await expectDatabaseError(
      database.execute(sql`
        UPDATE conversations
        SET lifecycle = 'active', archived_at = NULL
        WHERE id = ${archivedId}
      `),
      /archived conversations cannot be restored/i,
    );
  });

  test("requires the pinned character version to belong to the character", async () => {
    const userId = await insertUser();
    const firstCharacter = await insertCharacterWithVersion("mira");
    const secondCharacter = await insertCharacterWithVersion("sol");

    await expectDatabaseError(
      insertConversation({
        userId,
        characterId: firstCharacter.characterId,
        characterVersionId: secondCharacter.versionId,
      }),
      /pinned version must belong/i,
    );
  });

  test("conversation ownership and pinned character version are immutable", async () => {
    const fixture = await chatFixture();

    await expectDatabaseError(
      database.execute(sql`
        UPDATE conversations
        SET character_id = ${fixture.secondCharacter.characterId},
            character_version_id = ${fixture.secondCharacter.versionId}
        WHERE id = ${fixture.conversationId}
      `),
      /pinned character version.*immutable/i,
    );

    await expectDatabaseError(
      database.execute(sql`
        UPDATE conversations
        SET user_id = ${await insertUser()}
        WHERE id = ${fixture.conversationId}
      `),
      /conversation ownership.*immutable/i,
    );
  });

  test("rejects duplicate message sequence and client request IDs", async () => {
    const fixture = await chatFixture();

    await expectDatabaseError(
      insertMessage({
        conversationId: fixture.conversationId,
        sequence: 1,
        role: "user",
        kind: "user",
        content: "Duplicate sequence",
        clientRequestId: randomUUID(),
      }),
      /sequence/i,
    );

    const clientRequestId = randomUUID();
    await insertMessage({
      conversationId: fixture.conversationId,
      sequence: 3,
      role: "user",
      kind: "user",
      content: "First request",
      clientRequestId,
    });
    await expectDatabaseError(
      insertMessage({
        conversationId: fixture.conversationId,
        sequence: 4,
        role: "user",
        kind: "user",
        content: "Duplicate request",
        clientRequestId,
      }),
      /client.request/i,
    );
  });

  test("generated assistant slots reference one user message in the same conversation", async () => {
    const fixture = await chatFixture();
    const otherConversationId = await insertConversation({
      userId: fixture.userId,
      characterId: fixture.secondCharacter.characterId,
      characterVersionId: fixture.secondCharacter.versionId,
    });
    const otherUserMessageId = await insertMessage({
      conversationId: otherConversationId,
      sequence: 1,
      role: "user",
      kind: "user",
      content: "Other conversation",
      clientRequestId: randomUUID(),
    });

    await expectDatabaseError(
      insertMessage({
        conversationId: fixture.conversationId,
        sequence: 3,
        role: "assistant",
        kind: "generated",
        inReplyTo: otherUserMessageId,
      }),
      /same conversation/i,
    );

    const openingMessageId = await insertMessage({
      conversationId: otherConversationId,
      sequence: 2,
      role: "assistant",
      kind: "opening",
      content: "Opening",
    });
    await expectDatabaseError(
      insertMessage({
        conversationId: fixture.conversationId,
        sequence: 4,
        role: "assistant",
        kind: "generated",
        inReplyTo: openingMessageId,
      }),
      /user message/i,
    );

    await expectDatabaseError(
      insertMessage({
        conversationId: fixture.conversationId,
        sequence: 5,
        role: "assistant",
        kind: "generated",
        inReplyTo: fixture.userMessageId,
      }),
      /one generated assistant slot/i,
    );
  });

  test("referenced user messages cannot move to another conversation", async () => {
    const fixture = await chatFixture();
    const otherConversationId = await insertConversation({
      userId: fixture.userId,
      characterId: fixture.secondCharacter.characterId,
      characterVersionId: fixture.secondCharacter.versionId,
    });

    await expectDatabaseError(
      database.execute(sql`
        UPDATE conversation_messages
        SET conversation_id = ${otherConversationId}
        WHERE id = ${fixture.userMessageId}
      `),
      /referenced user message.*conversation.*immutable/i,
    );
  });

  test("referenced user messages cannot change kind", async () => {
    const fixture = await chatFixture();

    await expectDatabaseError(
      database.execute(sql`
        UPDATE conversation_messages
        SET kind = 'opening',
            role = 'assistant',
            client_request_id = NULL
        WHERE id = ${fixture.userMessageId}
      `),
      /referenced user message.*kind.*immutable/i,
    );
  });

  test.each(["source-update-first", "generated-insert-first"] as const)(
    "serializes generated-message creation with source mutation: %s",
    async (ordering) => {
      const userId = await insertUser();
      const firstCharacter = await insertCharacterWithVersion(
        `source-race-${ordering}`,
      );
      const secondCharacter = await insertCharacterWithVersion(
        `target-race-${ordering}`,
      );
      const sourceConversationId = await insertConversation({
        userId,
        characterId: firstCharacter.characterId,
        characterVersionId: firstCharacter.versionId,
      });
      const targetConversationId = await insertConversation({
        userId,
        characterId: secondCharacter.characterId,
        characterVersionId: secondCharacter.versionId,
      });
      const sourceMessageId = await insertMessage({
        conversationId: sourceConversationId,
        sequence: 1,
        role: "user",
        kind: "user",
        content: "Race source",
        clientRequestId: randomUUID(),
      });
      const generatedMessageId = randomUUID();
      const secondApplicationName = `chat-source-race-${ordering}`;
      const firstDatabase = createDatabase(testDatabaseUrl(), {
        application_name: `chat-source-race-first-${ordering}`,
        max: 1,
      });
      const secondDatabase = createDatabase(testDatabaseUrl(), {
        application_name: secondApplicationName,
        max: 1,
      });
      const first = await firstDatabase.$client.connect();
      const second = await secondDatabase.$client.connect();
      let secondOperation: Promise<unknown> | undefined;

      try {
        await first.query("BEGIN");
        await second.query("BEGIN");

        if (ordering === "source-update-first") {
          await first.query(
            `UPDATE conversation_messages
             SET conversation_id = $1
             WHERE id = $2`,
            [targetConversationId, sourceMessageId],
          );
          secondOperation = second.query(
            `INSERT INTO conversation_messages (
               id,
               conversation_id,
               sequence,
               role,
               kind,
               in_reply_to
             )
             VALUES ($1, $2, 2, 'assistant', 'generated', $3)`,
            [generatedMessageId, sourceConversationId, sourceMessageId],
          );
        } else {
          await first.query(
            `INSERT INTO conversation_messages (
               id,
               conversation_id,
               sequence,
               role,
               kind,
               in_reply_to
             )
             VALUES ($1, $2, 2, 'assistant', 'generated', $3)`,
            [generatedMessageId, sourceConversationId, sourceMessageId],
          );
          secondOperation = second.query(
            `UPDATE conversation_messages
             SET conversation_id = $1
             WHERE id = $2`,
            [targetConversationId, sourceMessageId],
          );
        }
        void secondOperation.catch(() => undefined);

        await waitForApplicationLockWait(secondApplicationName);
        await first.query("COMMIT");
        await expect(secondOperation).rejects.toThrow(
          ordering === "source-update-first"
            ? /same conversation/i
            : /referenced user message.*conversation.*immutable/i,
        );

        const source = await database.$client.query<{
          conversation_id: string;
        }>(
          "SELECT conversation_id FROM conversation_messages WHERE id = $1",
          [sourceMessageId],
        );
        const generated = await database.$client.query(
          "SELECT id FROM conversation_messages WHERE id = $1",
          [generatedMessageId],
        );

        if (ordering === "source-update-first") {
          expect(source.rows).toEqual([
            { conversation_id: targetConversationId },
          ]);
          expect(generated.rows).toHaveLength(0);
        } else {
          expect(source.rows).toEqual([
            { conversation_id: sourceConversationId },
          ]);
          expect(generated.rows).toHaveLength(1);
        }
      } finally {
        await first.query("ROLLBACK").catch(() => undefined);
        await second.query("ROLLBACK").catch(() => undefined);
        first.release();
        second.release();
        await Promise.allSettled(secondOperation ? [secondOperation] : []);
        await firstDatabase.$client.end();
        await secondDatabase.$client.end();
      }
    },
  );

  test("allows only one current attempt per assistant slot", async () => {
    const fixture = await chatFixture();
    await insertAttempt({ assistantMessageId: fixture.assistantMessageId });

    await expectDatabaseError(
      insertAttempt({
        assistantMessageId: fixture.assistantMessageId,
        attemptNumber: 2,
      }),
      /one current attempt/i,
    );
  });

  test("allows only one active generation lease per user", async () => {
    const fixture = await chatFixture();
    const firstAttemptId = await insertAttempt({
      assistantMessageId: fixture.assistantMessageId,
    });
    await database.execute(sql`
      INSERT INTO generation_leases (
        attempt_id,
        user_id,
        owner_token,
        expires_at
      )
      VALUES (${firstAttemptId}, ${fixture.userId}, 'owner-one', NOW() + INTERVAL '1 minute')
    `);

    const secondUserMessageId = await insertMessage({
      conversationId: fixture.conversationId,
      sequence: 3,
      role: "user",
      kind: "user",
      content: "Again",
      clientRequestId: randomUUID(),
    });
    const secondAssistantMessageId = await insertMessage({
      conversationId: fixture.conversationId,
      sequence: 4,
      role: "assistant",
      kind: "generated",
      inReplyTo: secondUserMessageId,
    });
    const secondAttemptId = await insertAttempt({
      assistantMessageId: secondAssistantMessageId,
    });

    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO generation_leases (
          attempt_id,
          user_id,
          owner_token,
          expires_at
        )
        VALUES (${secondAttemptId}, ${fixture.userId}, 'owner-two', NOW() + INTERVAL '1 minute')
      `),
      /generation lease|user_id/i,
    );
  });

  test("generation leases must belong to the attempt conversation owner", async () => {
    const fixture = await chatFixture();
    const otherUserId = await insertUser();
    const attemptId = await insertAttempt({
      assistantMessageId: fixture.assistantMessageId,
    });

    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO generation_leases (
          attempt_id,
          user_id,
          owner_token,
          expires_at
        )
        VALUES (
          ${attemptId},
          ${otherUserId},
          'wrong-owner',
          NOW() + INTERVAL '1 minute'
        )
      `),
      /generation lease user.*conversation owner/i,
    );

    await database.execute(sql`
      INSERT INTO generation_leases (
        attempt_id,
        user_id,
        owner_token,
        expires_at
      )
      VALUES (
        ${attemptId},
        ${fixture.userId},
        'right-owner',
        NOW() + INTERVAL '1 minute'
      )
    `);

    await expectDatabaseError(
      database.execute(sql`
        UPDATE generation_leases
        SET user_id = ${otherUserId}
        WHERE attempt_id = ${attemptId}
      `),
      /generation lease user.*conversation owner/i,
    );
  });

  test("leased generation attempts cannot be rebound across users", async () => {
    const firstFixture = await chatFixture("-lease-rebind-first");
    const secondFixture = await chatFixture("-lease-rebind-second");
    const secondUserMessageId = await insertMessage({
      conversationId: secondFixture.conversationId,
      sequence: 3,
      role: "user",
      kind: "user",
      content: "Rebind target",
      clientRequestId: randomUUID(),
    });
    const attemptId = await insertAttempt({
      assistantMessageId: firstFixture.assistantMessageId,
    });

    await database.execute(sql`
      INSERT INTO generation_leases (
        attempt_id,
        user_id,
        owner_token,
        expires_at
      )
      VALUES (
        ${attemptId},
        ${firstFixture.userId},
        'stable-owner',
        NOW() + INTERVAL '1 minute'
      )
    `);

    await expectDatabaseError(
      database.execute(sql`
        UPDATE generation_attempts
        SET assistant_message_id = ${secondFixture.assistantMessageId}
        WHERE id = ${attemptId}
      `),
      /generation attempt identity.*immutable/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE generation_attempts
        SET attempt_number = 2
        WHERE id = ${attemptId}
      `),
      /generation attempt identity.*immutable/i,
    );

    await expectDatabaseError(
      database.execute(sql`
        UPDATE conversation_messages
        SET conversation_id = ${secondFixture.conversationId},
            sequence = 4,
            in_reply_to = ${secondUserMessageId}
        WHERE id = ${firstFixture.assistantMessageId}
      `),
      /attempt-bound assistant message identity.*immutable/i,
    );

    const binding = await database.execute<{
      assistant_message_id: string;
      attempt_number: number;
      conversation_id: string;
      lease_user_id: string;
    }>(sql`
      SELECT
        generation_attempts.assistant_message_id,
        generation_attempts.attempt_number,
        conversation_messages.conversation_id,
        generation_leases.user_id AS lease_user_id
      FROM generation_attempts
      JOIN conversation_messages
        ON conversation_messages.id = generation_attempts.assistant_message_id
      JOIN generation_leases
        ON generation_leases.attempt_id = generation_attempts.id
      WHERE generation_attempts.id = ${attemptId}
    `);
    expect(binding.rows).toEqual([
      {
        assistant_message_id: firstFixture.assistantMessageId,
        attempt_number: 1,
        conversation_id: firstFixture.conversationId,
        lease_user_id: firstFixture.userId,
      },
    ]);
  });

  test("serializes terminal finalization against lease and reservation inserts", async () => {
    for (const resource of ["lease", "reservation"] as const) {
      const fixture = await chatFixture(`-${resource}`);
      const attemptId = await insertAttempt({
        assistantMessageId: fixture.assistantMessageId,
      });
      const applicationName = `chat-${resource}-insert`;
      const finalizerDatabase = createDatabase(testDatabaseUrl(), {
        application_name: `chat-${resource}-finalizer`,
        max: 1,
      });
      const resourceDatabase = createDatabase(testDatabaseUrl(), {
        application_name: applicationName,
        max: 1,
      });
      const finalizer = await finalizerDatabase.$client.connect();
      const resourceWriter = await resourceDatabase.$client.connect();
      let inserting: Promise<unknown> | undefined;
      const resourceId = resource === "lease" ? attemptId : randomUUID();
      let userBucketId: string | undefined;
      let instanceBucketId: string | undefined;

      if (resource === "reservation") {
        userBucketId = randomUUID();
        instanceBucketId = randomUUID();
        await database.execute(sql`
          INSERT INTO quota_buckets (
            id,
            scope,
            user_id,
            period_start,
            period_end
          )
          VALUES
            (
              ${userBucketId},
              'user',
              ${fixture.userId},
              TIMESTAMPTZ '2026-10-09 00:00:00+00',
              TIMESTAMPTZ '2026-10-10 00:00:00+00'
            ),
            (
              ${instanceBucketId},
              'instance',
              NULL,
              TIMESTAMPTZ '2026-10-01 00:00:00+00',
              TIMESTAMPTZ '2026-11-01 00:00:00+00'
            )
        `);
      }

      try {
        await finalizer.query("BEGIN");
        await resourceWriter.query("BEGIN");
        await finalizer.query(
          `UPDATE generation_attempts
           SET status = 'complete', completed_at = NOW()
           WHERE id = $1`,
          [attemptId],
        );

        if (resource === "lease") {
          inserting = resourceWriter.query(
            `INSERT INTO generation_leases (
               attempt_id,
               user_id,
               owner_token,
               expires_at
             )
             VALUES ($1, $2, 'race-owner', NOW() + INTERVAL '1 minute')`,
            [attemptId, fixture.userId],
          );
        } else {
          inserting = resourceWriter.query(
            `INSERT INTO quota_reservations (
               id,
               user_id,
               conversation_id,
               attempt_id,
               user_bucket_id,
               instance_bucket_id,
               reserved_tokens
             )
             VALUES ($1, $2, $3, $4, $5, $6, 256)`,
            [
              resourceId,
              fixture.userId,
              fixture.conversationId,
              attemptId,
              userBucketId,
              instanceBucketId,
            ],
          );
        }
        void inserting.catch(() => undefined);

        await waitForApplicationLockWait(applicationName);
        await finalizer.query("COMMIT");
        await inserting;
        await expect(resourceWriter.query("COMMIT")).rejects.toThrow(
          /terminal generation attempts cannot retain active leases or reservations/i,
        );

        const table =
          resource === "lease" ? "generation_leases" : "quota_reservations";
        const idColumn = resource === "lease" ? "attempt_id" : "id";
        const result = await database.$client.query(
          `SELECT 1 FROM ${table} WHERE ${idColumn} = $1`,
          [resourceId],
        );
        expect(result.rows).toHaveLength(0);
        await expect(
          database.$client.query(
            "SELECT status FROM generation_attempts WHERE id = $1",
            [attemptId],
          ),
        ).resolves.toMatchObject({
          rows: [{ status: "complete" }],
        });
      } finally {
        await finalizer.query("ROLLBACK").catch(() => undefined);
        await resourceWriter.query("ROLLBACK").catch(() => undefined);
        finalizer.release();
        resourceWriter.release();
        await Promise.allSettled(inserting ? [inserting] : []);
        await finalizerDatabase.$client.end();
        await resourceDatabase.$client.end();
      }
    }
  });

  test("terminal attempt status, content, and accounting fields are immutable", async () => {
    const fixture = await chatFixture();
    const attemptId = await insertAttempt({
      assistantMessageId: fixture.assistantMessageId,
      status: "complete",
      content: "Final answer",
      inputTokens: 12,
      outputTokens: 8,
    });

    for (const statement of [
      sql`UPDATE generation_attempts SET status = 'failed' WHERE id = ${attemptId}`,
      sql`UPDATE generation_attempts SET content = 'Changed' WHERE id = ${attemptId}`,
      sql`UPDATE generation_attempts SET input_tokens = 99 WHERE id = ${attemptId}`,
    ]) {
      await expectDatabaseError(
        database.execute(statement),
        /terminal generation attempt.*immutable/i,
      );
    }
  });

  test("usage ledger accounting is append-only", async () => {
    const fixture = await chatFixture();
    const attemptId = await insertAttempt({
      assistantMessageId: fixture.assistantMessageId,
      status: "complete",
      content: "Final answer",
      inputTokens: 12,
      outputTokens: 8,
    });
    const ledgerId = randomUUID();
    await database.execute(sql`
      INSERT INTO usage_ledger (
        id,
        user_id,
        conversation_id,
        attempt_id,
        period_start,
        period_end,
        user_request_units,
        provider_call_number,
        input_tokens,
        output_tokens,
        usage_is_estimated,
        model_id,
        outcome,
        automatic_retry_count,
        latency_ms
      )
      VALUES (
        ${ledgerId},
        ${fixture.userId},
        ${fixture.conversationId},
        ${attemptId},
        DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day') AT TIME ZONE 'UTC',
        1,
        1,
        12,
        8,
        false,
        'test-chat-model',
        'complete',
        0,
        120
      )
    `);

    await expectDatabaseError(
      database.execute(sql`
        UPDATE usage_ledger SET input_tokens = 99 WHERE id = ${ledgerId}
      `),
      /usage ledger.*immutable/i,
    );
    await expectDatabaseError(
      database.execute(sql`DELETE FROM usage_ledger WHERE id = ${ledgerId}`),
      /usage ledger.*immutable/i,
    );
  });

  test("conversation and account deletion preserve numeric usage while nulling references", async () => {
    const fixture = await chatFixture();
    const attemptId = await insertAttempt({
      assistantMessageId: fixture.assistantMessageId,
      status: "complete",
      content: "Final answer",
      inputTokens: 12,
      outputTokens: 8,
    });
    const ledgerId = randomUUID();
    await database.execute(sql`
      INSERT INTO usage_ledger (
        id,
        user_id,
        conversation_id,
        attempt_id,
        period_start,
        period_end,
        user_request_units,
        provider_call_number,
        input_tokens,
        output_tokens,
        usage_is_estimated,
        model_id,
        outcome,
        automatic_retry_count,
        latency_ms
      )
      VALUES (
        ${ledgerId},
        ${fixture.userId},
        ${fixture.conversationId},
        ${attemptId},
        DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day') AT TIME ZONE 'UTC',
        1,
        1,
        12,
        8,
        false,
        'test-chat-model',
        'complete',
        0,
        120
      )
    `);

    await database.execute(sql`
      DELETE FROM conversations WHERE id = ${fixture.conversationId}
    `);

    const afterConversationDelete = await database.execute<{
      user_id: string | null;
      conversation_id: string | null;
      attempt_id: string | null;
      input_tokens: number;
      output_tokens: number;
    }>(sql`
      SELECT user_id, conversation_id, attempt_id, input_tokens, output_tokens
      FROM usage_ledger
      WHERE id = ${ledgerId}
    `);
    expect(afterConversationDelete.rows[0]).toMatchObject({
      user_id: fixture.userId,
      conversation_id: null,
      attempt_id: null,
      input_tokens: "12",
      output_tokens: "8",
    });
    expect(
      (
        await database.execute(sql`
          SELECT id FROM conversation_messages
          WHERE conversation_id = ${fixture.conversationId}
        `)
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await database.execute(sql`
          SELECT id FROM generation_attempts
          WHERE id = ${attemptId}
        `)
      ).rows,
    ).toHaveLength(0);

    await database.execute(
      sql`DELETE FROM "user" WHERE id = ${fixture.userId}`,
    );
    const afterUserDelete = await database.execute<{
      user_id: string | null;
      input_tokens: number;
      output_tokens: number;
    }>(sql`
      SELECT user_id, input_tokens, output_tokens
      FROM usage_ledger
      WHERE id = ${ledgerId}
    `);
    expect(afterUserDelete.rows[0]).toMatchObject({
      user_id: null,
      input_tokens: "12",
      output_tokens: "8",
    });
  });

  test("account deletion cascades active reservations, leases, buckets, and conversations", async () => {
    const fixture = await chatFixture();
    const attemptId = await insertAttempt({
      assistantMessageId: fixture.assistantMessageId,
    });
    const userBucketId = randomUUID();
    const instanceBucketId = randomUUID();
    const reservationId = randomUUID();
    const periodStart = new Date("2026-10-01T00:00:00.000Z");
    const userPeriodEnd = new Date("2026-10-02T00:00:00.000Z");
    const instancePeriodEnd = new Date("2026-11-01T00:00:00.000Z");

    await database.execute(sql`
      INSERT INTO quota_buckets (
        id,
        scope,
        user_id,
        period_start,
        period_end,
        reserved_requests,
        reserved_tokens
      )
      VALUES
        (
          ${userBucketId},
          'user',
          ${fixture.userId},
          ${periodStart},
          ${userPeriodEnd},
          1,
          1024
        ),
        (
          ${instanceBucketId},
          'instance',
          NULL,
          ${periodStart},
          ${instancePeriodEnd},
          1,
          1024
        )
    `);
    await database.execute(sql`
      INSERT INTO quota_reservations (
        id,
        user_id,
        conversation_id,
        attempt_id,
        user_bucket_id,
        instance_bucket_id,
        reserved_tokens
      )
      VALUES (
        ${reservationId},
        ${fixture.userId},
        ${fixture.conversationId},
        ${attemptId},
        ${userBucketId},
        ${instanceBucketId},
        1024
      )
    `);
    await database.execute(sql`
      INSERT INTO generation_leases (
        attempt_id,
        user_id,
        owner_token,
        expires_at
      )
      VALUES (
        ${attemptId},
        ${fixture.userId},
        'owner-one',
        NOW() + INTERVAL '1 minute'
      )
    `);

    await database.execute(
      sql`DELETE FROM "user" WHERE id = ${fixture.userId}`,
    );

    for (const statement of [
      sql`SELECT id FROM conversations WHERE id = ${fixture.conversationId}`,
      sql`SELECT id FROM quota_reservations WHERE id = ${reservationId}`,
      sql`SELECT attempt_id FROM generation_leases WHERE attempt_id = ${attemptId}`,
      sql`SELECT id FROM quota_buckets WHERE id = ${userBucketId}`,
    ]) {
      expect((await database.execute(statement)).rows).toHaveLength(0);
    }
    const instanceBucket = await database.execute<{
      reserved_requests: string;
      reserved_tokens: string;
    }>(sql`
      SELECT reserved_requests, reserved_tokens
      FROM quota_buckets
      WHERE id = ${instanceBucketId}
    `);
    expect(instanceBucket.rows).toEqual([
      {
        reserved_requests: "0",
        reserved_tokens: "0",
      },
    ]);
  });

  test("rejects malformed quota bucket scopes and UTC periods", async () => {
    const userId = await insertUser();
    const dayStart = new Date("2026-10-09T00:00:00.000Z");
    const dayEnd = new Date("2026-10-10T00:00:00.000Z");
    const monthEnd = new Date("2026-11-01T00:00:00.000Z");

    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO quota_buckets (
          id, scope, user_id, period_start, period_end
        )
        VALUES (${randomUUID()}, 'user', NULL, ${dayStart}, ${dayEnd})
      `),
      /scope/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO quota_buckets (
          id, scope, user_id, period_start, period_end
        )
        VALUES (${randomUUID()}, 'instance', ${userId}, ${dayStart}, ${monthEnd})
      `),
      /scope/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO quota_buckets (
          id, scope, user_id, period_start, period_end
        )
        VALUES (${randomUUID()}, 'user', ${userId}, ${dayStart}, ${monthEnd})
      `),
      /period/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO quota_buckets (
          id, scope, user_id, period_start, period_end
        )
        VALUES (${randomUUID()}, 'instance', NULL, ${dayStart}, ${dayEnd})
      `),
      /period/i,
    );
  });

  test.each([
    {
      scope: "user" as const,
      timeZone: "Asia/Kolkata",
      periodStart: "2026-10-09T00:00:00.000Z",
      periodEnd: "2026-10-10T00:00:00.000Z",
    },
    {
      scope: "user" as const,
      timeZone: "America/Los_Angeles",
      periodStart: "2026-03-08T00:00:00.000Z",
      periodEnd: "2026-03-09T00:00:00.000Z",
    },
    {
      scope: "instance" as const,
      timeZone: "America/Los_Angeles",
      periodStart: "2026-03-01T00:00:00.000Z",
      periodEnd: "2026-04-01T00:00:00.000Z",
    },
  ])(
    "accepts $scope UTC quota periods in the $timeZone session timezone",
    async ({ scope, timeZone, periodEnd, periodStart }) => {
      const userId = scope === "user" ? await insertUser() : null;
      const client = await database.$client.connect();

      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('TimeZone', $1, true)", [
          timeZone,
        ]);
        await client.query(
          `INSERT INTO quota_buckets (
             id,
             scope,
             user_id,
             period_start,
             period_end
           )
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), scope, userId, periodStart, periodEnd],
        );
        await client.query("COMMIT");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    },
  );
});
