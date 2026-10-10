CREATE TABLE "relationship_summary_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"execution_number" integer NOT NULL,
	"summary" text,
	"model_id" text NOT NULL,
	"provider_identity" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_input_tokens" bigint NOT NULL,
	"estimated_output_tokens" bigint DEFAULT 0 NOT NULL,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error_category" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"response_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_summary_executions_run_number_unique" UNIQUE("run_id","execution_number"),
	CONSTRAINT "relationship_summary_executions_number_check" CHECK ("relationship_summary_executions"."execution_number" BETWEEN 1 AND 5),
	CONSTRAINT "relationship_summary_executions_tokens_check" CHECK (
      "relationship_summary_executions"."estimated_input_tokens" >= 0 AND "relationship_summary_executions"."estimated_output_tokens" >= 0
      AND ("relationship_summary_executions"."input_tokens" IS NULL OR "relationship_summary_executions"."input_tokens" >= 0)
      AND ("relationship_summary_executions"."output_tokens" IS NULL OR "relationship_summary_executions"."output_tokens" >= 0)
      AND "relationship_summary_executions"."latency_ms" >= 0),
	CONSTRAINT "relationship_summary_executions_receipt_shape" CHECK (
      ("relationship_summary_executions"."settled_at" IS NULL OR ("relationship_summary_executions"."response_at" IS NOT NULL AND "relationship_summary_executions"."summary" IS NULL))
      AND ("relationship_summary_executions"."summary" IS NULL OR (CHAR_LENGTH("relationship_summary_executions"."summary") <= 4000 AND OCTET_LENGTH("relationship_summary_executions"."summary") <= 16000)))
);
--> statement-breakpoint
ALTER TABLE "relationship_summary_runs" DROP CONSTRAINT "relationship_summary_runs_operation_unique";--> statement-breakpoint
ALTER TABLE "relationship_summary_runs" ADD COLUMN "explicit_regeneration" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship_summary_runs" ADD COLUMN "dead_letter_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationship_summary_runs" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "relationship_summary_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationship_summary_executions" ADD CONSTRAINT "relationship_summary_executions_run_id_relationship_summary_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."relationship_summary_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_summary_runs_one_active_revision" ON "relationship_summary_runs" USING btree ("user_id","character_id","memory_epoch","based_on_memory_revision") WHERE "relationship_summary_runs"."status" IN ('pending', 'queued', 'running', 'retrying');--> statement-breakpoint
ALTER TABLE "relationship_summary_runs" ADD CONSTRAINT "relationship_summary_runs_operation_unique" UNIQUE("user_id","character_id","memory_epoch","based_on_memory_revision","expected_summary_revision");--> statement-breakpoint
ALTER TABLE "relationship_summary_runs" ADD CONSTRAINT "relationship_summary_runs_attempt_count_limit" CHECK ("relationship_summary_runs"."attempt_count" <= 5);--> statement-breakpoint
ALTER TABLE "relationship_summary_runs" ADD CONSTRAINT "relationship_summary_runs_publication_shape" CHECK ("relationship_summary_runs"."dead_letter_published_at" IS NULL OR "relationship_summary_runs"."status" = 'dead_letter');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_summary_run_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_character_memory_settings
      WHERE user_id = NEW.user_id AND character_id = NEW.character_id
        AND memory_epoch = NEW.memory_epoch AND memory_revision = NEW.based_on_memory_revision
    ) THEN
      RAISE EXCEPTION 'relationship summary run must capture the current relationship epoch and memory revision';
    END IF;
    IF NEW.expected_summary_revision <> COALESCE((
      SELECT revision FROM relationship_summaries
      WHERE user_id = NEW.user_id AND character_id = NEW.character_id
    ), 0) THEN
      RAISE EXCEPTION 'relationship summary run must capture the current summary revision';
    END IF;
  ELSE
    IF ROW(NEW.id, NEW.user_id, NEW.character_id, NEW.memory_epoch,
      NEW.expected_summary_revision, NEW.based_on_memory_revision, NEW.explicit_regeneration, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.character_id, OLD.memory_epoch,
      OLD.expected_summary_revision, OLD.based_on_memory_revision, OLD.explicit_regeneration, OLD.created_at) THEN
      RAISE EXCEPTION 'relationship summary run identity is immutable';
    END IF;
    IF NEW.attempt_count < OLD.attempt_count OR NEW.attempt_count > 5 THEN
      RAISE EXCEPTION 'relationship summary execution count must be monotonic and at most five';
    END IF;
    IF OLD.status IN ('complete', 'failed', 'dead_letter', 'cancelled')
      AND ROW(NEW.status, NEW.job_id, NEW.attempt_count, NEW.next_retry_at,
        NEW.error_category, NEW.provider_request_ids, NEW.estimated_input_tokens,
        NEW.input_tokens, NEW.output_tokens, NEW.usage_estimated, NEW.started_at, NEW.finished_at)
      IS DISTINCT FROM ROW(OLD.status, OLD.job_id, OLD.attempt_count, OLD.next_retry_at,
        OLD.error_category, OLD.provider_request_ids, OLD.estimated_input_tokens,
        OLD.input_tokens, OLD.output_tokens, OLD.usage_estimated, OLD.started_at, OLD.finished_at)
      AND NOT (
        OLD.status = 'failed' AND NEW.status = 'pending'
        AND OLD.attempt_count < 5 AND NEW.attempt_count = OLD.attempt_count
        AND NEW.finished_at IS NULL AND NEW.next_retry_at IS NULL AND NEW.job_id IS NULL
        AND NEW.error_category IS NULL AND NEW.claim_token IS NULL AND NEW.lease_expires_at IS NULL
        AND ROW(NEW.provider_request_ids, NEW.estimated_input_tokens, NEW.input_tokens,
          NEW.output_tokens, NEW.usage_estimated, NEW.started_at)
          IS NOT DISTINCT FROM ROW(OLD.provider_request_ids, OLD.estimated_input_tokens, OLD.input_tokens,
          OLD.output_tokens, OLD.usage_estimated, OLD.started_at)
      ) THEN
      RAISE EXCEPTION 'terminal relationship summary run is immutable';
    END IF;
    IF OLD.dead_letter_published_at IS NOT NULL
      AND NEW.dead_letter_published_at IS DISTINCT FROM OLD.dead_letter_published_at THEN
      RAISE EXCEPTION 'summary dead-letter publication receipt is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_current_summary_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_origin memory_origin;
  prior_origin memory_origin;
  next_memory_revision integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.user_id, NEW.character_id) IS DISTINCT FROM ROW(OLD.user_id, OLD.character_id) THEN
      RAISE EXCEPTION 'relationship summary identity is immutable';
    END IF;
    IF NEW.memory_epoch < OLD.memory_epoch THEN
      RAISE EXCEPTION 'relationship summary memory epoch cannot decrease';
    END IF;
    IF NEW.revision < OLD.revision OR
      (NEW.current_version_id IS DISTINCT FROM OLD.current_version_id AND NEW.revision <> OLD.revision + 1) THEN
      RAISE EXCEPTION 'relationship summary revision must advance with its current version';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_character_memory_settings
    WHERE user_id = NEW.user_id AND character_id = NEW.character_id AND memory_epoch = NEW.memory_epoch
  ) THEN RAISE EXCEPTION 'relationship summary must use the current relationship epoch'; END IF;
  IF NEW.current_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT origin, based_on_memory_revision INTO next_origin, next_memory_revision
  FROM relationship_summary_versions
  WHERE id = NEW.current_version_id AND user_id = NEW.user_id
    AND character_id = NEW.character_id AND memory_epoch = NEW.memory_epoch;
  IF next_origin IS NULL THEN
    RAISE EXCEPTION 'current summary version must share relationship ownership and epoch';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.current_version_id IS NOT NULL
    AND NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
    SELECT origin INTO prior_origin FROM relationship_summary_versions WHERE id = OLD.current_version_id;
    IF prior_origin = 'user_edited' AND next_origin = 'automatic' AND NOT EXISTS (
      SELECT 1 FROM relationship_summary_runs
      WHERE user_id = NEW.user_id AND character_id = NEW.character_id AND memory_epoch = NEW.memory_epoch
        AND expected_summary_revision = OLD.revision AND based_on_memory_revision = next_memory_revision
        AND explicit_regeneration AND status = 'running'
    ) THEN RAISE EXCEPTION 'current user-edited summary cannot be replaced automatically'; END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE FUNCTION preserve_summary_execution_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.run_id, NEW.execution_number, NEW.estimated_input_tokens, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.run_id, OLD.execution_number, OLD.estimated_input_tokens, OLD.created_at) THEN
    RAISE EXCEPTION 'summary execution identity is immutable';
  END IF;
  IF OLD.response_at IS NOT NULL AND (
    ROW(NEW.model_id, NEW.provider_identity, NEW.estimated_output_tokens, NEW.input_tokens, NEW.output_tokens,
      NEW.latency_ms, NEW.error_category, NEW.retryable, NEW.response_at)
    IS DISTINCT FROM ROW(OLD.model_id, OLD.provider_identity, OLD.estimated_output_tokens, OLD.input_tokens, OLD.output_tokens,
      OLD.latency_ms, OLD.error_category, OLD.retryable, OLD.response_at)
    OR (NEW.summary IS NOT NULL AND NEW.summary IS DISTINCT FROM OLD.summary)
  ) THEN RAISE EXCEPTION 'summary response receipt is immutable except for content removal'; END IF;
  IF OLD.settled_at IS NOT NULL AND NEW.settled_at IS DISTINCT FROM OLD.settled_at THEN
    RAISE EXCEPTION 'summary execution settlement is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER relationship_summary_executions_preserve_receipt BEFORE UPDATE
