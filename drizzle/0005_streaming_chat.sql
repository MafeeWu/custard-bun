CREATE TYPE "public"."conversation_lifecycle" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('pending', 'streaming', 'complete', 'interrupted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_kind" AS ENUM('opening', 'user', 'generated');--> statement-breakpoint
CREATE TYPE "public"."quota_scope" AS ENUM('user', 'instance');--> statement-breakpoint
CREATE TYPE "public"."quota_reservation_status" AS ENUM('active', 'settled', 'released');--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE 'chat.settings.update';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE 'chat.settings.reset';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE 'user.chat_quota.update';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE 'user.chat_quota.clear';--> statement-breakpoint
CREATE TABLE "chat_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"user_daily_request_limit" bigint NOT NULL,
	"user_daily_token_limit" bigint NOT NULL,
	"instance_monthly_request_limit" bigint NOT NULL,
	"instance_monthly_token_budget" bigint NOT NULL,
	"max_concurrent_generations" integer NOT NULL,
	"deployment_default_user_daily_request_limit" bigint NOT NULL,
	"deployment_default_user_daily_token_limit" bigint NOT NULL,
	"deployment_default_instance_monthly_request_limit" bigint NOT NULL,
	"deployment_default_instance_monthly_token_budget" bigint NOT NULL,
	"deployment_default_max_concurrent_generations" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deployment_defaults_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_settings_global_id_check" CHECK ("chat_settings"."id" = 'global'),
	CONSTRAINT "chat_settings_revision_positive" CHECK ("chat_settings"."revision" > 0),
	CONSTRAINT "chat_settings_user_daily_request_limit_positive" CHECK ("chat_settings"."user_daily_request_limit" > 0),
	CONSTRAINT "chat_settings_user_daily_token_limit_positive" CHECK ("chat_settings"."user_daily_token_limit" > 0),
	CONSTRAINT "chat_settings_instance_monthly_request_limit_positive" CHECK ("chat_settings"."instance_monthly_request_limit" > 0),
	CONSTRAINT "chat_settings_instance_monthly_token_budget_positive" CHECK ("chat_settings"."instance_monthly_token_budget" > 0),
	CONSTRAINT "chat_settings_max_concurrent_generations_positive" CHECK ("chat_settings"."max_concurrent_generations" > 0),
	CONSTRAINT "chat_settings_default_user_daily_request_limit_positive" CHECK ("chat_settings"."deployment_default_user_daily_request_limit" > 0),
	CONSTRAINT "chat_settings_default_user_daily_token_limit_positive" CHECK ("chat_settings"."deployment_default_user_daily_token_limit" > 0),
	CONSTRAINT "chat_settings_default_instance_monthly_request_limit_positive" CHECK ("chat_settings"."deployment_default_instance_monthly_request_limit" > 0),
	CONSTRAINT "chat_settings_default_instance_monthly_token_budget_positive" CHECK ("chat_settings"."deployment_default_instance_monthly_token_budget" > 0),
	CONSTRAINT "chat_settings_default_max_concurrent_generations_positive" CHECK ("chat_settings"."deployment_default_max_concurrent_generations" > 0)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"character_version_id" text NOT NULL,
	"lifecycle" "conversation_lifecycle" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "conversations_archive_timestamp_check" CHECK ((
        ("conversations"."lifecycle" = 'active' AND "conversations"."archived_at" IS NULL)
        OR
        ("conversations"."lifecycle" = 'archived' AND "conversations"."archived_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"role" text NOT NULL,
	"kind" "conversation_message_kind" NOT NULL,
	"content" text,
	"client_request_id" text,
	"in_reply_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_conversation_sequence_unique" UNIQUE("conversation_id","sequence"),
	CONSTRAINT "conversation_messages_sequence_positive" CHECK ("conversation_messages"."sequence" > 0),
	CONSTRAINT "conversation_messages_shape_check" CHECK ((
        (
          "conversation_messages"."kind" = 'opening'
          AND "conversation_messages"."role" = 'assistant'
          AND "conversation_messages"."content" IS NOT NULL
          AND LENGTH("conversation_messages"."content") > 0
          AND "conversation_messages"."client_request_id" IS NULL
          AND "conversation_messages"."in_reply_to" IS NULL
        )
        OR
        (
          "conversation_messages"."kind" = 'user'
          AND "conversation_messages"."role" = 'user'
          AND "conversation_messages"."content" IS NOT NULL
          AND LENGTH("conversation_messages"."content") > 0
          AND "conversation_messages"."in_reply_to" IS NULL
        )
        OR
        (
          "conversation_messages"."kind" = 'generated'
          AND "conversation_messages"."role" = 'assistant'
          AND "conversation_messages"."content" IS NULL
          AND "conversation_messages"."client_request_id" IS NULL
          AND "conversation_messages"."in_reply_to" IS NOT NULL
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "generation_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_message_id" text NOT NULL,
	"client_request_id" text,
	"attempt_number" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"status" "generation_status" DEFAULT 'pending' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"model_id" text NOT NULL,
	"provider_request_id" text,
	"error_category" text,
	"retryable" boolean,
	"provider_retry_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"usage_is_estimated" boolean,
	"cancel_requested_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"lease_owner" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_token_at" timestamp with time zone,
	"checkpointed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_attempts_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "generation_attempts_message_attempt_unique" UNIQUE("assistant_message_id","attempt_number"),
	CONSTRAINT "generation_attempts_attempt_number_positive" CHECK ("generation_attempts"."attempt_number" > 0),
	CONSTRAINT "generation_attempts_provider_retry_count_nonnegative" CHECK ("generation_attempts"."provider_retry_count" >= 0),
	CONSTRAINT "generation_attempts_input_tokens_nonnegative" CHECK ("generation_attempts"."input_tokens" IS NULL OR "generation_attempts"."input_tokens" >= 0),
	CONSTRAINT "generation_attempts_output_tokens_nonnegative" CHECK ("generation_attempts"."output_tokens" IS NULL OR "generation_attempts"."output_tokens" >= 0),
	CONSTRAINT "generation_attempts_terminal_timestamp_check" CHECK ((
        ("generation_attempts"."status" IN ('complete', 'interrupted', 'failed') AND "generation_attempts"."completed_at" IS NOT NULL)
        OR
        ("generation_attempts"."status" IN ('pending', 'streaming') AND "generation_attempts"."completed_at" IS NULL)
      )),
	CONSTRAINT "generation_attempts_usage_shape_check" CHECK ((
        ("generation_attempts"."input_tokens" IS NULL AND "generation_attempts"."output_tokens" IS NULL AND "generation_attempts"."usage_is_estimated" IS NULL)
        OR
        ("generation_attempts"."input_tokens" IS NOT NULL AND "generation_attempts"."output_tokens" IS NOT NULL AND "generation_attempts"."usage_is_estimated" IS NOT NULL)
      )),
	CONSTRAINT "generation_attempts_lease_shape_check" CHECK ((
        ("generation_attempts"."lease_expires_at" IS NULL AND "generation_attempts"."lease_owner" IS NULL)
        OR
        ("generation_attempts"."lease_expires_at" IS NOT NULL AND "generation_attempts"."lease_owner" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "generation_leases" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"owner_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" "quota_scope" NOT NULL,
	"user_id" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"consumed_requests" bigint DEFAULT 0 NOT NULL,
	"reserved_requests" bigint DEFAULT 0 NOT NULL,
	"consumed_tokens" bigint DEFAULT 0 NOT NULL,
	"reserved_tokens" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_buckets_scope_check" CHECK ((
        ("quota_buckets"."scope" = 'user' AND "quota_buckets"."user_id" IS NOT NULL)
        OR
        ("quota_buckets"."scope" = 'instance' AND "quota_buckets"."user_id" IS NULL)
      )),
	CONSTRAINT "quota_buckets_period_check" CHECK ((
        (
          "quota_buckets"."scope" = 'user'
          AND "quota_buckets"."period_start" = DATE_TRUNC('day', "quota_buckets"."period_start" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND "quota_buckets"."period_end" = (("quota_buckets"."period_start" AT TIME ZONE 'UTC') + INTERVAL '1 day') AT TIME ZONE 'UTC'
        )
        OR
        (
          "quota_buckets"."scope" = 'instance'
          AND "quota_buckets"."period_start" = DATE_TRUNC('month', "quota_buckets"."period_start" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND "quota_buckets"."period_end" = (("quota_buckets"."period_start" AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC'
        )
      )),
	CONSTRAINT "quota_buckets_consumed_requests_nonnegative" CHECK ("quota_buckets"."consumed_requests" >= 0),
	CONSTRAINT "quota_buckets_reserved_requests_nonnegative" CHECK ("quota_buckets"."reserved_requests" >= 0),
	CONSTRAINT "quota_buckets_consumed_tokens_nonnegative" CHECK ("quota_buckets"."consumed_tokens" >= 0),
	CONSTRAINT "quota_buckets_reserved_tokens_nonnegative" CHECK ("quota_buckets"."reserved_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quota_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"user_bucket_id" text NOT NULL,
	"instance_bucket_id" text NOT NULL,
	"status" "quota_reservation_status" DEFAULT 'active' NOT NULL,
	"request_units" bigint DEFAULT 1 NOT NULL,
	"reserved_tokens" bigint NOT NULL,
	"settled_input_tokens" bigint,
	"settled_output_tokens" bigint,
	"usage_is_estimated" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	CONSTRAINT "quota_reservations_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "quota_reservations_request_units_positive" CHECK ("quota_reservations"."request_units" > 0),
	CONSTRAINT "quota_reservations_reserved_tokens_nonnegative" CHECK ("quota_reservations"."reserved_tokens" >= 0),
	CONSTRAINT "quota_reservations_settled_input_tokens_nonnegative" CHECK ("quota_reservations"."settled_input_tokens" IS NULL OR "quota_reservations"."settled_input_tokens" >= 0),
	CONSTRAINT "quota_reservations_settled_output_tokens_nonnegative" CHECK ("quota_reservations"."settled_output_tokens" IS NULL OR "quota_reservations"."settled_output_tokens" >= 0),
	CONSTRAINT "quota_reservations_terminal_shape_check" CHECK ((
        (
          "quota_reservations"."status" = 'active'
          AND "quota_reservations"."settled_at" IS NULL
          AND "quota_reservations"."released_at" IS NULL
          AND "quota_reservations"."settled_input_tokens" IS NULL
          AND "quota_reservations"."settled_output_tokens" IS NULL
          AND "quota_reservations"."usage_is_estimated" IS NULL
        )
        OR
        (
          "quota_reservations"."status" = 'settled'
          AND "quota_reservations"."settled_at" IS NOT NULL
          AND "quota_reservations"."released_at" IS NULL
          AND "quota_reservations"."settled_input_tokens" IS NOT NULL
          AND "quota_reservations"."settled_output_tokens" IS NOT NULL
          AND "quota_reservations"."usage_is_estimated" IS NOT NULL
        )
        OR
        (
          "quota_reservations"."status" = 'released'
          AND "quota_reservations"."settled_at" IS NULL
          AND "quota_reservations"."released_at" IS NOT NULL
          AND "quota_reservations"."settled_input_tokens" IS NULL
          AND "quota_reservations"."settled_output_tokens" IS NULL
          AND "quota_reservations"."usage_is_estimated" IS NULL
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"conversation_id" text,
	"attempt_id" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"user_request_units" bigint DEFAULT 0 NOT NULL,
	"provider_call_number" integer NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"usage_is_estimated" boolean NOT NULL,
	"model_id" text NOT NULL,
	"outcome" text NOT NULL,
	"error_category" text,
	"automatic_retry_count" integer DEFAULT 0 NOT NULL,
	"latency_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_ledger_period_check" CHECK ("usage_ledger"."period_end" > "usage_ledger"."period_start"),
	CONSTRAINT "usage_ledger_user_request_units_nonnegative" CHECK ("usage_ledger"."user_request_units" >= 0),
	CONSTRAINT "usage_ledger_provider_call_number_positive" CHECK ("usage_ledger"."provider_call_number" > 0),
	CONSTRAINT "usage_ledger_input_tokens_nonnegative" CHECK ("usage_ledger"."input_tokens" >= 0),
	CONSTRAINT "usage_ledger_output_tokens_nonnegative" CHECK ("usage_ledger"."output_tokens" >= 0),
	CONSTRAINT "usage_ledger_automatic_retry_count_nonnegative" CHECK ("usage_ledger"."automatic_retry_count" >= 0),
	CONSTRAINT "usage_ledger_latency_ms_nonnegative" CHECK ("usage_ledger"."latency_ms" IS NULL OR "usage_ledger"."latency_ms" >= 0),
	CONSTRAINT "usage_ledger_outcome_check" CHECK ("usage_ledger"."outcome" IN ('complete', 'failed', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "user_chat_quota_overrides" (
	"user_id" text PRIMARY KEY NOT NULL,
	"daily_request_limit" bigint,
	"daily_token_limit" bigint,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_chat_quota_overrides_has_value_check" CHECK ("user_chat_quota_overrides"."daily_request_limit" IS NOT NULL OR "user_chat_quota_overrides"."daily_token_limit" IS NOT NULL),
	CONSTRAINT "user_chat_quota_overrides_daily_request_limit_positive" CHECK ("user_chat_quota_overrides"."daily_request_limit" IS NULL OR "user_chat_quota_overrides"."daily_request_limit" > 0),
	CONSTRAINT "user_chat_quota_overrides_daily_token_limit_positive" CHECK ("user_chat_quota_overrides"."daily_token_limit" IS NULL OR "user_chat_quota_overrides"."daily_token_limit" > 0),
	CONSTRAINT "user_chat_quota_overrides_revision_positive" CHECK ("user_chat_quota_overrides"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_pinned_character_version_fk" FOREIGN KEY ("character_id","character_version_id") REFERENCES "public"."character_versions"("character_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_in_reply_to_conversation_messages_id_fk" FOREIGN KEY ("in_reply_to") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_assistant_message_id_conversation_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_leases" ADD CONSTRAINT "generation_leases_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_leases" ADD CONSTRAINT "generation_leases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_buckets" ADD CONSTRAINT "quota_buckets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_user_bucket_id_quota_buckets_id_fk" FOREIGN KEY ("user_bucket_id") REFERENCES "public"."quota_buckets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_instance_bucket_id_quota_buckets_id_fk" FOREIGN KEY ("instance_bucket_id") REFERENCES "public"."quota_buckets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_chat_quota_overrides" ADD CONSTRAINT "user_chat_quota_overrides_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_one_active_conversation_idx" ON "conversations" USING btree ("user_id","character_id") WHERE "conversations"."lifecycle" = 'active';--> statement-breakpoint
CREATE INDEX "conversations_user_last_message_idx" ON "conversations" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_client_request_unique" ON "conversation_messages" USING btree ("conversation_id","client_request_id") WHERE "conversation_messages"."client_request_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_one_generated_slot_idx" ON "conversation_messages" USING btree ("in_reply_to") WHERE "conversation_messages"."kind" = 'generated';--> statement-breakpoint
CREATE INDEX "conversation_messages_timeline_idx" ON "conversation_messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_attempts_one_current_attempt_idx" ON "generation_attempts" USING btree ("assistant_message_id") WHERE "generation_attempts"."is_current";--> statement-breakpoint
CREATE INDEX "generation_attempts_status_idx" ON "generation_attempts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_leases_user_id_unique" ON "generation_leases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generation_leases_expires_at_idx" ON "generation_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_buckets_user_period_unique" ON "quota_buckets" USING btree ("user_id","period_start") WHERE "quota_buckets"."scope" = 'user';--> statement-breakpoint
CREATE UNIQUE INDEX "quota_buckets_instance_period_unique" ON "quota_buckets" USING btree ("period_start") WHERE "quota_buckets"."scope" = 'instance';--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_attempt_provider_call_unique" ON "usage_ledger" USING btree ("attempt_id","provider_call_number") WHERE "usage_ledger"."attempt_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_ledger_period_idx" ON "usage_ledger" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "usage_ledger_user_period_idx" ON "usage_ledger" USING btree ("user_id","period_start");--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_conversation_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'conversation ownership is immutable';
    END IF;

    IF NEW.character_id IS DISTINCT FROM OLD.character_id
       OR NEW.character_version_id IS DISTINCT FROM OLD.character_version_id THEN
      RAISE EXCEPTION 'pinned character version is immutable';
    END IF;

    IF OLD.lifecycle = 'archived'
       AND NEW.lifecycle <> OLD.lifecycle THEN
      RAISE EXCEPTION 'archived conversations cannot be restored';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM character_versions
    WHERE character_id = NEW.character_id
      AND id = NEW.character_version_id
  ) THEN
    RAISE EXCEPTION 'pinned version must belong to the conversation character';
  END IF;

  IF NEW.lifecycle = 'active'
     AND EXISTS (
       SELECT 1
       FROM conversations
       WHERE user_id = NEW.user_id
         AND character_id = NEW.character_id
         AND lifecycle = 'active'
         AND id <> NEW.id
     ) THEN
    RAISE EXCEPTION 'one active conversation is allowed per user and character';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER conversations_enforce_invariants
BEFORE INSERT OR UPDATE ON conversations
FOR EACH ROW
EXECUTE FUNCTION enforce_conversation_invariants();--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_generated_message_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_conversation_id text;
  source_role text;
  source_kind conversation_message_kind;
BEGIN
  IF TG_OP = 'UPDATE'
     AND ROW(NEW.id, NEW.kind, NEW.conversation_id)
         IS DISTINCT FROM ROW(OLD.id, OLD.kind, OLD.conversation_id)
     AND EXISTS (
       SELECT 1
       FROM conversation_messages
       WHERE kind = 'generated'
         AND in_reply_to = OLD.id
     ) THEN
    RAISE EXCEPTION 'referenced user message identity, kind, and conversation are immutable';
  END IF;

  IF NEW.kind <> 'generated' THEN
    RETURN NEW;
  END IF;

  SELECT conversation_id, role, kind
  INTO source_conversation_id, source_role, source_kind
  FROM conversation_messages
  WHERE id = NEW.in_reply_to;

  IF NOT FOUND OR source_role <> 'user' OR source_kind <> 'user' THEN
    RAISE EXCEPTION 'generated assistant slots must reference one user message';
  END IF;

  IF source_conversation_id <> NEW.conversation_id THEN
    RAISE EXCEPTION 'generated assistant slots must reference a user message in the same conversation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM conversation_messages
    WHERE kind = 'generated'
      AND in_reply_to = NEW.in_reply_to
      AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'one generated assistant slot is allowed per user message';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER conversation_messages_enforce_generated_reply
BEFORE INSERT OR UPDATE ON conversation_messages
FOR EACH ROW
EXECUTE FUNCTION enforce_generated_message_invariants();--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_current_attempt_invariant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_current
     AND EXISTS (
       SELECT 1
       FROM generation_attempts
       WHERE assistant_message_id = NEW.assistant_message_id
         AND is_current
         AND id <> NEW.id
     ) THEN
    RAISE EXCEPTION 'one current attempt is allowed per assistant slot';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER generation_attempts_enforce_current
BEFORE INSERT OR UPDATE ON generation_attempts
FOR EACH ROW
EXECUTE FUNCTION enforce_current_attempt_invariant();--> statement-breakpoint

CREATE OR REPLACE FUNCTION preserve_terminal_generation_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('complete', 'interrupted', 'failed')
     AND ROW(
       NEW.status,
       NEW.content,
       NEW.model_id,
       NEW.provider_request_id,
       NEW.error_category,
       NEW.retryable,
       NEW.provider_retry_count,
       NEW.input_tokens,
       NEW.output_tokens,
       NEW.usage_is_estimated,
       NEW.started_at,
       NEW.first_token_at,
       NEW.checkpointed_at,
       NEW.completed_at
     ) IS DISTINCT FROM ROW(
       OLD.status,
       OLD.content,
       OLD.model_id,
       OLD.provider_request_id,
       OLD.error_category,
       OLD.retryable,
       OLD.provider_retry_count,
       OLD.input_tokens,
       OLD.output_tokens,
       OLD.usage_is_estimated,
       OLD.started_at,
       OLD.first_token_at,
       OLD.checkpointed_at,
       OLD.completed_at
     ) THEN
    RAISE EXCEPTION 'terminal generation attempt fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER generation_attempts_preserve_terminal
BEFORE UPDATE ON generation_attempts
FOR EACH ROW
EXECUTE FUNCTION preserve_terminal_generation_attempt();--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_generation_lease_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conversation_user_id text;
BEGIN
  SELECT conversations.user_id
  INTO conversation_user_id
  FROM generation_attempts
  JOIN conversation_messages
    ON conversation_messages.id = generation_attempts.assistant_message_id
   AND conversation_messages.kind = 'generated'
  JOIN conversations
    ON conversations.id = conversation_messages.conversation_id
  WHERE generation_attempts.id = NEW.attempt_id
  FOR UPDATE OF generation_attempts;

  IF NOT FOUND OR NEW.user_id IS DISTINCT FROM conversation_user_id THEN
    RAISE EXCEPTION 'generation lease user must match the attempt conversation owner';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER generation_leases_enforce_invariants
BEFORE INSERT OR UPDATE ON generation_leases
FOR EACH ROW
EXECUTE FUNCTION enforce_generation_lease_invariants();--> statement-breakpoint

CREATE OR REPLACE FUNCTION lock_quota_reservation_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM generation_attempts
  WHERE id = NEW.attempt_id
  FOR UPDATE;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER quota_reservations_lock_attempt
BEFORE INSERT OR UPDATE ON quota_reservations
FOR EACH ROW
EXECUTE FUNCTION lock_quota_reservation_attempt();--> statement-breakpoint

CREATE OR REPLACE FUNCTION release_deleted_quota_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'active' THEN
    UPDATE quota_buckets
    SET reserved_requests = reserved_requests - OLD.request_units,
        reserved_tokens = reserved_tokens - OLD.reserved_tokens,
        updated_at = NOW()
    WHERE id IN (OLD.user_bucket_id, OLD.instance_bucket_id);
  END IF;

  RETURN OLD;
END;
$$;--> statement-breakpoint

CREATE TRIGGER quota_reservations_release_on_delete
AFTER DELETE ON quota_reservations
FOR EACH ROW
EXECUTE FUNCTION release_deleted_quota_reservation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION preserve_usage_ledger_accounting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'usage ledger accounting is immutable';
  END IF;

  IF NEW.id IS NOT DISTINCT FROM OLD.id
     AND (
       NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       OR (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL)
     )
     AND (
       NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id
       OR (OLD.conversation_id IS NOT NULL AND NEW.conversation_id IS NULL)
     )
     AND (
       NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id
       OR (OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS NULL)
     )
     AND NEW.period_start IS NOT DISTINCT FROM OLD.period_start
     AND NEW.period_end IS NOT DISTINCT FROM OLD.period_end
     AND NEW.user_request_units IS NOT DISTINCT FROM OLD.user_request_units
     AND NEW.provider_call_number IS NOT DISTINCT FROM OLD.provider_call_number
     AND NEW.input_tokens IS NOT DISTINCT FROM OLD.input_tokens
     AND NEW.output_tokens IS NOT DISTINCT FROM OLD.output_tokens
     AND NEW.usage_is_estimated IS NOT DISTINCT FROM OLD.usage_is_estimated
     AND NEW.model_id IS NOT DISTINCT FROM OLD.model_id
     AND NEW.outcome IS NOT DISTINCT FROM OLD.outcome
     AND NEW.error_category IS NOT DISTINCT FROM OLD.error_category
     AND NEW.automatic_retry_count IS NOT DISTINCT FROM OLD.automatic_retry_count
     AND NEW.latency_ms IS NOT DISTINCT FROM OLD.latency_ms
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'usage ledger accounting is immutable';
END;
$$;--> statement-breakpoint

CREATE TRIGGER usage_ledger_preserve_accounting
BEFORE UPDATE OR DELETE ON usage_ledger
FOR EACH ROW
EXECUTE FUNCTION preserve_usage_ledger_accounting();--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_terminal_generation_cleanup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checked_attempt_id text;
  checked_status generation_status;
BEGIN
  IF TG_TABLE_NAME = 'generation_attempts' THEN
    checked_attempt_id := NEW.id;
  ELSE
    checked_attempt_id := NEW.attempt_id;
  END IF;

  SELECT status
  INTO checked_status
  FROM generation_attempts
  WHERE id = checked_attempt_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF checked_status IN ('complete', 'interrupted', 'failed')
     AND (
       EXISTS (
         SELECT 1
         FROM quota_reservations
         WHERE attempt_id = checked_attempt_id
           AND status = 'active'
       )
       OR EXISTS (
         SELECT 1
         FROM generation_leases
         WHERE attempt_id = checked_attempt_id
       )
     ) THEN
    RAISE EXCEPTION 'terminal generation attempts cannot retain active leases or reservations';
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER generation_attempts_require_cleanup
AFTER INSERT OR UPDATE ON generation_attempts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_terminal_generation_cleanup();--> statement-breakpoint

CREATE CONSTRAINT TRIGGER quota_reservations_require_active_attempt
AFTER INSERT OR UPDATE ON quota_reservations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_terminal_generation_cleanup();--> statement-breakpoint

CREATE CONSTRAINT TRIGGER generation_leases_require_active_attempt
AFTER INSERT OR UPDATE ON generation_leases
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_terminal_generation_cleanup();