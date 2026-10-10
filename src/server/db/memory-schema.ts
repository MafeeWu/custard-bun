import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { character } from "./character-schema";
import {
  conversation,
  conversationMessage,
  generationAttempt,
} from "./chat-schema";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const nonnegative = (column: AnyPgColumn) => sql`${column} >= 0`;
const positive = (column: AnyPgColumn) => sql`${column} > 0`;

export const memoryTypeEnum = pgEnum("memory_type", [
  "preferred_name",
  "preference",
  "important_person",
  "personal_fact",
  "future_plan",
  "shared_event",
  "commitment",
  "other",
]);

export const memoryOriginEnum = pgEnum("memory_origin", [
  "automatic",
  "user_edited",
]);

export const memorySensitivityEnum = pgEnum("memory_sensitivity", [
  "ordinary",
  "personal_explicit",
]);

export const memoryExplicitnessEnum = pgEnum("memory_explicitness", [
  "direct",
  "repeated_inference",
]);

export const memoryEvidenceKindEnum = pgEnum("memory_evidence_kind", [
  "direct",
  "supporting",
]);

export const backgroundOperationStatusEnum = pgEnum(
  "background_operation_status",
  [
    "pending",
    "queued",
    "running",
    "retrying",
    "complete",
    "failed",
    "dead_letter",
    "cancelled",
  ],
);

export const backgroundWorkloadTypeEnum = pgEnum("background_workload_type", [
  "memory_extraction",
  "summary_refresh",
]);

export const dataExportStatusEnum = pgEnum("data_export_status", [
  "pending",
  "running",
  "complete",
  "failed",
  "expired",
  "cancelled",
]);

export const accountDeletionStatusEnum = pgEnum("account_deletion_status", [
  "pending_confirmation",
  "locked",
  "purging",
  "complete",
  "dead_letter",
]);

export type BackgroundOperationStatus =
  (typeof backgroundOperationStatusEnum.enumValues)[number];
export type BackgroundWorkloadType =
  (typeof backgroundWorkloadTypeEnum.enumValues)[number];
export type DataExportStatus = (typeof dataExportStatusEnum.enumValues)[number];
export type AccountDeletionStatus =
  (typeof accountDeletionStatusEnum.enumValues)[number];

export const memorySettings = pgTable(
  "memory_settings",
  {
    id: text("id").primaryKey(),
    enabled: boolean("enabled").notNull(),
    deploymentDefaultEnabled: boolean("deployment_default_enabled").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("memory_settings_global_id_check", sql`${table.id} = 'global'`),
    check("memory_settings_revision_positive", positive(table.revision)),
  ],
);

export const userCharacterMemorySetting = pgTable(
  "user_character_memory_settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "restrict" }),
    recordingEnabled: boolean("recording_enabled").notNull().default(true),
    usageEnabled: boolean("usage_enabled").notNull().default(true),
    memoryEpoch: integer("memory_epoch").notNull().default(0),
    memoryRevision: integer("memory_revision").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "user_character_memory_settings_pk",
      columns: [table.userId, table.characterId],
    }),
    index("user_character_memory_settings_character_idx").on(
      table.characterId,
      table.userId,
    ),
    check(
      "user_character_memory_settings_epoch_nonnegative",
      nonnegative(table.memoryEpoch),
    ),
    check(
      "user_character_memory_settings_memory_revision_nonnegative",
      nonnegative(table.memoryRevision),
    ),
    check(
      "user_character_memory_settings_revision_positive",
      positive(table.revision),
    ),
  ],
);

