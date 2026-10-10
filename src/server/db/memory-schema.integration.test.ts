// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabaseUrl } from "@/test/database-target";
import { createDatabase } from "./client";
import {
  accountDeletionRequest,
  backgroundModelReservation,
  dataExportJob,
  memoryEvidence,
  memoryExtractionRun,
  memoryItem,
  memorySettings,
  relationshipSummary,
  relationshipSummaryRun,
  relationshipSummaryVersion,
  userCharacterMemorySetting,
} from "./memory-schema";

const database = createDatabase(testDatabaseUrl());

void [
  accountDeletionRequest,
  backgroundModelReservation,
  dataExportJob,
  memoryEvidence,
  memoryExtractionRun,
  memoryItem,
  memorySettings,
  relationshipSummary,
  relationshipSummaryRun,
  relationshipSummaryVersion,
  userCharacterMemorySetting,
];

beforeEach(async () => {
  await database.execute(
    sql.raw(`
      TRUNCATE TABLE
        account_deletion_requests,
        data_export_jobs,
        background_model_reservations,
        usage_ledger,
        relationship_summary_runs,
        relationship_summaries,
        relationship_summary_versions,
        memory_evidence,
        memory_extraction_runs,
        memory_items,
        user_character_memory_settings,
        memory_settings,
        generation_leases,
        quota_reservations,
        quota_buckets,
        user_chat_quota_overrides,
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
      'Memory User',
      ${`${id}@example.com`},
      true,
      NOW(),
      NOW()
    )
  `);
  return id;
}

async function insertCharacter(slug = randomUUID()) {
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
      'Mira',
      '/characters/mira.svg',
      'A calm companion.',
      'A calm companion who listens.',
      '["Listen first."]'::jsonb,
      'Warm and direct.',
      'Short paragraphs.',
      '["Avoid dependency."]'::jsonb,
      'Hello.',
      '[]'::jsonb,
      '{"temperature":0.7,"topP":0.9,"maxOutputTokens":800}'::jsonb,
      '[]'::jsonb,
      ${"a".repeat(64)},
      NOW()
    )
  `);

  return { characterId, versionId };
}

async function insertRelationship(
  userId: string,
  characterId: string,
  input: { memoryEpoch?: number; memoryRevision?: number; revision?: number } = {},
) {
  await database.execute(sql`
    INSERT INTO user_character_memory_settings (
      user_id,
      character_id,
      memory_epoch,
      memory_revision,
      revision
    )
    VALUES (
      ${userId},
      ${characterId},
      ${input.memoryEpoch ?? 0},
      ${input.memoryRevision ?? 0},
      ${input.revision ?? 1}
    )
  `);
}

async function insertConversationFixture(
  userId: string,
  characterId: string,
  characterVersionId: string,
) {
  const conversationId = randomUUID();
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const attemptId = randomUUID();

  await database.execute(sql`
    INSERT INTO conversations (
      id,
      user_id,
      character_id,
      character_version_id,
      lifecycle
    )
    VALUES (
      ${conversationId},
      ${userId},
      ${characterId},
      ${characterVersionId},
      'active'
    )
  `);
  await database.execute(sql`
    INSERT INTO conversation_messages (
      id,
      conversation_id,
      sequence,
      role,
      kind,
      content,
      client_request_id
    )
    VALUES (
      ${userMessageId},
      ${conversationId},
      1,
      'user',
      'user',
      'I prefer tea.',
      ${randomUUID()}
    )
  `);
  await database.execute(sql`
    INSERT INTO conversation_messages (
      id,
      conversation_id,
      sequence,
      role,
      kind,
      content,
      in_reply_to
    )
    VALUES (
      ${assistantMessageId},
      ${conversationId},
      2,
      'assistant',
      'generated',
      NULL,
      ${userMessageId}
    )
  `);
  await database.execute(sql`
    INSERT INTO generation_attempts (
      id,
      user_id,
      assistant_message_id,
      attempt_number,
      is_current,
      status,
      content,
      model_id,
      input_tokens,
      output_tokens,
      usage_is_estimated,
      completed_at
    )
    VALUES (
      ${attemptId},
      ${userId},
      ${assistantMessageId},
      1,
      true,
      'complete',
      'I will remember that.',
      'test-model',
      20,
      5,
      false,
      NOW()
    )
  `);

  return { attemptId, assistantMessageId, conversationId, userMessageId };
}

async function insertMemory(input: {
  userId: string;
  characterId: string;
  memoryEpoch?: number;
  origin?: "automatic" | "user_edited";
  digest?: string;
  content?: string;
}) {
  const id = randomUUID();
  const content = input.content ?? "Prefers tea";
  await database.execute(sql`
    INSERT INTO memory_items (
      id,
      user_id,
      character_id,
      memory_epoch,
      type,
      content,
      normalized_content,
      normalized_digest,
      origin,
      sensitivity,
      explicitness,
      confidence,
      importance,
      first_observed_at,
      last_confirmed_at,
      user_edited_at,
      revision
    )
    VALUES (
      ${id},
      ${input.userId},
      ${input.characterId},
      ${input.memoryEpoch ?? 0},
      'preference',
      ${content},
      ${content.toLocaleLowerCase("en-US")},
      ${input.digest ?? "b".repeat(64)},
      ${input.origin ?? "automatic"},
      'ordinary',
      'direct',
      80,
      60,
      NOW(),
      NOW(),
      ${input.origin === "user_edited" ? new Date() : null},
      1
    )
  `);
  return id;
}

describe("relationship memory settings invariants", () => {
  test("defaults relationship controls independently and preserves immutable monotonic identity", async () => {
    const userId = await insertUser();
    const secondUserId = await insertUser();
    const { characterId } = await insertCharacter();
    await database.execute(sql`
      INSERT INTO memory_settings (
        id,
        enabled,
        deployment_default_enabled,
        revision
      )
      VALUES ('global', false, false, 1)
    `);
    await insertRelationship(userId, characterId);

    const settings = await database.execute<{
      memory_epoch: number;
      memory_revision: number;
      recording_enabled: boolean;
      revision: number;
      usage_enabled: boolean;
    }>(sql`
      SELECT
        recording_enabled,
        usage_enabled,
        memory_epoch,
        memory_revision,
        revision
      FROM user_character_memory_settings
      WHERE user_id = ${userId}
        AND character_id = ${characterId}
    `);
    expect(settings.rows).toEqual([
      {
        recording_enabled: true,
        usage_enabled: true,
        memory_epoch: 0,
        memory_revision: 0,
        revision: 1,
      },
    ]);

    await expectDatabaseError(
      database.execute(sql`
        UPDATE user_character_memory_settings
        SET user_id = ${secondUserId}
        WHERE user_id = ${userId}
          AND character_id = ${characterId}
      `),
      /identity.*immutable/i,
    );
    await database.execute(sql`
      UPDATE user_character_memory_settings
      SET memory_epoch = 2,
          memory_revision = 3,
          revision = 2
      WHERE user_id = ${userId}
        AND character_id = ${characterId}
    `);
    await expectDatabaseError(
      database.execute(sql`
        UPDATE user_character_memory_settings
        SET memory_epoch = 1
        WHERE user_id = ${userId}
          AND character_id = ${characterId}
      `),
      /memory epoch.*decrease/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE user_character_memory_settings
        SET memory_revision = 2
        WHERE user_id = ${userId}
          AND character_id = ${characterId}
      `),
      /memory revision.*decrease/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE user_character_memory_settings
        SET revision = 1
        WHERE user_id = ${userId}
          AND character_id = ${characterId}
      `),
      /revision.*decrease/i,
    );
  });
});

describe("memory item invariants", () => {
  test("enforces current epoch, bounded content and scores, and active digest uniqueness", async () => {
    const userId = await insertUser();
    const { characterId } = await insertCharacter();
    await insertRelationship(userId, characterId);
    await insertMemory({ userId, characterId });

    await expectDatabaseError(
      insertMemory({ userId, characterId, digest: "b".repeat(64) }),
      /unique|duplicate/i,
    );
    await expectDatabaseError(
      insertMemory({
        userId,
        characterId,
        digest: "c".repeat(64),
        memoryEpoch: 1,
      }),
      /current relationship epoch/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO memory_items (
          id, user_id, character_id, memory_epoch, type, content,
          normalized_content, normalized_digest, origin, sensitivity,
          explicitness, confidence, importance, first_observed_at,
          last_confirmed_at, revision
        )
        VALUES (
          ${randomUUID()}, ${userId}, ${characterId}, 0, 'preference',
          ${"😀".repeat(501)}, 'too long', ${"d".repeat(64)}, 'automatic',
          'ordinary', 'direct', 80, 60, NOW(), NOW(), 1
        )
      `),
      /content.*length|memory_items_content/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE memory_items
        SET confidence = 101
        WHERE user_id = ${userId}
          AND character_id = ${characterId}
      `),
      /confidence/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE memory_items
        SET importance = -1
        WHERE user_id = ${userId}
          AND character_id = ${characterId}
      `),
      /importance/i,
    );
  });

  test("prevents identity changes and automatic replacement of user-edited content", async () => {
    const userId = await insertUser();
    const secondUserId = await insertUser();
    const { characterId } = await insertCharacter();
    await insertRelationship(userId, characterId);
    await insertRelationship(secondUserId, characterId);
    const memoryId = await insertMemory({
      userId,
      characterId,
      origin: "user_edited",
    });

    await expectDatabaseError(
      database.execute(sql`
        UPDATE memory_items
        SET user_id = ${secondUserId}
        WHERE id = ${memoryId}
      `),
      /identity.*immutable/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE memory_items
        SET content = 'Automatically overwritten',
            normalized_content = 'automatically overwritten',
            normalized_digest = ${"e".repeat(64)},
            origin = 'automatic',
            revision = 2
        WHERE id = ${memoryId}
      `),
      /user-edited.*automatic/i,
    );
  });
});

describe("evidence and extraction invariants", () => {
  test("validates evidence ownership and prevents duplicate source messages", async () => {
    const userId = await insertUser();
    const otherUserId = await insertUser();
    const { characterId, versionId } = await insertCharacter();
    const otherCharacter = await insertCharacter();
    await insertRelationship(userId, characterId);
    await insertRelationship(otherUserId, otherCharacter.characterId);
    const memoryId = await insertMemory({ userId, characterId });
    const source = await insertConversationFixture(
      userId,
      characterId,
      versionId,
    );
    const wrongSource = await insertConversationFixture(
      otherUserId,
      otherCharacter.characterId,
      otherCharacter.versionId,
    );

    await database.execute(sql`
      INSERT INTO memory_evidence (
        id,
        memory_id,
        source_message_id,
        source_attempt_id,
        observed_at,
        evidence_kind
      )
      VALUES (
        ${randomUUID()},
        ${memoryId},
        ${source.userMessageId},
        ${source.attemptId},
        NOW(),
        'direct'
      )
    `);
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO memory_evidence (
          id,
          memory_id,
          source_message_id,
          source_attempt_id,
          observed_at,
          evidence_kind
        )
        VALUES (
          ${randomUUID()},
          ${memoryId},
          ${source.userMessageId},
          ${source.attemptId},
          NOW(),
          'supporting'
        )
      `),
      /unique|duplicate/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO memory_evidence (
          id,
          memory_id,
          source_message_id,
          source_attempt_id,
          observed_at,
          evidence_kind
        )
        VALUES (
          ${randomUUID()},
          ${memoryId},
          ${wrongSource.userMessageId},
          ${wrongSource.attemptId},
          NOW(),
          'supporting'
        )
      `),
      /same user and character/i,
    );
  });

  test("keeps formed memory while conversation deletion nulls evidence and cancels unapplied extraction", async () => {
    const userId = await insertUser();
    const { characterId, versionId } = await insertCharacter();
    await insertRelationship(userId, characterId);
    const memoryId = await insertMemory({ userId, characterId });
    const source = await insertConversationFixture(
      userId,
      characterId,
      versionId,
    );
    const extractionRunId = randomUUID();

    await database.execute(sql`
      INSERT INTO memory_evidence (
        id,
        memory_id,
        source_message_id,
        source_attempt_id,
        observed_at,
        evidence_kind
      )
      VALUES (
        ${randomUUID()},
        ${memoryId},
        ${source.userMessageId},
        ${source.attemptId},
        NOW(),
        'direct'
      )
    `);
    await database.execute(sql`
      INSERT INTO memory_extraction_runs (
        id,
        user_id,
        character_id,
        conversation_id,
        generation_attempt_id,
        memory_epoch,
        status,
        attempt_count,
        estimated_input_tokens,
        provider_request_ids
      )
      VALUES (
        ${extractionRunId},
        ${userId},
        ${characterId},
        ${source.conversationId},
        ${source.attemptId},
        0,
        'running',
        1,
        40,
        '[]'::jsonb
      )
    `);

    await database.execute(sql`
      DELETE FROM conversations
      WHERE id = ${source.conversationId}
    `);

    const memories = await database.execute<{ id: string }>(sql`
      SELECT id FROM memory_items WHERE id = ${memoryId}
    `);
    const evidence = await database.execute<{
      source_attempt_id: string | null;
      source_deleted_at: Date | null;
      source_message_id: string | null;
    }>(sql`
      SELECT source_message_id, source_attempt_id, source_deleted_at
      FROM memory_evidence
      WHERE memory_id = ${memoryId}
    `);
    const runs = await database.execute<{
      conversation_id: string | null;
      finished_at: Date | null;
      generation_attempt_id: string | null;
      status: string;
    }>(sql`
      SELECT conversation_id, generation_attempt_id, status, finished_at
      FROM memory_extraction_runs
      WHERE id = ${extractionRunId}
    `);

    expect(memories.rows).toEqual([{ id: memoryId }]);
    expect(evidence.rows[0]).toMatchObject({
      source_message_id: null,
      source_attempt_id: null,
    });
    expect(evidence.rows[0]?.source_deleted_at).not.toBeNull();
    expect(runs.rows[0]).toMatchObject({
      conversation_id: null,
      generation_attempt_id: null,
      status: "cancelled",
    });
    expect(runs.rows[0]?.finished_at).not.toBeNull();
  });

  test("allows one extraction per attempt and makes terminal extraction status immutable", async () => {
    const userId = await insertUser();
    const { characterId, versionId } = await insertCharacter();
    await insertRelationship(userId, characterId);
    const source = await insertConversationFixture(
      userId,
      characterId,
      versionId,
    );
    const extractionRunId = randomUUID();

    await database.execute(sql`
      INSERT INTO memory_extraction_runs (
        id, user_id, character_id, conversation_id, generation_attempt_id,
        memory_epoch, status, attempt_count, estimated_input_tokens,
        provider_request_ids, finished_at
      )
      VALUES (
        ${extractionRunId}, ${userId}, ${characterId}, ${source.conversationId},
        ${source.attemptId}, 0, 'complete', 1, 40, '[]'::jsonb, NOW()
      )
    `);
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO memory_extraction_runs (
          id, user_id, character_id, conversation_id, generation_attempt_id,
          memory_epoch, status, attempt_count, estimated_input_tokens,
          provider_request_ids
        )
        VALUES (
          ${randomUUID()}, ${userId}, ${characterId}, ${source.conversationId},
          ${source.attemptId}, 0, 'pending', 0, 40, '[]'::jsonb
        )
      `),
      /unique|duplicate/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE memory_extraction_runs
        SET status = 'failed'
        WHERE id = ${extractionRunId}
      `),
      /terminal.*immutable/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE memory_extraction_runs
        SET error_category = 'late_mutation'
        WHERE id = ${extractionRunId}
      `),
      /terminal.*immutable/i,
    );
  });

  test("accepts extraction only for a completed attempt owned by the captured relationship", async () => {
    const userId = await insertUser();
    const { characterId, versionId } = await insertCharacter();
    await insertRelationship(userId, characterId);
    const source = await insertConversationFixture(
      userId,
      characterId,
      versionId,
    );
    await database.execute(sql`
      DELETE FROM generation_attempts
      WHERE id = ${source.attemptId}
    `);
    await database.execute(sql`
      INSERT INTO generation_attempts (
        id, user_id, assistant_message_id, attempt_number, is_current, status,
        content, model_id, completed_at
      )
      VALUES (
        ${source.attemptId}, ${userId}, ${source.assistantMessageId}, 1, true,
        'failed', '', 'test-model', NOW()
      )
    `);

    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO memory_extraction_runs (
          id, user_id, character_id, conversation_id, generation_attempt_id,
          memory_epoch, status, attempt_count, estimated_input_tokens,
          provider_request_ids
        )
        VALUES (
          ${randomUUID()}, ${userId}, ${characterId}, ${source.conversationId},
          ${source.attemptId}, 0, 'pending', 0, 40, '[]'::jsonb
        )
      `),
      /completed generation attempt.*relationship/i,
    );
  });
});

describe("relationship summary invariants", () => {
  test("requires the current version to share relationship ownership and protects user-edited current summaries", async () => {
    const userId = await insertUser();
    const otherUserId = await insertUser();
    const { characterId } = await insertCharacter();
    const otherCharacter = await insertCharacter();
    await insertRelationship(userId, characterId);
    await insertRelationship(otherUserId, otherCharacter.characterId);
    const ownVersionId = randomUUID();
    const otherVersionId = randomUUID();

    await database.execute(sql`
      INSERT INTO relationship_summary_versions (
        id, user_id, character_id, memory_epoch, content, origin,
        based_on_memory_revision
      )
      VALUES
        (
          ${ownVersionId}, ${userId}, ${characterId}, 0,
          'User-written summary', 'user_edited', 0
        ),
        (
          ${otherVersionId}, ${otherUserId}, ${otherCharacter.characterId}, 0,
          'Other summary', 'automatic', 0
        )
    `);
    await database.execute(sql`
      INSERT INTO relationship_summaries (
        user_id, character_id, memory_epoch, current_version_id, revision
      )
      VALUES (${userId}, ${characterId}, 0, ${ownVersionId}, 1)
    `);

    await expectDatabaseError(
      database.execute(sql`
        UPDATE relationship_summaries
        SET current_version_id = ${otherVersionId},
            revision = 2
        WHERE user_id = ${userId}
          AND character_id = ${characterId}
      `),
      /current summary version.*ownership/i,
    );

    const automaticVersionId = randomUUID();
    await database.execute(sql`
      INSERT INTO relationship_summary_versions (
        id, user_id, character_id, memory_epoch, content, origin,
        based_on_memory_revision
      )
      VALUES (
        ${automaticVersionId}, ${userId}, ${characterId}, 0,
        'Automatic replacement', 'automatic', 0
      )
    `);
    await expectDatabaseError(
      database.execute(sql`
        UPDATE relationship_summaries
        SET current_version_id = ${automaticVersionId},
            revision = 2
        WHERE user_id = ${userId}
          AND character_id = ${characterId}
      `),
      /user-edited.*automatic/i,
    );
  });

  test("allows one summary run per relationship epoch and memory revision and freezes terminal runs", async () => {
    const userId = await insertUser();
    const { characterId } = await insertCharacter();
    await insertRelationship(userId, characterId);
    const runId = randomUUID();

    await database.execute(sql`
      INSERT INTO relationship_summary_runs (
        id, user_id, character_id, memory_epoch, expected_summary_revision,
        based_on_memory_revision, status, attempt_count,
        estimated_input_tokens, provider_request_ids, finished_at
      )
      VALUES (
        ${runId}, ${userId}, ${characterId}, 0, 0, 0, 'failed', 1,
        50, '[]'::jsonb, NOW()
      )
    `);
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO relationship_summary_runs (
          id, user_id, character_id, memory_epoch, expected_summary_revision,
          based_on_memory_revision, status, attempt_count,
          estimated_input_tokens, provider_request_ids
        )
        VALUES (
          ${randomUUID()}, ${userId}, ${characterId}, 0, 0, 0, 'pending', 0,
          50, '[]'::jsonb
        )
      `),
      /unique|duplicate/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE relationship_summary_runs
        SET status = 'cancelled'
        WHERE id = ${runId}
      `),
      /terminal.*immutable/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE relationship_summary_runs
        SET error_category = 'late_mutation'
        WHERE id = ${runId}
      `),
      /terminal.*immutable/i,
    );
  });

  test("captures only the current relationship epoch and memory revision", async () => {
    const userId = await insertUser();
    const { characterId } = await insertCharacter();
    await insertRelationship(userId, characterId, {
      memoryEpoch: 2,
      memoryRevision: 4,
    });

    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO relationship_summary_runs (
          id, user_id, character_id, memory_epoch, expected_summary_revision,
          based_on_memory_revision, status, attempt_count,
          estimated_input_tokens, provider_request_ids
        )
        VALUES (
          ${randomUUID()}, ${userId}, ${characterId}, 2, 0, 3, 'pending', 0,
          50, '[]'::jsonb
        )
      `),
      /current relationship epoch and memory revision/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO relationship_summaries (
          user_id, character_id, memory_epoch, current_version_id, revision
        )
        VALUES (${userId}, ${characterId}, 1, NULL, 1)
      `),
      /current relationship epoch/i,
    );
  });
});

