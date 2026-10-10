CREATE TYPE "public"."usage_workload_type" AS ENUM('chat_generation', 'memory_extraction', 'summary_refresh');--> statement-breakpoint
CREATE TYPE "public"."account_deletion_status" AS ENUM('pending_confirmation', 'locked', 'purging', 'complete', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."background_operation_status" AS ENUM('pending', 'queued', 'running', 'retrying', 'complete', 'failed', 'dead_letter', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."background_workload_type" AS ENUM('memory_extraction', 'summary_refresh');--> statement-breakpoint
CREATE TYPE "public"."data_export_status" AS ENUM('pending', 'running', 'complete', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."memory_evidence_kind" AS ENUM('direct', 'supporting');--> statement-breakpoint
CREATE TYPE "public"."memory_explicitness" AS ENUM('direct', 'repeated_inference');--> statement-breakpoint
CREATE TYPE "public"."memory_origin" AS ENUM('automatic', 'user_edited');--> statement-breakpoint
CREATE TYPE "public"."memory_sensitivity" AS ENUM('ordinary', 'personal_explicit');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('preferred_name', 'preference', 'important_person', 'personal_fact', 'future_plan', 'shared_event', 'commitment', 'other');--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE 'memory.settings.update';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE 'memory.settings.reset';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE 'memory.operation.retry';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE 'memory.character_forget';--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"verification_token_hash" text,
	"verification_expires_at" timestamp with time zone,
	"verification_consumed_at" timestamp with time zone,
	"status" "account_deletion_status" DEFAULT 'pending_confirmation' NOT NULL,
	"current_stage" text NOT NULL,
	"job_id" text,
	"confirmed_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_category" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletion_requests_user_completion_check" CHECK ("account_deletion_requests"."user_id" IS NOT NULL OR "account_deletion_requests"."status" = 'complete'),
	CONSTRAINT "account_deletion_requests_token_hash_check" CHECK ("account_deletion_requests"."verification_token_hash" IS NULL OR "account_deletion_requests"."verification_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "account_deletion_requests_verification_shape_check" CHECK ((
        (
          "account_deletion_requests"."status" = 'pending_confirmation'
          AND "account_deletion_requests"."user_id" IS NOT NULL
          AND "account_deletion_requests"."verification_token_hash" IS NOT NULL
          AND "account_deletion_requests"."verification_expires_at" IS NOT NULL
          AND "account_deletion_requests"."verification_consumed_at" IS NULL
          AND "account_deletion_requests"."confirmed_at" IS NULL
          AND "account_deletion_requests"."locked_at" IS NULL
          AND "account_deletion_requests"."completed_at" IS NULL
        )
        OR
        (
          "account_deletion_requests"."status" IN ('locked', 'purging', 'dead_letter')
          AND "account_deletion_requests"."user_id" IS NOT NULL
          AND "account_deletion_requests"."verification_token_hash" IS NULL
          AND "account_deletion_requests"."verification_expires_at" IS NULL
          AND "account_deletion_requests"."verification_consumed_at" IS NOT NULL
          AND "account_deletion_requests"."confirmed_at" IS NOT NULL
          AND "account_deletion_requests"."locked_at" IS NOT NULL
          AND "account_deletion_requests"."completed_at" IS NULL
        )
        OR
        (
          "account_deletion_requests"."status" = 'complete'
          AND "account_deletion_requests"."verification_token_hash" IS NULL
          AND "account_deletion_requests"."verification_expires_at" IS NULL
          AND "account_deletion_requests"."verification_consumed_at" IS NOT NULL
          AND "account_deletion_requests"."confirmed_at" IS NOT NULL
          AND "account_deletion_requests"."locked_at" IS NOT NULL
          AND "account_deletion_requests"."completed_at" IS NOT NULL
        )
      )),
	CONSTRAINT "account_deletion_requests_attempt_count_nonnegative" CHECK ("account_deletion_requests"."attempt_count" >= 0),
	CONSTRAINT "account_deletion_requests_stage_nonempty" CHECK (LENGTH(BTRIM("account_deletion_requests"."current_stage")) > 0)
);
--> statement-breakpoint
CREATE TABLE "background_model_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"workload_type" "background_workload_type" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"reserved_tokens" bigint NOT NULL,
	"consumed_input_tokens" bigint DEFAULT 0 NOT NULL,
	"consumed_output_tokens" bigint DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_model_reservations_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "background_model_reservations_period_check" CHECK ((
        "background_model_reservations"."period_start" = DATE_TRUNC('month', "background_model_reservations"."period_start" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AND "background_model_reservations"."period_end" = (("background_model_reservations"."period_start" AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC'
      )),
	CONSTRAINT "background_model_reservations_reserved_tokens_nonnegative" CHECK ("background_model_reservations"."reserved_tokens" >= 0),
	CONSTRAINT "background_model_reservations_consumed_input_nonnegative" CHECK ("background_model_reservations"."consumed_input_tokens" >= 0),
	CONSTRAINT "background_model_reservations_consumed_output_nonnegative" CHECK ("background_model_reservations"."consumed_output_tokens" >= 0),
	CONSTRAINT "background_model_reservations_settlement_shape_check" CHECK ((
        "background_model_reservations"."settled_at" IS NOT NULL
        OR
        ("background_model_reservations"."consumed_input_tokens" = 0 AND "background_model_reservations"."consumed_output_tokens" = 0)
      ))
);
--> statement-breakpoint
CREATE TABLE "data_export_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" "data_export_status" DEFAULT 'pending' NOT NULL,
	"job_id" text,
	"archive_bytes" "bytea",
	"archive_size" bigint,
	"archive_sha256" text,
	"error_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"downloaded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_export_jobs_archive_size_nonnegative" CHECK ("data_export_jobs"."archive_size" IS NULL OR ("data_export_jobs"."archive_size" >= 0 AND "data_export_jobs"."archive_size" <= 262144000)),
	CONSTRAINT "data_export_jobs_archive_digest_check" CHECK ("data_export_jobs"."archive_sha256" IS NULL OR (
        "data_export_jobs"."archive_sha256" ~ '^[0-9a-f]{64}$'
        AND "data_export_jobs"."archive_bytes" IS NOT NULL
        AND "data_export_jobs"."archive_sha256" = ENCODE(SHA256("data_export_jobs"."archive_bytes"), 'hex')
      )),
	CONSTRAINT "data_export_jobs_archive_shape_check" CHECK ((
        (
          "data_export_jobs"."status" = 'complete'
          AND "data_export_jobs"."archive_bytes" IS NOT NULL
          AND "data_export_jobs"."archive_size" IS NOT NULL
          AND "data_export_jobs"."archive_size" = OCTET_LENGTH("data_export_jobs"."archive_bytes")
          AND "data_export_jobs"."archive_sha256" IS NOT NULL
          AND "data_export_jobs"."completed_at" IS NOT NULL
          AND "data_export_jobs"."expires_at" IS NOT NULL
          AND "data_export_jobs"."expires_at" = "data_export_jobs"."completed_at" + INTERVAL '24 hours'
        )
        OR
        (
          "data_export_jobs"."status" <> 'complete'
          AND "data_export_jobs"."archive_bytes" IS NULL
          AND "data_export_jobs"."archive_size" IS NULL
          AND "data_export_jobs"."archive_sha256" IS NULL
          AND "data_export_jobs"."expires_at" IS NULL
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "memory_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"source_message_id" text,
	"source_attempt_id" text,
	"source_deleted_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"evidence_kind" "memory_evidence_kind" NOT NULL,
	CONSTRAINT "memory_evidence_source_shape_check" CHECK ((
        ("memory_evidence"."source_message_id" IS NOT NULL AND "memory_evidence"."source_deleted_at" IS NULL)
        OR
        ("memory_evidence"."source_message_id" IS NULL AND "memory_evidence"."source_attempt_id" IS NULL AND "memory_evidence"."source_deleted_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "memory_extraction_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"conversation_id" text,
	"generation_attempt_id" text,
	"memory_epoch" integer NOT NULL,
	"status" "background_operation_status" DEFAULT 'pending' NOT NULL,
	"job_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"error_category" text,
	"provider_request_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_input_tokens" bigint DEFAULT 0 NOT NULL,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"usage_estimated" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_extraction_runs_epoch_nonnegative" CHECK ("memory_extraction_runs"."memory_epoch" >= 0),
	CONSTRAINT "memory_extraction_runs_attempt_count_nonnegative" CHECK ("memory_extraction_runs"."attempt_count" >= 0),
	CONSTRAINT "memory_extraction_runs_estimated_tokens_nonnegative" CHECK ("memory_extraction_runs"."estimated_input_tokens" >= 0),
	CONSTRAINT "memory_extraction_runs_input_tokens_nonnegative" CHECK ("memory_extraction_runs"."input_tokens" IS NULL OR "memory_extraction_runs"."input_tokens" >= 0),
	CONSTRAINT "memory_extraction_runs_output_tokens_nonnegative" CHECK ("memory_extraction_runs"."output_tokens" IS NULL OR "memory_extraction_runs"."output_tokens" >= 0),
	CONSTRAINT "memory_extraction_runs_usage_shape_check" CHECK ((
        ("memory_extraction_runs"."input_tokens" IS NULL AND "memory_extraction_runs"."output_tokens" IS NULL AND "memory_extraction_runs"."usage_estimated" IS NULL)
        OR
        ("memory_extraction_runs"."input_tokens" IS NOT NULL AND "memory_extraction_runs"."output_tokens" IS NOT NULL AND "memory_extraction_runs"."usage_estimated" IS NOT NULL)
      )),
	CONSTRAINT "memory_extraction_runs_terminal_shape_check" CHECK ((
        ("memory_extraction_runs"."status" IN ('complete', 'failed', 'dead_letter', 'cancelled') AND "memory_extraction_runs"."finished_at" IS NOT NULL)
        OR
        ("memory_extraction_runs"."status" IN ('pending', 'queued', 'running', 'retrying') AND "memory_extraction_runs"."finished_at" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "memory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"memory_epoch" integer NOT NULL,
	"type" "memory_type" NOT NULL,
	"content" text NOT NULL,
	"normalized_content" text NOT NULL,
	"normalized_digest" text NOT NULL,
	"origin" "memory_origin" NOT NULL,
	"sensitivity" "memory_sensitivity" NOT NULL,
	"explicitness" "memory_explicitness" NOT NULL,
	"confidence" integer NOT NULL,
	"importance" integer NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_confirmed_at" timestamp with time zone NOT NULL,
	"user_edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memory_items_relationship_type_epoch_digest_unique" UNIQUE("user_id","character_id","type","memory_epoch","normalized_digest"),
	CONSTRAINT "memory_items_epoch_nonnegative" CHECK ("memory_items"."memory_epoch" >= 0),
	CONSTRAINT "memory_items_content_length_check" CHECK (CHAR_LENGTH("memory_items"."content") BETWEEN 1 AND 500 AND OCTET_LENGTH("memory_items"."content") <= 2000),
	CONSTRAINT "memory_items_normalized_content_length_check" CHECK (CHAR_LENGTH("memory_items"."normalized_content") BETWEEN 1 AND 500 AND OCTET_LENGTH("memory_items"."normalized_content") <= 2000),
	CONSTRAINT "memory_items_normalized_digest_check" CHECK ("memory_items"."normalized_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "memory_items_confidence_range" CHECK ("memory_items"."confidence" BETWEEN 0 AND 100),
	CONSTRAINT "memory_items_importance_range" CHECK ("memory_items"."importance" BETWEEN 0 AND 100),
	CONSTRAINT "memory_items_observation_order_check" CHECK ("memory_items"."last_confirmed_at" >= "memory_items"."first_observed_at"),
	CONSTRAINT "memory_items_user_edit_shape_check" CHECK ((
        ("memory_items"."origin" = 'automatic' AND "memory_items"."user_edited_at" IS NULL)
        OR
        ("memory_items"."origin" = 'user_edited' AND "memory_items"."user_edited_at" IS NOT NULL)
      )),
	CONSTRAINT "memory_items_sensitive_inference_check" CHECK (NOT (
        "memory_items"."sensitivity" = 'personal_explicit'
        AND "memory_items"."explicitness" = 'repeated_inference'
      )),
	CONSTRAINT "memory_items_revision_positive" CHECK ("memory_items"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "memory_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"deployment_default_enabled" boolean NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_settings_global_id_check" CHECK ("memory_settings"."id" = 'global'),
	CONSTRAINT "memory_settings_revision_positive" CHECK ("memory_settings"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "relationship_summaries" (
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"memory_epoch" integer NOT NULL,
	"current_version_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_summaries_pk" PRIMARY KEY("user_id","character_id"),
	CONSTRAINT "relationship_summaries_epoch_nonnegative" CHECK ("relationship_summaries"."memory_epoch" >= 0),
	CONSTRAINT "relationship_summaries_revision_positive" CHECK ("relationship_summaries"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "relationship_summary_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"memory_epoch" integer NOT NULL,
	"expected_summary_revision" integer NOT NULL,
	"based_on_memory_revision" integer NOT NULL,
	"status" "background_operation_status" DEFAULT 'pending' NOT NULL,
	"job_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"error_category" text,
	"provider_request_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_input_tokens" bigint DEFAULT 0 NOT NULL,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"usage_estimated" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_summary_runs_operation_unique" UNIQUE("user_id","character_id","memory_epoch","based_on_memory_revision"),
	CONSTRAINT "relationship_summary_runs_epoch_nonnegative" CHECK ("relationship_summary_runs"."memory_epoch" >= 0),
	CONSTRAINT "relationship_summary_runs_expected_revision_nonnegative" CHECK ("relationship_summary_runs"."expected_summary_revision" >= 0),
	CONSTRAINT "relationship_summary_runs_memory_revision_nonnegative" CHECK ("relationship_summary_runs"."based_on_memory_revision" >= 0),
	CONSTRAINT "relationship_summary_runs_attempt_count_nonnegative" CHECK ("relationship_summary_runs"."attempt_count" >= 0),
	CONSTRAINT "relationship_summary_runs_estimated_tokens_nonnegative" CHECK ("relationship_summary_runs"."estimated_input_tokens" >= 0),
	CONSTRAINT "relationship_summary_runs_input_tokens_nonnegative" CHECK ("relationship_summary_runs"."input_tokens" IS NULL OR "relationship_summary_runs"."input_tokens" >= 0),
	CONSTRAINT "relationship_summary_runs_output_tokens_nonnegative" CHECK ("relationship_summary_runs"."output_tokens" IS NULL OR "relationship_summary_runs"."output_tokens" >= 0),
	CONSTRAINT "relationship_summary_runs_usage_shape_check" CHECK ((
        ("relationship_summary_runs"."input_tokens" IS NULL AND "relationship_summary_runs"."output_tokens" IS NULL AND "relationship_summary_runs"."usage_estimated" IS NULL)
        OR
        ("relationship_summary_runs"."input_tokens" IS NOT NULL AND "relationship_summary_runs"."output_tokens" IS NOT NULL AND "relationship_summary_runs"."usage_estimated" IS NOT NULL)
      )),
	CONSTRAINT "relationship_summary_runs_terminal_shape_check" CHECK ((
        ("relationship_summary_runs"."status" IN ('complete', 'failed', 'dead_letter', 'cancelled') AND "relationship_summary_runs"."finished_at" IS NOT NULL)
        OR
        ("relationship_summary_runs"."status" IN ('pending', 'queued', 'running', 'retrying') AND "relationship_summary_runs"."finished_at" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "relationship_summary_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"memory_epoch" integer NOT NULL,
	"content" text NOT NULL,
	"origin" "memory_origin" NOT NULL,
	"based_on_memory_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_summary_versions_identity_unique" UNIQUE("id","user_id","character_id","memory_epoch"),
	CONSTRAINT "relationship_summary_versions_epoch_nonnegative" CHECK ("relationship_summary_versions"."memory_epoch" >= 0),
	CONSTRAINT "relationship_summary_versions_memory_revision_nonnegative" CHECK ("relationship_summary_versions"."based_on_memory_revision" >= 0),
	CONSTRAINT "relationship_summary_versions_content_length_check" CHECK (CHAR_LENGTH("relationship_summary_versions"."content") <= 4000 AND OCTET_LENGTH("relationship_summary_versions"."content") <= 16000)
);
--> statement-breakpoint
CREATE TABLE "user_character_memory_settings" (
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"recording_enabled" boolean DEFAULT true NOT NULL,
	"usage_enabled" boolean DEFAULT true NOT NULL,
	"memory_epoch" integer DEFAULT 0 NOT NULL,
	"memory_revision" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_character_memory_settings_pk" PRIMARY KEY("user_id","character_id"),
	CONSTRAINT "user_character_memory_settings_epoch_nonnegative" CHECK ("user_character_memory_settings"."memory_epoch" >= 0),
	CONSTRAINT "user_character_memory_settings_memory_revision_nonnegative" CHECK ("user_character_memory_settings"."memory_revision" >= 0),
	CONSTRAINT "user_character_memory_settings_revision_positive" CHECK ("user_character_memory_settings"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "usage_ledger" DROP CONSTRAINT "usage_ledger_outcome_check";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deletion_pending_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "background_operation_id" text;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "memory_extraction_run_id" text;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "relationship_summary_version_id" text;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "workload_type" "usage_workload_type" DEFAULT 'chat_generation' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_jobs" ADD CONSTRAINT "data_export_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_evidence" ADD CONSTRAINT "memory_evidence_memory_id_memory_items_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_evidence" ADD CONSTRAINT "memory_evidence_source_message_id_conversation_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_evidence" ADD CONSTRAINT "memory_evidence_source_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("source_attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_extraction_runs" ADD CONSTRAINT "memory_extraction_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_extraction_runs" ADD CONSTRAINT "memory_extraction_runs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_extraction_runs" ADD CONSTRAINT "memory_extraction_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_extraction_runs" ADD CONSTRAINT "memory_extraction_runs_generation_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("generation_attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_summaries" ADD CONSTRAINT "relationship_summaries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_summaries" ADD CONSTRAINT "relationship_summaries_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_summaries" ADD CONSTRAINT "relationship_summaries_current_version_id_relationship_summary_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."relationship_summary_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_summary_runs" ADD CONSTRAINT "relationship_summary_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_summary_runs" ADD CONSTRAINT "relationship_summary_runs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_summary_versions" ADD CONSTRAINT "relationship_summary_versions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_summary_versions" ADD CONSTRAINT "relationship_summary_versions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_character_memory_settings" ADD CONSTRAINT "user_character_memory_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_character_memory_settings" ADD CONSTRAINT "user_character_memory_settings_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_user_unique" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_job_unique" ON "account_deletion_requests" USING btree ("job_id") WHERE "account_deletion_requests"."job_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "account_deletion_requests_status_idx" ON "account_deletion_requests" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "background_model_reservations_period_idx" ON "background_model_reservations" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "data_export_jobs_one_active_per_user_idx" ON "data_export_jobs" USING btree ("user_id") WHERE "data_export_jobs"."status" IN ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "data_export_jobs_job_unique" ON "data_export_jobs" USING btree ("job_id") WHERE "data_export_jobs"."job_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "data_export_jobs_expiry_idx" ON "data_export_jobs" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_evidence_message_unique" ON "memory_evidence" USING btree ("memory_id","source_message_id") WHERE "memory_evidence"."source_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "memory_evidence_memory_idx" ON "memory_evidence" USING btree ("memory_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_extraction_runs_attempt_unique" ON "memory_extraction_runs" USING btree ("generation_attempt_id") WHERE "memory_extraction_runs"."generation_attempt_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_extraction_runs_job_unique" ON "memory_extraction_runs" USING btree ("job_id") WHERE "memory_extraction_runs"."job_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "memory_extraction_runs_pending_idx" ON "memory_extraction_runs" USING btree ("status","next_retry_at","created_at");--> statement-breakpoint
CREATE INDEX "memory_extraction_runs_relationship_idx" ON "memory_extraction_runs" USING btree ("user_id","character_id","memory_epoch");--> statement-breakpoint
CREATE INDEX "memory_items_relationship_recall_idx" ON "memory_items" USING btree ("user_id","character_id","memory_epoch","importance","confidence","last_confirmed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_summary_runs_job_unique" ON "relationship_summary_runs" USING btree ("job_id") WHERE "relationship_summary_runs"."job_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "relationship_summary_runs_pending_idx" ON "relationship_summary_runs" USING btree ("status","next_retry_at","created_at");--> statement-breakpoint
CREATE INDEX "relationship_summary_versions_relationship_idx" ON "relationship_summary_versions" USING btree ("user_id","character_id","memory_epoch","created_at");--> statement-breakpoint
CREATE INDEX "user_character_memory_settings_character_idx" ON "user_character_memory_settings" USING btree ("character_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_background_operation_unique" ON "usage_ledger" USING btree ("background_operation_id") WHERE "usage_ledger"."background_operation_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_workload_shape_check" CHECK ((
        (
          "usage_ledger"."workload_type" = 'chat_generation'
          AND "usage_ledger"."background_operation_id" IS NULL
          AND "usage_ledger"."memory_extraction_run_id" IS NULL
          AND "usage_ledger"."relationship_summary_version_id" IS NULL
        )
        OR
        (
          "usage_ledger"."workload_type" = 'memory_extraction'
          AND "usage_ledger"."background_operation_id" IS NOT NULL
          AND "usage_ledger"."user_request_units" = 0
          AND "usage_ledger"."relationship_summary_version_id" IS NULL
        )
        OR
        (
          "usage_ledger"."workload_type" = 'summary_refresh'
          AND "usage_ledger"."background_operation_id" IS NOT NULL
          AND "usage_ledger"."user_request_units" = 0
          AND "usage_ledger"."memory_extraction_run_id" IS NULL
        )
      ));--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_outcome_check" CHECK ("usage_ledger"."outcome" IN ('complete', 'failed', 'interrupted', 'cancelled'));--> statement-breakpoint
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
     AND NEW.background_operation_id IS NOT DISTINCT FROM OLD.background_operation_id
     AND NEW.memory_extraction_run_id IS NOT DISTINCT FROM OLD.memory_extraction_run_id
     AND NEW.relationship_summary_version_id IS NOT DISTINCT FROM OLD.relationship_summary_version_id
     AND NEW.workload_type IS NOT DISTINCT FROM OLD.workload_type
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
CREATE OR REPLACE FUNCTION enforce_memory_settings_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'memory settings identity is immutable';
  END IF;
  IF NEW.revision < OLD.revision THEN
    RAISE EXCEPTION 'memory settings revision cannot decrease';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER memory_settings_preserve_revision
BEFORE UPDATE ON memory_settings
FOR EACH ROW
EXECUTE FUNCTION enforce_memory_settings_revision();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_relationship_memory_setting_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(NEW.user_id, NEW.character_id)
     IS DISTINCT FROM ROW(OLD.user_id, OLD.character_id) THEN
    RAISE EXCEPTION 'relationship memory setting identity is immutable';
  END IF;
  IF NEW.memory_epoch < OLD.memory_epoch THEN
    RAISE EXCEPTION 'memory epoch cannot decrease';
  END IF;
  IF NEW.memory_revision < OLD.memory_revision THEN
    RAISE EXCEPTION 'memory revision cannot decrease';
  END IF;
  IF NEW.revision < OLD.revision THEN
    RAISE EXCEPTION 'settings revision cannot decrease';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER user_character_memory_settings_preserve_invariants
BEFORE UPDATE ON user_character_memory_settings
FOR EACH ROW
EXECUTE FUNCTION enforce_relationship_memory_setting_invariants();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_memory_item_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_epoch integer;
BEGIN
  SELECT memory_epoch
  INTO current_epoch
  FROM user_character_memory_settings
  WHERE user_id = NEW.user_id
    AND character_id = NEW.character_id;

  IF current_epoch IS NULL OR NEW.memory_epoch <> current_epoch THEN
    RAISE EXCEPTION 'memory item epoch must match the current relationship epoch';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.user_id, NEW.character_id, NEW.memory_epoch)
       IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.character_id, OLD.memory_epoch) THEN
      RAISE EXCEPTION 'memory item identity is immutable';
    END IF;
    IF NEW.revision < OLD.revision THEN
      RAISE EXCEPTION 'memory item revision cannot decrease';
    END IF;
    IF OLD.origin = 'user_edited' AND NEW.origin = 'automatic' THEN
      RAISE EXCEPTION 'user-edited memory cannot be replaced by automatic content';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER memory_items_preserve_invariants
BEFORE INSERT OR UPDATE ON memory_items
FOR EACH ROW
EXECUTE FUNCTION enforce_memory_item_invariants();--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_deleted_memory_evidence_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.source_message_id IS NOT NULL AND NEW.source_message_id IS NULL THEN
    NEW.source_attempt_id := NULL;
    NEW.source_deleted_at := COALESCE(NEW.source_deleted_at, clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER memory_evidence_mark_deleted_source
BEFORE UPDATE OF source_message_id ON memory_evidence
FOR EACH ROW
EXECUTE FUNCTION preserve_deleted_memory_evidence_source();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_memory_evidence_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  memory_user_id text;
  memory_character_id text;
  source_conversation_id text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.memory_id IS DISTINCT FROM OLD.memory_id THEN
    RAISE EXCEPTION 'memory evidence identity is immutable';
  END IF;

  IF NEW.source_message_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id, character_id
  INTO memory_user_id, memory_character_id
  FROM memory_items
  WHERE id = NEW.memory_id;

  SELECT conversations.id
  INTO source_conversation_id
  FROM conversation_messages
  JOIN conversations
    ON conversations.id = conversation_messages.conversation_id
  WHERE conversation_messages.id = NEW.source_message_id
    AND conversation_messages.kind = 'user'
    AND conversation_messages.role = 'user'
    AND conversations.user_id = memory_user_id
    AND conversations.character_id = memory_character_id;

  IF source_conversation_id IS NULL THEN
    RAISE EXCEPTION 'memory evidence source must belong to the same user and character';
  END IF;

  IF NEW.source_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM generation_attempts
    JOIN conversation_messages
      ON conversation_messages.id = generation_attempts.assistant_message_id
    WHERE generation_attempts.id = NEW.source_attempt_id
      AND generation_attempts.user_id = memory_user_id
      AND conversation_messages.conversation_id = source_conversation_id
  ) THEN
    RAISE EXCEPTION 'memory evidence attempt must belong to the source conversation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER memory_evidence_validate_ownership
BEFORE INSERT OR UPDATE OF memory_id, source_message_id, source_attempt_id
ON memory_evidence
FOR EACH ROW
EXECUTE FUNCTION enforce_memory_evidence_ownership();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_extraction_run_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM generation_attempts
      JOIN conversation_messages
        ON conversation_messages.id = generation_attempts.assistant_message_id
      JOIN conversations
        ON conversations.id = conversation_messages.conversation_id
      JOIN user_character_memory_settings
        ON user_character_memory_settings.user_id = NEW.user_id
       AND user_character_memory_settings.character_id = NEW.character_id
      WHERE generation_attempts.id = NEW.generation_attempt_id
        AND generation_attempts.user_id = NEW.user_id
        AND generation_attempts.status = 'complete'
        AND generation_attempts.is_current
        AND conversations.id = NEW.conversation_id
        AND conversations.user_id = NEW.user_id
        AND conversations.character_id = NEW.character_id
        AND user_character_memory_settings.memory_epoch = NEW.memory_epoch
    ) THEN
      RAISE EXCEPTION 'memory extraction requires a completed generation attempt owned by the captured relationship and current epoch';
    END IF;
  ELSE
    IF ROW(NEW.id, NEW.user_id, NEW.character_id, NEW.memory_epoch)
       IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.character_id, OLD.memory_epoch) THEN
      RAISE EXCEPTION 'memory extraction run identity is immutable';
    END IF;
    IF ROW(NEW.conversation_id, NEW.generation_attempt_id)
       IS DISTINCT FROM ROW(OLD.conversation_id, OLD.generation_attempt_id)
       AND NOT (
         pg_trigger_depth() > 1
         AND OLD.conversation_id IS NOT NULL
         AND NEW.conversation_id IS NULL
         AND NEW.generation_attempt_id IS NULL
         AND (
           (
             OLD.status IN ('pending', 'queued', 'running', 'retrying')
             AND NEW.status = 'cancelled'
             AND NEW.finished_at IS NOT NULL
           )
           OR
           (
             OLD.status IN ('complete', 'failed', 'dead_letter', 'cancelled')
             AND NEW.status = OLD.status
             AND NEW.finished_at IS NOT DISTINCT FROM OLD.finished_at
           )
         )
       ) THEN
      RAISE EXCEPTION 'memory extraction source identity is immutable except during conversation deletion';
    END IF;
    IF OLD.status IN ('complete', 'failed', 'dead_letter', 'cancelled')
       AND ROW(
         NEW.status,
         NEW.job_id,
         NEW.attempt_count,
         NEW.next_retry_at,
         NEW.error_category,
         NEW.provider_request_ids,
         NEW.estimated_input_tokens,
         NEW.input_tokens,
         NEW.output_tokens,
         NEW.usage_estimated,
         NEW.created_at,
         NEW.started_at,
         NEW.finished_at
       ) IS DISTINCT FROM ROW(
         OLD.status,
         OLD.job_id,
         OLD.attempt_count,
         OLD.next_retry_at,
         OLD.error_category,
         OLD.provider_request_ids,
         OLD.estimated_input_tokens,
         OLD.input_tokens,
         OLD.output_tokens,
         OLD.usage_estimated,
         OLD.created_at,
         OLD.started_at,
         OLD.finished_at
       ) THEN
      RAISE EXCEPTION 'terminal memory extraction run is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER memory_extraction_runs_preserve_invariants
BEFORE INSERT OR UPDATE ON memory_extraction_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_extraction_run_invariants();--> statement-breakpoint
CREATE OR REPLACE FUNCTION cancel_conversation_memory_extraction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE memory_extraction_runs
  SET status = CASE
        WHEN status IN ('pending', 'queued', 'running', 'retrying')
          THEN 'cancelled'::background_operation_status
        ELSE status
      END,
      conversation_id = NULL,
      generation_attempt_id = NULL,
      finished_at = CASE
        WHEN status IN ('pending', 'queued', 'running', 'retrying')
          THEN COALESCE(finished_at, clock_timestamp())
        ELSE finished_at
      END,
      updated_at = clock_timestamp()
  WHERE conversation_id = OLD.id
    AND (conversation_id IS NOT NULL OR generation_attempt_id IS NOT NULL);
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER conversations_cancel_memory_extraction
BEFORE DELETE ON conversations
FOR EACH ROW
EXECUTE FUNCTION cancel_conversation_memory_extraction();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_summary_version_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM user_character_memory_settings
      WHERE user_id = NEW.user_id
        AND character_id = NEW.character_id
        AND memory_epoch = NEW.memory_epoch
        AND memory_revision = NEW.based_on_memory_revision
    ) THEN
      RAISE EXCEPTION 'relationship summary version must capture the current relationship epoch and memory revision';
    END IF;
  ELSE
    IF ROW(NEW.id, NEW.user_id, NEW.character_id, NEW.memory_epoch)
       IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.character_id, OLD.memory_epoch) THEN
      RAISE EXCEPTION 'relationship summary version identity is immutable';
    END IF;
    IF ROW(NEW.content, NEW.origin, NEW.based_on_memory_revision, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.content, OLD.origin, OLD.based_on_memory_revision, OLD.created_at) THEN
      RAISE EXCEPTION 'relationship summary versions are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER relationship_summary_versions_preserve_invariants
BEFORE INSERT OR UPDATE ON relationship_summary_versions
FOR EACH ROW
EXECUTE FUNCTION enforce_summary_version_invariants();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_current_summary_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_origin memory_origin;
  prior_origin memory_origin;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.user_id, NEW.character_id)
       IS DISTINCT FROM ROW(OLD.user_id, OLD.character_id) THEN
      RAISE EXCEPTION 'relationship summary identity is immutable';
    END IF;
    IF NEW.memory_epoch < OLD.memory_epoch THEN
      RAISE EXCEPTION 'relationship summary memory epoch cannot decrease';
    END IF;
    IF NEW.revision < OLD.revision THEN
      RAISE EXCEPTION 'relationship summary revision cannot decrease';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_character_memory_settings
    WHERE user_id = NEW.user_id
      AND character_id = NEW.character_id
      AND memory_epoch = NEW.memory_epoch
  ) THEN
    RAISE EXCEPTION 'relationship summary must use the current relationship epoch';
  END IF;

  IF NEW.current_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT origin
  INTO next_origin
  FROM relationship_summary_versions
  WHERE id = NEW.current_version_id
    AND user_id = NEW.user_id
    AND character_id = NEW.character_id
    AND memory_epoch = NEW.memory_epoch;

  IF next_origin IS NULL THEN
    RAISE EXCEPTION 'current summary version must share relationship ownership and epoch';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.current_version_id IS NOT NULL
     AND NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
    SELECT origin
    INTO prior_origin
    FROM relationship_summary_versions
    WHERE id = OLD.current_version_id;

    IF prior_origin = 'user_edited' AND next_origin = 'automatic' THEN
      RAISE EXCEPTION 'current user-edited summary cannot be replaced automatically';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER relationship_summaries_validate_current_version
BEFORE INSERT OR UPDATE ON relationship_summaries
FOR EACH ROW
EXECUTE FUNCTION enforce_current_summary_version();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_summary_run_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM user_character_memory_settings
      WHERE user_id = NEW.user_id
        AND character_id = NEW.character_id
        AND memory_epoch = NEW.memory_epoch
        AND memory_revision = NEW.based_on_memory_revision
    ) THEN
      RAISE EXCEPTION 'relationship summary run must capture the current relationship epoch and memory revision';
    END IF;
    IF NEW.expected_summary_revision <> COALESCE((
      SELECT revision
      FROM relationship_summaries
      WHERE user_id = NEW.user_id
        AND character_id = NEW.character_id
    ), 0) THEN
      RAISE EXCEPTION 'relationship summary run must capture the current summary revision';
    END IF;
  ELSE
    IF ROW(
         NEW.id,
         NEW.user_id,
         NEW.character_id,
         NEW.memory_epoch,
         NEW.expected_summary_revision,
         NEW.based_on_memory_revision
       ) IS DISTINCT FROM ROW(
         OLD.id,
         OLD.user_id,
         OLD.character_id,
         OLD.memory_epoch,
         OLD.expected_summary_revision,
         OLD.based_on_memory_revision
       ) THEN
      RAISE EXCEPTION 'relationship summary run identity is immutable';
    END IF;
    IF OLD.status IN ('complete', 'failed', 'dead_letter', 'cancelled')
       AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'terminal relationship summary run is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER relationship_summary_runs_preserve_invariants
BEFORE INSERT OR UPDATE ON relationship_summary_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_summary_run_invariants();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_background_reservation_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
       NEW.id,
       NEW.operation_id,
       NEW.workload_type,
       NEW.period_start,
       NEW.period_end,
       NEW.reserved_tokens,
       NEW.created_at
     ) IS DISTINCT FROM ROW(
       OLD.id,
       OLD.operation_id,
       OLD.workload_type,
       OLD.period_start,
       OLD.period_end,
       OLD.reserved_tokens,
       OLD.created_at
     ) THEN
    RAISE EXCEPTION 'background reservation identity is immutable';
  END IF;
  IF OLD.settled_at IS NOT NULL
     AND ROW(NEW.settled_at, NEW.consumed_input_tokens, NEW.consumed_output_tokens)
         IS DISTINCT FROM
         ROW(OLD.settled_at, OLD.consumed_input_tokens, OLD.consumed_output_tokens) THEN
    RAISE EXCEPTION 'background reservation terminal settlement is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER background_model_reservations_preserve_invariants
BEFORE UPDATE ON background_model_reservations
FOR EACH ROW
EXECUTE FUNCTION enforce_background_reservation_invariants();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_data_export_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(NEW.id, NEW.user_id, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'data export identity is immutable';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('failed', 'expired', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal data export status is immutable and cannot be re-completed';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('complete', 'failed', 'expired', 'cancelled')
     AND NEW.status IN ('pending', 'running') THEN
    RAISE EXCEPTION 'terminal data export cannot return to an active state';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'complete' THEN
    IF NEW.status = 'complete' THEN
      IF ROW(
           NEW.id,
           NEW.user_id,
           NEW.status,
           NEW.job_id,
           NEW.archive_bytes,
           NEW.archive_size,
           NEW.archive_sha256,
           NEW.error_category,
           NEW.created_at,
           NEW.started_at,
           NEW.completed_at,
           NEW.expires_at
         ) IS DISTINCT FROM ROW(
           OLD.id,
           OLD.user_id,
           OLD.status,
           OLD.job_id,
           OLD.archive_bytes,
           OLD.archive_size,
           OLD.archive_sha256,
           OLD.error_category,
           OLD.created_at,
           OLD.started_at,
           OLD.completed_at,
           OLD.expires_at
         ) THEN
        RAISE EXCEPTION 'completed data export retention and archive identity are immutable';
      END IF;
    ELSIF NEW.status = 'expired' THEN
      IF ROW(
           NEW.id,
           NEW.user_id,
           NEW.job_id,
           NEW.error_category,
           NEW.created_at,
           NEW.started_at,
           NEW.completed_at
         ) IS DISTINCT FROM ROW(
           OLD.id,
           OLD.user_id,
           OLD.job_id,
           OLD.error_category,
           OLD.created_at,
           OLD.started_at,
           OLD.completed_at
         )
         OR NEW.archive_bytes IS NOT NULL
         OR NEW.archive_size IS NOT NULL
         OR NEW.archive_sha256 IS NOT NULL
         OR NEW.expires_at IS NOT NULL THEN
        RAISE EXCEPTION 'completed data export only permits archive removal during expiry';
      END IF;
    ELSE
      RAISE EXCEPTION 'completed data export only permits download bookkeeping or expiry';
    END IF;
  END IF;
  IF NEW.archive_bytes IS NOT NULL
     AND (
       NEW.status <> 'complete'
       OR NEW.expires_at IS NULL
       OR NEW.expires_at <= clock_timestamp()
     ) THEN
    RAISE EXCEPTION 'archive bytes require a completed unexpired export';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER data_export_jobs_preserve_invariants
BEFORE INSERT OR UPDATE ON data_export_jobs
FOR EACH ROW
EXECUTE FUNCTION enforce_data_export_invariants();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_account_deletion_request_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'account deletion request identity is immutable';
  END IF;
  IF OLD.status = 'complete' THEN
    IF NOT (
      OLD.user_id IS NOT NULL
      AND NEW.user_id IS NULL
      AND ROW(
        NEW.id,
        NEW.verification_token_hash,
        NEW.verification_expires_at,
        NEW.verification_consumed_at,
        NEW.status,
        NEW.current_stage,
        NEW.job_id,
        NEW.confirmed_at,
        NEW.locked_at,
        NEW.completed_at,
        NEW.error_category,
        NEW.attempt_count
      ) IS NOT DISTINCT FROM ROW(
        OLD.id,
        OLD.verification_token_hash,
        OLD.verification_expires_at,
        OLD.verification_consumed_at,
        OLD.status,
        OLD.current_stage,
        OLD.job_id,
        OLD.confirmed_at,
        OLD.locked_at,
        OLD.completed_at,
        OLD.error_category,
        OLD.attempt_count
      )
    ) THEN
      RAISE EXCEPTION 'completed account deletion tombstone is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.user_id IS NOT NULL
     AND NEW.user_id IS NOT NULL
     AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'account deletion request user identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER account_deletion_requests_preserve_invariants
BEFORE UPDATE ON account_deletion_requests
FOR EACH ROW
EXECUTE FUNCTION enforce_account_deletion_request_invariants();--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_account_deletion_tombstone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM account_deletion_requests
    WHERE user_id = OLD.id
      AND status <> 'complete'
  ) THEN
    RAISE EXCEPTION 'cannot delete user with unfinished account deletion request';
  END IF;

  UPDATE account_deletion_requests
  SET user_id = NULL,
      updated_at = clock_timestamp()
  WHERE user_id = OLD.id
    AND status = 'complete';

  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER user_preserve_account_deletion_tombstone
BEFORE DELETE ON "user"
FOR EACH ROW
EXECUTE FUNCTION preserve_account_deletion_tombstone();