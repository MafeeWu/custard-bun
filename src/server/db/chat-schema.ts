import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { character, characterVersion } from "./character-schema";

export const conversationLifecycleEnum = pgEnum("conversation_lifecycle", [
  "active",
  "archived",
]);

export const messageKindEnum = pgEnum("conversation_message_kind", [
  "opening",
  "user",
  "generated",
]);

export const generationStatusEnum = pgEnum("generation_status", [
  "pending",
  "streaming",
  "complete",
  "interrupted",
  "failed",
]);

export const quotaScopeEnum = pgEnum("quota_scope", ["user", "instance"]);

export const reservationStatusEnum = pgEnum("quota_reservation_status", [
  "active",
  "settled",
  "released",
]);

export type ConversationLifecycle =
  (typeof conversationLifecycleEnum.enumValues)[number];
export type ConversationMessageKind =
  (typeof messageKindEnum.enumValues)[number];
export type GenerationStatus = (typeof generationStatusEnum.enumValues)[number];
export type QuotaScope = (typeof quotaScopeEnum.enumValues)[number];
export type QuotaReservationStatus =
  (typeof reservationStatusEnum.enumValues)[number];

const nonnegative = (column: AnyPgColumn) => sql`${column} >= 0`;
const positive = (column: AnyPgColumn) => sql`${column} > 0`;

export const conversation = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "restrict" }),
    characterVersionId: text("character_version_id").notNull(),
    lifecycle: conversationLifecycleEnum("lifecycle")
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "conversations_pinned_character_version_fk",
      columns: [table.characterId, table.characterVersionId],
      foreignColumns: [characterVersion.characterId, characterVersion.id],
    }).onDelete("restrict"),
    uniqueIndex("conversations_one_active_conversation_idx")
      .on(table.userId, table.characterId)
      .where(sql`${table.lifecycle} = 'active'`),
    index("conversations_user_last_message_idx").on(
      table.userId,
      table.lastMessageAt,
    ),
    check(
      "conversations_archive_timestamp_check",
      sql`(
        (${table.lifecycle} = 'active' AND ${table.archivedAt} IS NULL)
        OR
        (${table.lifecycle} = 'archived' AND ${table.archivedAt} IS NOT NULL)
      )`,
    ),
  ],
);