describe("background usage invariants", () => {
  test("settles each background operation exactly once", async () => {
    const reservationId = randomUUID();
    const operationId = randomUUID();
    const periodStart = new Date("2026-10-01T00:00:00.000Z");
    const periodEnd = new Date("2026-11-01T00:00:00.000Z");

    await database.execute(sql`
      INSERT INTO background_model_reservations (
        id, operation_id, workload_type, period_start, period_end,
        reserved_tokens, consumed_input_tokens, consumed_output_tokens
      )
      VALUES (
        ${reservationId}, ${operationId}, 'memory_extraction',
        ${periodStart}, ${periodEnd}, 100, 0, 0
      )
    `);
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO background_model_reservations (
          id, operation_id, workload_type, period_start, period_end,
          reserved_tokens, consumed_input_tokens, consumed_output_tokens
        )
        VALUES (
          ${randomUUID()}, ${operationId}, 'memory_extraction',
          ${periodStart}, ${periodEnd}, 100, 0, 0
        )
      `),
      /unique|duplicate/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        UPDATE background_model_reservations
        SET consumed_input_tokens = 10
        WHERE id = ${reservationId}
      `),
      /settlement[_ ]shape|terminal settlement/i,
    );
    await database.execute(sql`
      UPDATE background_model_reservations
      SET consumed_input_tokens = 60,
          consumed_output_tokens = 20,
          settled_at = NOW()
      WHERE id = ${reservationId}
    `);
    await expectDatabaseError(
      database.execute(sql`
        UPDATE background_model_reservations
        SET consumed_output_tokens = 21
        WHERE id = ${reservationId}
      `),
      /terminal settlement.*immutable/i,
    );
  });

  test("stores cancelled background usage under a unique operation identity without chat request units", async () => {
    const operationId = randomUUID();
    await database.execute(sql`
      INSERT INTO usage_ledger (
        id, background_operation_id, workload_type, period_start, period_end,
        user_request_units, provider_call_number, input_tokens, output_tokens,
        usage_is_estimated, model_id, outcome, automatic_retry_count
      )
      VALUES (
        ${randomUUID()}, ${operationId}, 'summary_refresh',
        '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z',
        0, 1, 0, 0, false, 'test-model', 'cancelled', 0
      )
    `);
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO usage_ledger (
          id, background_operation_id, workload_type, period_start, period_end,
          user_request_units, provider_call_number, input_tokens, output_tokens,
          usage_is_estimated, model_id, outcome, automatic_retry_count
        )
        VALUES (
          ${randomUUID()}, ${operationId}, 'summary_refresh',
          '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z',
          0, 2, 0, 0, false, 'test-model', 'failed', 0
        )
      `),
      /unique|duplicate/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO usage_ledger (
          id, background_operation_id, workload_type, period_start, period_end,
          user_request_units, provider_call_number, input_tokens, output_tokens,
          usage_is_estimated, model_id, outcome, automatic_retry_count
        )
        VALUES (
          ${randomUUID()}, ${randomUUID()}, 'memory_extraction',
          '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z',
          1, 1, 0, 0, false, 'test-model', 'failed', 0
        )
      `),
      /workload[_ ]shape|background.*request units/i,
    );
  });
});

