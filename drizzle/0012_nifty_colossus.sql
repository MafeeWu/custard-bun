ALTER TABLE "generation_attempts" ADD COLUMN "extraction_memory_epoch" integer;--> statement-breakpoint
ALTER TABLE "memory_extraction_runs" ADD COLUMN "dead_letter_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_extraction_epoch_nonnegative" CHECK ("generation_attempts"."extraction_memory_epoch" IS NULL OR "generation_attempts"."extraction_memory_epoch" >= 0);--> statement-breakpoint
ALTER TABLE "memory_extraction_runs" ADD CONSTRAINT "memory_extraction_runs_dead_letter_publication_shape" CHECK ("memory_extraction_runs"."dead_letter_published_at" IS NULL OR "memory_extraction_runs"."status" = 'dead_letter');--> statement-breakpoint
CREATE FUNCTION fence_generation_extraction_relationship()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.memory_epoch IS DISTINCT FROM NEW.memory_epoch
     OR (OLD.recording_enabled AND NOT NEW.recording_enabled) THEN
    UPDATE generation_attempts SET extraction_memory_epoch = NULL
    WHERE user_id = NEW.user_id AND extraction_memory_epoch IS NOT NULL
      AND assistant_message_id IN (
        SELECT conversation_messages.id FROM conversation_messages
        JOIN conversations ON conversations.id = conversation_messages.conversation_id
        WHERE conversations.user_id = NEW.user_id
          AND conversations.character_id = NEW.character_id
      );
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER memory_relationship_fence_generation_extraction
AFTER UPDATE OF memory_epoch, recording_enabled ON user_character_memory_settings
FOR EACH ROW EXECUTE FUNCTION fence_generation_extraction_relationship();--> statement-breakpoint
CREATE FUNCTION fence_generation_extraction_account()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.banned IS TRUE AND OLD.banned IS DISTINCT FROM TRUE)
     OR (NEW.deletion_pending_at IS NOT NULL AND OLD.deletion_pending_at IS NULL) THEN
    UPDATE generation_attempts SET extraction_memory_epoch = NULL
    WHERE user_id = NEW.id AND extraction_memory_epoch IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER user_fence_generation_extraction
AFTER UPDATE OF banned, deletion_pending_at ON "user"
FOR EACH ROW EXECUTE FUNCTION fence_generation_extraction_account();--> statement-breakpoint
CREATE OR REPLACE FUNCTION cancel_extraction_on_global_recording_disable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.enabled AND NOT NEW.enabled THEN
    UPDATE generation_attempts SET extraction_memory_epoch = NULL
    WHERE extraction_memory_epoch IS NOT NULL;
    UPDATE memory_extraction_runs
    SET status = 'cancelled', next_retry_at = NULL,
        finished_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE status IN ('pending', 'queued', 'running', 'retrying');
    UPDATE memory_extraction_executions SET candidates = NULL
    WHERE candidates IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE FUNCTION preserve_generation_extraction_admission()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.extraction_memory_epoch IS NOT NULL
     AND NEW.extraction_memory_epoch IS DISTINCT FROM OLD.extraction_memory_epoch THEN
    RAISE EXCEPTION 'generation extraction admission cannot be rebased or restored';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER generation_attempts_preserve_extraction_admission
BEFORE UPDATE OF extraction_memory_epoch ON generation_attempts
FOR EACH ROW EXECUTE FUNCTION preserve_generation_extraction_admission();--> statement-breakpoint
CREATE FUNCTION require_extraction_admission()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM generation_attempts
    WHERE id = NEW.generation_attempt_id AND extraction_memory_epoch = NEW.memory_epoch
  ) THEN
    RAISE EXCEPTION 'memory extraction requires matching admission-time epoch';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER memory_extraction_runs_require_admission
BEFORE INSERT ON memory_extraction_runs
FOR EACH ROW EXECUTE FUNCTION require_extraction_admission();--> statement-breakpoint
-- Legacy attempts have no trustworthy admission fence; never infer one at completion.
UPDATE memory_extraction_runs SET status = 'cancelled', next_retry_at = NULL,
  finished_at = clock_timestamp(), updated_at = clock_timestamp()
WHERE status IN ('pending', 'queued', 'running', 'retrying');--> statement-breakpoint
UPDATE memory_extraction_executions SET candidates = NULL WHERE candidates IS NOT NULL;--> statement-breakpoint
-- Existing queue deliveries must also defer terminal forwarding to database state.
DO $$ BEGIN
  IF to_regclass('job.job') IS NOT NULL THEN
    UPDATE job.job SET dead_letter = NULL WHERE name = 'memory-extraction';
  END IF;
END $$;