export const memoryItem = pgTable(
  "memory_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "restrict" }),
    memoryEpoch: integer("memory_epoch").notNull(),
    type: memoryTypeEnum("type").notNull(),
    content: text("content").notNull(),
    normalizedContent: text("normalized_content").notNull(),
    normalizedDigest: text("normalized_digest").notNull(),
    automaticDigest: text("automatic_digest"),
    isActive: boolean("is_active").notNull().default(true),
    origin: memoryOriginEnum("origin").notNull(),
    sensitivity: memorySensitivityEnum("sensitivity").notNull(),
    explicitness: memoryExplicitnessEnum("explicitness").notNull(),
    confidence: integer("confidence").notNull(),
    importance: integer("importance").notNull(),
    firstObservedAt: timestamp("first_observed_at", {
      withTimezone: true,
    }).notNull(),
    lastConfirmedAt: timestamp("last_confirmed_at", {
      withTimezone: true,
    }).notNull(),
    userEditedAt: timestamp("user_edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    unique("memory_items_relationship_type_epoch_digest_unique").on(
      table.userId,
      table.characterId,
      table.type,
      table.memoryEpoch,
      table.normalizedDigest,
    ),
    index("memory_items_relationship_recall_idx").on(
      table.userId,
      table.characterId,
      table.memoryEpoch,
      table.importance,
      table.confidence,
      table.lastConfirmedAt,
    ),
    check("memory_items_epoch_nonnegative", nonnegative(table.memoryEpoch)),
    check(
      "memory_items_content_length_check",
      sql`CHAR_LENGTH(${table.content}) BETWEEN 1 AND 500 AND OCTET_LENGTH(${table.content}) <= 2000`,
    ),
    check(
      "memory_items_normalized_content_length_check",
      sql`CHAR_LENGTH(${table.normalizedContent}) BETWEEN 1 AND 500 AND OCTET_LENGTH(${table.normalizedContent}) <= 2000`,
    ),
    check(
      "memory_items_normalized_digest_check",
      sql`${table.normalizedDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "memory_items_confidence_range",
      sql`${table.confidence} BETWEEN 0 AND 100`,
    ),
    check(
      "memory_items_importance_range",
      sql`${table.importance} BETWEEN 0 AND 100`,
    ),
    check(
      "memory_items_observation_order_check",
      sql`${table.lastConfirmedAt} >= ${table.firstObservedAt}`,
    ),
    check(
      "memory_items_user_edit_shape_check",
      sql`(
        (${table.origin} = 'automatic' AND ${table.userEditedAt} IS NULL)
        OR
        (${table.origin} = 'user_edited' AND ${table.userEditedAt} IS NOT NULL)
      )`,
    ),
    check(
      "memory_items_sensitive_inference_check",
      sql`NOT (
        ${table.sensitivity} = 'personal_explicit'
        AND ${table.explicitness} = 'repeated_inference'
      )`,
    ),
    check("memory_items_revision_positive", positive(table.revision)),
  ],
);

export const memoryExtractionRun = pgTable(
  "memory_extraction_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "restrict" }),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    generationAttemptId: text("generation_attempt_id").references(
      () => generationAttempt.id,
      { onDelete: "set null" },
    ),
    memoryEpoch: integer("memory_epoch").notNull(),
    status: backgroundOperationStatusEnum("status")
      .notNull()
      .default("pending"),
    jobId: text("job_id"),
    deadLetterPublishedAt: timestamp("dead_letter_published_at", {
      withTimezone: true,
    }),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimToken: text("claim_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    errorCategory: text("error_category"),
    providerRequestIds: jsonb("provider_request_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    estimatedInputTokens: bigint("estimated_input_tokens", { mode: "number" })
      .notNull()
      .default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    usageEstimated: boolean("usage_estimated"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("memory_extraction_runs_attempt_unique")
      .on(table.generationAttemptId)
      .where(sql`${table.generationAttemptId} IS NOT NULL`),
    uniqueIndex("memory_extraction_runs_job_unique")
      .on(table.jobId)
      .where(sql`${table.jobId} IS NOT NULL`),
    index("memory_extraction_runs_pending_idx").on(
      table.status,
      table.nextRetryAt,
      table.createdAt,
    ),
    index("memory_extraction_runs_relationship_idx").on(
      table.userId,
      table.characterId,
      table.memoryEpoch,
    ),
    check(
      "memory_extraction_runs_epoch_nonnegative",
      nonnegative(table.memoryEpoch),
    ),
    check(
      "memory_extraction_runs_dead_letter_publication_shape",
      sql`${table.deadLetterPublishedAt} IS NULL OR ${table.status} = 'dead_letter'`,
    ),
    check(
      "memory_extraction_runs_attempt_count_nonnegative",
      nonnegative(table.attemptCount),
    ),
    check(
      "memory_extraction_runs_attempt_count_limit",
      sql`${table.attemptCount} <= 5`,
    ),
    check(
      "memory_extraction_runs_estimated_tokens_nonnegative",
      nonnegative(table.estimatedInputTokens),
    ),
    check(
      "memory_extraction_runs_input_tokens_nonnegative",
      sql`${table.inputTokens} IS NULL OR ${nonnegative(table.inputTokens)}`,
    ),
    check(
      "memory_extraction_runs_output_tokens_nonnegative",
      sql`${table.outputTokens} IS NULL OR ${nonnegative(table.outputTokens)}`,
    ),
    check(
      "memory_extraction_runs_usage_shape_check",
      sql`(
        (${table.inputTokens} IS NULL AND ${table.outputTokens} IS NULL AND ${table.usageEstimated} IS NULL)
        OR
        (${table.inputTokens} IS NOT NULL AND ${table.outputTokens} IS NOT NULL AND ${table.usageEstimated} IS NOT NULL)
      )`,
    ),
    check(
      "memory_extraction_runs_terminal_shape_check",
      sql`(
        (${table.status} IN ('complete', 'failed', 'dead_letter', 'cancelled') AND ${table.finishedAt} IS NOT NULL)
        OR
        (${table.status} IN ('pending', 'queued', 'running', 'retrying') AND ${table.finishedAt} IS NULL)
      )`,
    ),
  ],
);

export const memoryExtractionExecution = pgTable(
  "memory_extraction_executions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => memoryExtractionRun.id, {
        onDelete: "cascade",
      }),
    executionNumber: integer("execution_number").notNull(),
    candidates:
      jsonb("candidates").$type<
        import("@/server/memory/memory-contracts").MemoryCandidate[]
      >(),
    modelId: text("model_id").notNull(),
    providerIdentity: jsonb("provider_identity")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    estimatedInputTokens: bigint("estimated_input_tokens", {
      mode: "number",
    }).notNull(),
    estimatedOutputTokens: bigint("estimated_output_tokens", { mode: "number" })
      .notNull()
      .default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    latencyMs: integer("latency_ms").notNull().default(0),
    errorCategory: text("error_category"),
    retryable: boolean("retryable").notNull().default(false),
    responseAt: timestamp("response_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("memory_extraction_executions_run_number_unique").on(
      table.runId,
      table.executionNumber,
    ),
    check(
      "memory_extraction_executions_number_check",
      sql`${table.executionNumber} BETWEEN 1 AND 5`,
    ),
    check(
      "memory_extraction_executions_tokens_check",
      sql`
      ${table.estimatedInputTokens} >= 0 AND ${table.estimatedOutputTokens} >= 0
      AND (${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0)
      AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0)
      AND ${table.latencyMs} >= 0
    `,
    ),
    check(
      "memory_extraction_executions_receipt_shape",
      sql`
      (${table.settledAt} IS NULL OR (${table.responseAt} IS NOT NULL AND ${table.candidates} IS NULL))
      AND (${table.candidates} IS NULL OR (JSONB_TYPEOF(${table.candidates}) = 'array' AND JSONB_ARRAY_LENGTH(${table.candidates}) <= 20))
    `,
    ),
  ],
);

export const memoryEvidence = pgTable(
  "memory_evidence",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memoryItem.id, { onDelete: "cascade" }),
    sourceMessageId: text("source_message_id").references(
      () => conversationMessage.id,
      { onDelete: "set null" },
    ),
    sourceAttemptId: text("source_attempt_id").references(
      () => generationAttempt.id,
      { onDelete: "set null" },
    ),
    sourceDeletedAt: timestamp("source_deleted_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    evidenceKind: memoryEvidenceKindEnum("evidence_kind").notNull(),
  },
  (table) => [
    uniqueIndex("memory_evidence_message_unique")
      .on(table.memoryId, table.sourceMessageId)
      .where(sql`${table.sourceMessageId} IS NOT NULL`),
    index("memory_evidence_memory_idx").on(table.memoryId, table.observedAt),
    check(
      "memory_evidence_source_shape_check",
      sql`(
        (${table.sourceMessageId} IS NOT NULL AND ${table.sourceDeletedAt} IS NULL)
        OR
        (${table.sourceMessageId} IS NULL AND ${table.sourceAttemptId} IS NULL AND ${table.sourceDeletedAt} IS NOT NULL)
      )`,
    ),
  ],
);

export const relationshipSummaryVersion = pgTable(
  "relationship_summary_versions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "restrict" }),
    memoryEpoch: integer("memory_epoch").notNull(),
    content: text("content").notNull(),
    origin: memoryOriginEnum("origin").notNull(),
    basedOnMemoryRevision: integer("based_on_memory_revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("relationship_summary_versions_identity_unique").on(
      table.id,
      table.userId,
      table.characterId,
      table.memoryEpoch,
    ),
    index("relationship_summary_versions_relationship_idx").on(
      table.userId,
      table.characterId,
      table.memoryEpoch,
      table.createdAt,
    ),
    check(
      "relationship_summary_versions_epoch_nonnegative",
      nonnegative(table.memoryEpoch),
    ),
    check(
      "relationship_summary_versions_memory_revision_nonnegative",
      nonnegative(table.basedOnMemoryRevision),
    ),
    check(
      "relationship_summary_versions_content_length_check",
      sql`CHAR_LENGTH(${table.content}) <= 4000 AND OCTET_LENGTH(${table.content}) <= 16000`,
    ),
  ],
);

export const relationshipSummary = pgTable(
  "relationship_summaries",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "restrict" }),
    memoryEpoch: integer("memory_epoch").notNull(),
    currentVersionId: text("current_version_id").references(
      () => relationshipSummaryVersion.id,
      { onDelete: "set null" },
    ),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "relationship_summaries_pk",
      columns: [table.userId, table.characterId],
    }),
    check(
      "relationship_summaries_epoch_nonnegative",
      nonnegative(table.memoryEpoch),
    ),
    check("relationship_summaries_revision_positive", positive(table.revision)),
  ],
);

export const relationshipSummaryRun = pgTable(
  "relationship_summary_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "restrict" }),
    memoryEpoch: integer("memory_epoch").notNull(),
    expectedSummaryRevision: integer("expected_summary_revision").notNull(),
    basedOnMemoryRevision: integer("based_on_memory_revision").notNull(),
    explicitRegeneration: boolean("explicit_regeneration")
      .notNull()
      .default(false),
    status: backgroundOperationStatusEnum("status")
      .notNull()
      .default("pending"),
    jobId: text("job_id"),
    deadLetterPublishedAt: timestamp("dead_letter_published_at", {
      withTimezone: true,
    }),
    claimToken: text("claim_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    errorCategory: text("error_category"),
    providerRequestIds: jsonb("provider_request_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    estimatedInputTokens: bigint("estimated_input_tokens", { mode: "number" })
      .notNull()
      .default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    usageEstimated: boolean("usage_estimated"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("relationship_summary_runs_operation_unique").on(
      table.userId,
      table.characterId,
      table.memoryEpoch,
      table.basedOnMemoryRevision,
      table.expectedSummaryRevision,
    ),
    uniqueIndex("relationship_summary_runs_one_active_revision")
      .on(
        table.userId,
        table.characterId,
        table.memoryEpoch,
        table.basedOnMemoryRevision,
      )
      .where(
        sql`${table.status} IN ('pending', 'queued', 'running', 'retrying')`,
      ),
    uniqueIndex("relationship_summary_runs_job_unique")
      .on(table.jobId)
      .where(sql`${table.jobId} IS NOT NULL`),
    index("relationship_summary_runs_pending_idx").on(
      table.status,
      table.nextRetryAt,
      table.createdAt,
    ),
    check(
      "relationship_summary_runs_epoch_nonnegative",
      nonnegative(table.memoryEpoch),
    ),
    check(
      "relationship_summary_runs_expected_revision_nonnegative",
      nonnegative(table.expectedSummaryRevision),
    ),
    check(
      "relationship_summary_runs_memory_revision_nonnegative",
      nonnegative(table.basedOnMemoryRevision),
    ),
    check(
      "relationship_summary_runs_attempt_count_nonnegative",
      nonnegative(table.attemptCount),
    ),
    check(
      "relationship_summary_runs_attempt_count_limit",
      sql`${table.attemptCount} <= 5`,
    ),
    check(
      "relationship_summary_runs_publication_shape",
      sql`${table.deadLetterPublishedAt} IS NULL OR ${table.status} = 'dead_letter'`,
    ),
    check(
      "relationship_summary_runs_estimated_tokens_nonnegative",
      nonnegative(table.estimatedInputTokens),
    ),
    check(
      "relationship_summary_runs_input_tokens_nonnegative",
      sql`${table.inputTokens} IS NULL OR ${nonnegative(table.inputTokens)}`,
    ),
    check(
      "relationship_summary_runs_output_tokens_nonnegative",
      sql`${table.outputTokens} IS NULL OR ${nonnegative(table.outputTokens)}`,
    ),
    check(
      "relationship_summary_runs_usage_shape_check",
      sql`(
        (${table.inputTokens} IS NULL AND ${table.outputTokens} IS NULL AND ${table.usageEstimated} IS NULL)
        OR
        (${table.inputTokens} IS NOT NULL AND ${table.outputTokens} IS NOT NULL AND ${table.usageEstimated} IS NOT NULL)
      )`,
    ),
    check(
      "relationship_summary_runs_terminal_shape_check",
      sql`(
        (${table.status} IN ('complete', 'failed', 'dead_letter', 'cancelled') AND ${table.finishedAt} IS NOT NULL)
        OR
        (${table.status} IN ('pending', 'queued', 'running', 'retrying') AND ${table.finishedAt} IS NULL)
      )`,
    ),
  ],
);

export const relationshipSummaryExecution = pgTable(
  "relationship_summary_executions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => relationshipSummaryRun.id, { onDelete: "cascade" }),
    executionNumber: integer("execution_number").notNull(),
    summary: text("summary"),
    modelId: text("model_id").notNull(),
    providerIdentity: jsonb("provider_identity")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    estimatedInputTokens: bigint("estimated_input_tokens", {
      mode: "number",
    }).notNull(),
    estimatedOutputTokens: bigint("estimated_output_tokens", { mode: "number" })
      .notNull()
      .default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    latencyMs: integer("latency_ms").notNull().default(0),
    errorCategory: text("error_category"),
    retryable: boolean("retryable").notNull().default(false),
    responseAt: timestamp("response_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("relationship_summary_executions_run_number_unique").on(
      table.runId,
      table.executionNumber,
    ),
    check(
      "relationship_summary_executions_number_check",
      sql`${table.executionNumber} BETWEEN 1 AND 5`,
    ),
    check(
      "relationship_summary_executions_tokens_check",
      sql`
      ${table.estimatedInputTokens} >= 0 AND ${table.estimatedOutputTokens} >= 0
      AND (${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0)
      AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0)
      AND ${table.latencyMs} >= 0`,
    ),
    check(
      "relationship_summary_executions_receipt_shape",
      sql`
      (${table.settledAt} IS NULL OR (${table.responseAt} IS NOT NULL AND ${table.summary} IS NULL))
      AND (${table.summary} IS NULL OR (CHAR_LENGTH(${table.summary}) <= 4000 AND OCTET_LENGTH(${table.summary}) <= 16000))`,
    ),
  ],
);

export const backgroundModelReservation = pgTable(
  "background_model_reservations",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id").notNull().unique(),
    workloadType: backgroundWorkloadTypeEnum("workload_type").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    reservedTokens: bigint("reserved_tokens", { mode: "number" }).notNull(),
    consumedInputTokens: bigint("consumed_input_tokens", { mode: "number" })
      .notNull()
      .default(0),
    consumedOutputTokens: bigint("consumed_output_tokens", { mode: "number" })
      .notNull()
      .default(0),
    settlementFingerprint: text("settlement_fingerprint"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("background_model_reservations_period_idx").on(
      table.periodStart,
      table.periodEnd,
    ),
    check(
      "background_model_reservations_period_check",
      sql`(
        ${table.periodStart} = DATE_TRUNC('month', ${table.periodStart} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AND ${table.periodEnd} = ((${table.periodStart} AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC'
      )`,
    ),
    check(
      "background_model_reservations_reserved_tokens_nonnegative",
      nonnegative(table.reservedTokens),
    ),
    check(
      "background_model_reservations_consumed_input_nonnegative",
      nonnegative(table.consumedInputTokens),
    ),
    check(
      "background_model_reservations_consumed_output_nonnegative",
      nonnegative(table.consumedOutputTokens),
    ),
    check(
      "background_model_reservations_settlement_shape_check",
      sql`(
        ${table.settledAt} IS NOT NULL
        OR
        (${table.consumedInputTokens} = 0 AND ${table.consumedOutputTokens} = 0)
      )`,
    ),
    check(
      "background_model_reservations_settlement_fingerprint_check",
      sql`${table.settlementFingerprint} IS NULL OR ${table.settlementFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const dataExportJob = pgTable(
  "data_export_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: dataExportStatusEnum("status").notNull().default("pending"),
    jobId: text("job_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    deadLetterPublishedAt: timestamp("dead_letter_published_at", { withTimezone: true }),
    archiveBytes: bytea("archive_bytes"),
    archiveSize: bigint("archive_size", { mode: "number" }),
    archiveSha256: text("archive_sha256"),
    errorCategory: text("error_category"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("data_export_jobs_attempt_count_range", sql`${table.attemptCount} BETWEEN 0 AND 5`),
    check("data_export_jobs_retry_shape_check", sql`${table.nextRetryAt} IS NULL OR ${table.status} = 'pending'`),
    uniqueIndex("data_export_jobs_one_active_per_user_idx")
      .on(table.userId)
      .where(sql`${table.status} IN ('pending', 'running')`),
    uniqueIndex("data_export_jobs_job_unique")
      .on(table.jobId)
      .where(sql`${table.jobId} IS NOT NULL`),
    index("data_export_jobs_expiry_idx").on(table.status, table.expiresAt),
    check(
      "data_export_jobs_archive_size_nonnegative",
      sql`${table.archiveSize} IS NULL OR (${nonnegative(table.archiveSize)} AND ${table.archiveSize} <= 262144000)`,
    ),
    check(
      "data_export_jobs_archive_digest_check",
      sql`${table.archiveSha256} IS NULL OR (
        ${table.archiveSha256} ~ '^[0-9a-f]{64}$'
        AND ${table.archiveBytes} IS NOT NULL
        AND ${table.archiveSha256} = ENCODE(SHA256(${table.archiveBytes}), 'hex')
      )`,
    ),
    check(
      "data_export_jobs_archive_shape_check",
      sql`(
        (
          ${table.status} = 'complete'
          AND ${table.archiveBytes} IS NOT NULL
          AND ${table.archiveSize} IS NOT NULL
          AND ${table.archiveSize} = OCTET_LENGTH(${table.archiveBytes})
          AND ${table.archiveSha256} IS NOT NULL
          AND ${table.completedAt} IS NOT NULL
          AND ${table.expiresAt} IS NOT NULL
          AND ${table.expiresAt} = ${table.completedAt} + INTERVAL '24 hours'
        )
        OR
        (
          ${table.status} <> 'complete'
          AND ${table.archiveBytes} IS NULL
          AND ${table.archiveSize} IS NULL
          AND ${table.archiveSha256} IS NULL
          AND ${table.expiresAt} IS NULL
        )
      )`,
    ),
  ],
);

export const accountDeletionRequest = pgTable(
  "account_deletion_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    verificationTokenHash: text("verification_token_hash"),
    verificationExpiresAt: timestamp("verification_expires_at", {
      withTimezone: true,
    }),
    verificationConsumedAt: timestamp("verification_consumed_at", {
      withTimezone: true,
    }),
    status: accountDeletionStatusEnum("status")
      .notNull()
      .default("pending_confirmation"),
    currentStage: text("current_stage").notNull(),
    jobId: text("job_id"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCategory: text("error_category"),
    attemptCount: integer("attempt_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("account_deletion_requests_user_unique")
      .on(table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    uniqueIndex("account_deletion_requests_job_unique")
      .on(table.jobId)
      .where(sql`${table.jobId} IS NOT NULL`),
    index("account_deletion_requests_status_idx").on(
      table.status,
      table.updatedAt,
    ),
    check(
      "account_deletion_requests_user_completion_check",
      sql`${table.userId} IS NOT NULL OR ${table.status} = 'complete'`,
    ),
    check(
      "account_deletion_requests_token_hash_check",
      sql`${table.verificationTokenHash} IS NULL OR ${table.verificationTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "account_deletion_requests_verification_shape_check",
      sql`(
        (
          ${table.status} = 'pending_confirmation'
          AND ${table.userId} IS NOT NULL
          AND ${table.verificationTokenHash} IS NOT NULL
          AND ${table.verificationExpiresAt} IS NOT NULL
          AND ${table.verificationConsumedAt} IS NULL
          AND ${table.confirmedAt} IS NULL
          AND ${table.lockedAt} IS NULL
          AND ${table.completedAt} IS NULL
        )
        OR
        (
          ${table.status} IN ('locked', 'purging', 'dead_letter')
          AND ${table.userId} IS NOT NULL
          AND ${table.verificationTokenHash} IS NULL
          AND ${table.verificationExpiresAt} IS NULL
          AND ${table.verificationConsumedAt} IS NOT NULL
          AND ${table.confirmedAt} IS NOT NULL
          AND ${table.lockedAt} IS NOT NULL
          AND ${table.completedAt} IS NULL
        )
        OR
        (
          ${table.status} = 'complete'
          AND ${table.verificationTokenHash} IS NULL
          AND ${table.verificationExpiresAt} IS NULL
          AND ${table.verificationConsumedAt} IS NOT NULL
          AND ${table.confirmedAt} IS NOT NULL
          AND ${table.lockedAt} IS NOT NULL
          AND ${table.completedAt} IS NOT NULL
        )
      )`,
    ),
    check(
      "account_deletion_requests_attempt_count_nonnegative",
      nonnegative(table.attemptCount),
    ),
    check(
      "account_deletion_requests_stage_nonempty",
      sql`LENGTH(BTRIM(${table.currentStage})) > 0`,
    ),
  ],
);