describe("export and deletion invariants", () => {
  test("allows one active export per user and stores archives only for exact unexpired completion windows", async () => {
    const userId = await insertUser();
    await database.execute(sql`
      INSERT INTO data_export_jobs (id, user_id, status)
      VALUES (${randomUUID()}, ${userId}, 'pending')
    `);
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO data_export_jobs (id, user_id, status)
        VALUES (${randomUUID()}, ${userId}, 'running')
      `),
      /unique|active export/i,
    );
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO data_export_jobs (
          id, user_id, status, archive_bytes, archive_size, archive_sha256
        )
        VALUES (
          ${randomUUID()}, ${userId}, 'pending', ${Buffer.from("zip")}, 3,
          ${"f".repeat(64)}
        )
      `),
      /archive.*completed/i,
    );

    await database.execute(sql`
      DELETE FROM data_export_jobs WHERE user_id = ${userId}
    `);
    const completedAt = new Date(Date.now() + 60_000);
    const expiresAt = new Date(completedAt.getTime() + 24 * 60 * 60 * 1_000);
    await database.execute(sql`
      INSERT INTO data_export_jobs (
        id, user_id, status, archive_bytes, archive_size, archive_sha256,
        completed_at, expires_at
      )
      VALUES (
        ${randomUUID()}, ${userId}, 'complete', ${Buffer.from("zip")}, 3,
        ${"f".repeat(64)}, ${completedAt}, ${expiresAt}
      )
    `);
    await expectDatabaseError(
      database.execute(sql`
        INSERT INTO data_export_jobs (
          id, user_id, status, archive_bytes, archive_size, archive_sha256,
          completed_at, expires_at
        )
        VALUES (
          ${randomUUID()}, ${userId}, 'complete', ${Buffer.from("zip")}, 3,
          ${"e".repeat(64)}, ${completedAt},
          ${new Date(expiresAt.getTime() + 1_000)}
        )
      `),
      /exactly 24 hours|archive[_ ]shape/i,
    );
  });

  test("keeps an unfinished purge attached to its user and preserves a content-free completed tombstone", async () => {
    const userId = await insertUser();
    const pendingId = randomUUID();
    await database.execute(sql`
      INSERT INTO account_deletion_requests (
        id, user_id, verification_token_hash, verification_expires_at,
        status, current_stage, attempt_count
      )
      VALUES (
        ${pendingId}, ${userId}, ${"a".repeat(64)},
        NOW() + INTERVAL '30 minutes', 'pending_confirmation',
        'verification', 0
      )
    `);
    await expectDatabaseError(
      database.execute(sql`
        UPDATE account_deletion_requests
        SET user_id = NULL
        WHERE id = ${pendingId}
      `),
      /user[_ ]completion|user.*only.*complete/i,
    );
    await expectDatabaseError(
      database.execute(sql`DELETE FROM "user" WHERE id = ${userId}`),
      /unfinished account deletion|user.*only.*complete|account_deletion/i,
    );

    await database.execute(sql`
      UPDATE account_deletion_requests
      SET status = 'complete',
          verification_token_hash = NULL,
          verification_expires_at = NULL,
          verification_consumed_at = NOW(),
          confirmed_at = NOW(),
          locked_at = NOW(),
          completed_at = NOW(),
          current_stage = 'complete'
      WHERE id = ${pendingId}
    `);
    await database.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);

    const tombstone = await database.execute<{
      status: string;
      user_id: string | null;
      verification_token_hash: string | null;
    }>(sql`
      SELECT user_id, status, verification_token_hash
      FROM account_deletion_requests
      WHERE id = ${pendingId}
    `);
    expect(tombstone.rows).toEqual([
      {
        user_id: null,
        status: "complete",
        verification_token_hash: null,
      },
    ]);

    const otherUserId = await insertUser();
    await expectDatabaseError(
      database.execute(sql`
        UPDATE account_deletion_requests
        SET user_id = ${otherUserId}
        WHERE id = ${pendingId}
      `),
      /completed.*tombstone.*immutable/i,
    );
  });
});