ON relationship_summary_executions FOR EACH ROW EXECUTE FUNCTION preserve_summary_execution_receipt();--> statement-breakpoint
CREATE FUNCTION cancel_summary_on_relationship_invalidation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.recording_enabled AND NOT NEW.recording_enabled)
    OR OLD.memory_epoch <> NEW.memory_epoch OR OLD.memory_revision <> NEW.memory_revision THEN
    UPDATE relationship_summary_runs SET status = 'cancelled', next_retry_at = NULL,
      finished_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE user_id = NEW.user_id AND character_id = NEW.character_id
      AND status IN ('pending', 'queued', 'running', 'retrying');
    UPDATE relationship_summary_executions SET summary = NULL WHERE summary IS NOT NULL
      AND run_id IN (SELECT id FROM relationship_summary_runs
        WHERE user_id = NEW.user_id AND character_id = NEW.character_id);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER relationship_settings_cancel_summary BEFORE UPDATE
ON user_character_memory_settings FOR EACH ROW EXECUTE FUNCTION cancel_summary_on_relationship_invalidation();--> statement-breakpoint
CREATE FUNCTION cancel_summary_on_global_disable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.enabled AND NOT NEW.enabled THEN
    UPDATE relationship_summary_runs SET status = 'cancelled', next_retry_at = NULL,
      finished_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE status IN ('pending', 'queued', 'running', 'retrying');
    UPDATE relationship_summary_executions SET summary = NULL WHERE summary IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER memory_settings_cancel_summary BEFORE UPDATE OF enabled ON memory_settings
FOR EACH ROW EXECUTE FUNCTION cancel_summary_on_global_disable();--> statement-breakpoint
CREATE FUNCTION cancel_summary_on_account_invalidation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NOT COALESCE(OLD.banned, false) AND COALESCE(NEW.banned, false))
    OR (OLD.deletion_pending_at IS NULL AND NEW.deletion_pending_at IS NOT NULL) THEN
    UPDATE relationship_summary_runs SET status = 'cancelled', next_retry_at = NULL,
      finished_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE user_id = NEW.id AND status IN ('pending', 'queued', 'running', 'retrying');
    UPDATE relationship_summary_executions SET summary = NULL WHERE summary IS NOT NULL
      AND run_id IN (SELECT id FROM relationship_summary_runs WHERE user_id = NEW.id);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER user_cancel_summary BEFORE UPDATE OF banned, deletion_pending_at ON "user"
FOR EACH ROW EXECUTE FUNCTION cancel_summary_on_account_invalidation();