export const conversationMessage = pgTable(
  "conversation_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    role: text("role").notNull(),
    kind: messageKindEnum("kind").notNull(),
    content: text("content"),
    clientRequestId: text("client_request_id"),
    inReplyTo: text("in_reply_to").references(
      (): AnyPgColumn => conversationMessage.id,
      { onDelete: "cascade" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("conversation_messages_conversation_sequence_unique").on(
      table.conversationId,
      table.sequence,
    ),
    uniqueIndex("conversation_messages_client_request_unique")
      .on(table.conversationId, table.clientRequestId)
      .where(sql`${table.clientRequestId} IS NOT NULL`),
    uniqueIndex("conversation_messages_one_generated_slot_idx")
      .on(table.inReplyTo)
      .where(sql`${table.kind} = 'generated'`),
    index("conversation_messages_timeline_idx").on(
      table.conversationId,
      table.sequence,
    ),
    check("conversation_messages_sequence_positive", positive(table.sequence)),
    check(
      "conversation_messages_shape_check",
      sql`(
        (
          ${table.kind} = 'opening'
          AND ${table.role} = 'assistant'
          AND ${table.content} IS NOT NULL
          AND LENGTH(${table.content}) > 0
          AND ${table.clientRequestId} IS NULL
          AND ${table.inReplyTo} IS NULL
        )
        OR
        (
          ${table.kind} = 'user'
          AND ${table.role} = 'user'
          AND ${table.content} IS NOT NULL
          AND LENGTH(${table.content}) > 0
          AND ${table.inReplyTo} IS NULL
        )
        OR
        (
          ${table.kind} = 'generated'
          AND ${table.role} = 'assistant'
          AND ${table.content} IS NULL
          AND ${table.clientRequestId} IS NULL
          AND ${table.inReplyTo} IS NOT NULL
        )
      )`,
    ),
  ],
);

export const generationAttempt = pgTable(
  "generation_attempts",
  {
    id: text("id").primaryKey(),
    assistantMessageId: text("assistant_message_id")
      .notNull()
      .references(() => conversationMessage.id, { onDelete: "cascade" }),
    clientRequestId: text("client_request_id").unique(),
    attemptNumber: integer("attempt_number").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    status: generationStatusEnum("status").notNull().default("pending"),
    content: text("content").notNull().default(""),
    modelId: text("model_id").notNull(),
    providerRequestId: text("provider_request_id"),
    errorCategory: text("error_category"),
    retryable: boolean("retryable"),
    providerRetryCount: integer("provider_retry_count").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    usageIsEstimated: boolean("usage_is_estimated"),
    cancelRequestedAt: timestamp("cancel_requested_at", {
      withTimezone: true,
    }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    firstTokenAt: timestamp("first_token_at", { withTimezone: true }),
    checkpointedAt: timestamp("checkpointed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("generation_attempts_message_attempt_unique").on(
      table.assistantMessageId,
      table.attemptNumber,
    ),
    uniqueIndex("generation_attempts_one_current_attempt_idx")
      .on(table.assistantMessageId)
      .where(sql`${table.isCurrent}`),
    index("generation_attempts_status_idx").on(table.status),
    check(
      "generation_attempts_attempt_number_positive",
      positive(table.attemptNumber),
    ),
    check(
      "generation_attempts_provider_retry_count_nonnegative",
      nonnegative(table.providerRetryCount),
    ),
    check(
      "generation_attempts_input_tokens_nonnegative",
      sql`${table.inputTokens} IS NULL OR ${nonnegative(table.inputTokens)}`,
    ),
    check(
      "generation_attempts_output_tokens_nonnegative",
      sql`${table.outputTokens} IS NULL OR ${nonnegative(table.outputTokens)}`,
    ),
    check(
      "generation_attempts_terminal_timestamp_check",
      sql`(
        (${table.status} IN ('complete', 'interrupted', 'failed') AND ${table.completedAt} IS NOT NULL)
        OR
        (${table.status} IN ('pending', 'streaming') AND ${table.completedAt} IS NULL)
      )`,
    ),
    check(
      "generation_attempts_usage_shape_check",
      sql`(
        (${table.inputTokens} IS NULL AND ${table.outputTokens} IS NULL AND ${table.usageIsEstimated} IS NULL)
        OR
        (${table.inputTokens} IS NOT NULL AND ${table.outputTokens} IS NOT NULL AND ${table.usageIsEstimated} IS NOT NULL)
      )`,
    ),
    check(
      "generation_attempts_lease_shape_check",
      sql`(
        (${table.leaseExpiresAt} IS NULL AND ${table.leaseOwner} IS NULL)
        OR
        (${table.leaseExpiresAt} IS NOT NULL AND ${table.leaseOwner} IS NOT NULL)
      )`,
    ),
  ],
);

export const chatSettings = pgTable(
  "chat_settings",
  {
    id: text("id").primaryKey(),
    revision: integer("revision").notNull().default(1),
    userDailyRequestLimit: bigint("user_daily_request_limit", {
      mode: "number",
    }).notNull(),
    userDailyTokenLimit: bigint("user_daily_token_limit", {
      mode: "number",
    }).notNull(),
    instanceMonthlyRequestLimit: bigint("instance_monthly_request_limit", {
      mode: "number",
    }).notNull(),
    instanceMonthlyTokenBudget: bigint("instance_monthly_token_budget", {
      mode: "number",
    }).notNull(),
    maxConcurrentGenerations: integer("max_concurrent_generations").notNull(),
    deploymentDefaultUserDailyRequestLimit: bigint(
      "deployment_default_user_daily_request_limit",
      { mode: "number" },
    ).notNull(),
    deploymentDefaultUserDailyTokenLimit: bigint(
      "deployment_default_user_daily_token_limit",
      { mode: "number" },
    ).notNull(),
    deploymentDefaultInstanceMonthlyRequestLimit: bigint(
      "deployment_default_instance_monthly_request_limit",
      { mode: "number" },
    ).notNull(),
    deploymentDefaultInstanceMonthlyTokenBudget: bigint(
      "deployment_default_instance_monthly_token_budget",
      { mode: "number" },
    ).notNull(),
    deploymentDefaultMaxConcurrentGenerations: integer(
      "deployment_default_max_concurrent_generations",
    ).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deploymentDefaultsUpdatedAt: timestamp("deployment_defaults_updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("chat_settings_global_id_check", sql`${table.id} = 'global'`),
    check("chat_settings_revision_positive", positive(table.revision)),
    check(
      "chat_settings_user_daily_request_limit_positive",
      positive(table.userDailyRequestLimit),
    ),
    check(
      "chat_settings_user_daily_token_limit_positive",
      positive(table.userDailyTokenLimit),
    ),
    check(
      "chat_settings_instance_monthly_request_limit_positive",
      positive(table.instanceMonthlyRequestLimit),
    ),
    check(
      "chat_settings_instance_monthly_token_budget_positive",
      positive(table.instanceMonthlyTokenBudget),
    ),
    check(
      "chat_settings_max_concurrent_generations_positive",
      positive(table.maxConcurrentGenerations),
    ),
    check(
      "chat_settings_default_user_daily_request_limit_positive",
      positive(table.deploymentDefaultUserDailyRequestLimit),
    ),
    check(
      "chat_settings_default_user_daily_token_limit_positive",
      positive(table.deploymentDefaultUserDailyTokenLimit),
    ),
    check(
      "chat_settings_default_instance_monthly_request_limit_positive",
      positive(table.deploymentDefaultInstanceMonthlyRequestLimit),
    ),
    check(
      "chat_settings_default_instance_monthly_token_budget_positive",
      positive(table.deploymentDefaultInstanceMonthlyTokenBudget),
    ),
    check(
      "chat_settings_default_max_concurrent_generations_positive",
      positive(table.deploymentDefaultMaxConcurrentGenerations),
    ),
  ],
);

export const userChatQuotaOverride = pgTable(
  "user_chat_quota_overrides",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    dailyRequestLimit: bigint("daily_request_limit", { mode: "number" }),
    dailyTokenLimit: bigint("daily_token_limit", { mode: "number" }),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "user_chat_quota_overrides_has_value_check",
      sql`${table.dailyRequestLimit} IS NOT NULL OR ${table.dailyTokenLimit} IS NOT NULL`,
    ),
    check(
      "user_chat_quota_overrides_daily_request_limit_positive",
      sql`${table.dailyRequestLimit} IS NULL OR ${positive(table.dailyRequestLimit)}`,
    ),
    check(
      "user_chat_quota_overrides_daily_token_limit_positive",
      sql`${table.dailyTokenLimit} IS NULL OR ${positive(table.dailyTokenLimit)}`,
    ),
    check(
      "user_chat_quota_overrides_revision_positive",
      positive(table.revision),
    ),
  ],
);

export const quotaBucket = pgTable(
  "quota_buckets",
  {
    id: text("id").primaryKey(),
    scope: quotaScopeEnum("scope").notNull(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    consumedRequests: bigint("consumed_requests", { mode: "number" })
      .notNull()
      .default(0),
    reservedRequests: bigint("reserved_requests", { mode: "number" })
      .notNull()
      .default(0),
    consumedTokens: bigint("consumed_tokens", { mode: "number" })
      .notNull()
      .default(0),
    reservedTokens: bigint("reserved_tokens", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("quota_buckets_user_period_unique")
      .on(table.userId, table.periodStart)
      .where(sql`${table.scope} = 'user'`),
    uniqueIndex("quota_buckets_instance_period_unique")
      .on(table.periodStart)
      .where(sql`${table.scope} = 'instance'`),
    check(
      "quota_buckets_scope_check",
      sql`(
        (${table.scope} = 'user' AND ${table.userId} IS NOT NULL)
        OR
        (${table.scope} = 'instance' AND ${table.userId} IS NULL)
      )`,
    ),
    check(
      "quota_buckets_period_check",
      sql`(
        (
          ${table.scope} = 'user'
          AND ${table.periodStart} = DATE_TRUNC('day', ${table.periodStart} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND ${table.periodEnd} = ((${table.periodStart} AT TIME ZONE 'UTC') + INTERVAL '1 day') AT TIME ZONE 'UTC'
        )
        OR
        (
          ${table.scope} = 'instance'
          AND ${table.periodStart} = DATE_TRUNC('month', ${table.periodStart} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND ${table.periodEnd} = ((${table.periodStart} AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC'
        )
      )`,
    ),
    check(
      "quota_buckets_consumed_requests_nonnegative",
      nonnegative(table.consumedRequests),
    ),
    check(
      "quota_buckets_reserved_requests_nonnegative",
      nonnegative(table.reservedRequests),
    ),
    check(
      "quota_buckets_consumed_tokens_nonnegative",
      nonnegative(table.consumedTokens),
    ),
    check(
      "quota_buckets_reserved_tokens_nonnegative",
      nonnegative(table.reservedTokens),
    ),
  ],
);

export const quotaReservation = pgTable(
  "quota_reservations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id")
      .notNull()
      .unique()
      .references(() => generationAttempt.id, { onDelete: "cascade" }),
    userBucketId: text("user_bucket_id")
      .notNull()
      .references(() => quotaBucket.id, { onDelete: "restrict" }),
    instanceBucketId: text("instance_bucket_id")
      .notNull()
      .references(() => quotaBucket.id, { onDelete: "restrict" }),
    status: reservationStatusEnum("status").notNull().default("active"),
    requestUnits: bigint("request_units", { mode: "number" })
      .notNull()
      .default(1),
    reservedTokens: bigint("reserved_tokens", { mode: "number" }).notNull(),
    settledInputTokens: bigint("settled_input_tokens", { mode: "number" }),
    settledOutputTokens: bigint("settled_output_tokens", { mode: "number" }),
    usageIsEstimated: boolean("usage_is_estimated"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "quota_reservations_request_units_positive",
      positive(table.requestUnits),
    ),
    check(
      "quota_reservations_reserved_tokens_nonnegative",
      nonnegative(table.reservedTokens),
    ),
    check(
      "quota_reservations_settled_input_tokens_nonnegative",
      sql`${table.settledInputTokens} IS NULL OR ${nonnegative(table.settledInputTokens)}`,
    ),
    check(
      "quota_reservations_settled_output_tokens_nonnegative",
      sql`${table.settledOutputTokens} IS NULL OR ${nonnegative(table.settledOutputTokens)}`,
    ),
    check(
      "quota_reservations_terminal_shape_check",
      sql`(
        (
          ${table.status} = 'active'
          AND ${table.settledAt} IS NULL
          AND ${table.releasedAt} IS NULL
          AND ${table.settledInputTokens} IS NULL
          AND ${table.settledOutputTokens} IS NULL
          AND ${table.usageIsEstimated} IS NULL
        )
        OR
        (
          ${table.status} = 'settled'
          AND ${table.settledAt} IS NOT NULL
          AND ${table.releasedAt} IS NULL
          AND ${table.settledInputTokens} IS NOT NULL
          AND ${table.settledOutputTokens} IS NOT NULL
          AND ${table.usageIsEstimated} IS NOT NULL
        )
        OR
        (
          ${table.status} = 'released'
          AND ${table.settledAt} IS NULL
          AND ${table.releasedAt} IS NOT NULL
          AND ${table.settledInputTokens} IS NULL
          AND ${table.settledOutputTokens} IS NULL
          AND ${table.usageIsEstimated} IS NULL
        )
      )`,
    ),
  ],
);

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    attemptId: text("attempt_id").references(() => generationAttempt.id, {
      onDelete: "set null",
    }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    userRequestUnits: bigint("user_request_units", { mode: "number" })
      .notNull()
      .default(0),
    providerCallNumber: integer("provider_call_number").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" })
      .notNull()
      .default(0),
    outputTokens: bigint("output_tokens", { mode: "number" })
      .notNull()
      .default(0),
    usageIsEstimated: boolean("usage_is_estimated").notNull(),
    modelId: text("model_id").notNull(),
    outcome: text("outcome").notNull(),
    errorCategory: text("error_category"),
    automaticRetryCount: integer("automatic_retry_count").notNull().default(0),
    latencyMs: bigint("latency_ms", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("usage_ledger_attempt_provider_call_unique")
      .on(table.attemptId, table.providerCallNumber)
      .where(sql`${table.attemptId} IS NOT NULL`),
    index("usage_ledger_period_idx").on(table.periodStart, table.periodEnd),
    index("usage_ledger_user_period_idx").on(table.userId, table.periodStart),
    check(
      "usage_ledger_period_check",
      sql`${table.periodEnd} > ${table.periodStart}`,
    ),
    check(
      "usage_ledger_user_request_units_nonnegative",
      nonnegative(table.userRequestUnits),
    ),
    check(
      "usage_ledger_provider_call_number_positive",
      positive(table.providerCallNumber),
    ),
    check(
      "usage_ledger_input_tokens_nonnegative",
      nonnegative(table.inputTokens),
    ),
    check(
      "usage_ledger_output_tokens_nonnegative",
      nonnegative(table.outputTokens),
    ),
    check(
      "usage_ledger_automatic_retry_count_nonnegative",
      nonnegative(table.automaticRetryCount),
    ),
    check(
      "usage_ledger_latency_ms_nonnegative",
      sql`${table.latencyMs} IS NULL OR ${nonnegative(table.latencyMs)}`,
    ),
    check(
      "usage_ledger_outcome_check",
      sql`${table.outcome} IN ('complete', 'failed', 'interrupted')`,
    ),
  ],
);

export const generationLease = pgTable(
  "generation_leases",
  {
    attemptId: text("attempt_id")
      .primaryKey()
      .references(() => generationAttempt.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ownerToken: text("owner_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("generation_leases_user_id_unique").on(table.userId),
    index("generation_leases_expires_at_idx").on(table.expiresAt),
  ],
);
