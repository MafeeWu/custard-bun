ALTER TABLE "memory_extraction_executions" ADD CONSTRAINT "memory_extraction_executions_receipt_shape" CHECK (
      ("memory_extraction_executions"."settled_at" IS NULL OR ("memory_extraction_executions"."response_at" IS NOT NULL AND "memory_extraction_executions"."candidates" IS NULL))
      AND ("memory_extraction_executions"."candidates" IS NULL OR (JSONB_TYPEOF("memory_extraction_executions"."candidates") = 'array' AND JSONB_ARRAY_LENGTH("memory_extraction_executions"."candidates") <= 20))
    );--> statement-breakpoint
ALTER TABLE "memory_extraction_runs" ADD CONSTRAINT "memory_extraction_runs_attempt_count_limit" CHECK ("memory_extraction_runs"."attempt_count" <= 5);--> statement-breakpoint
CREATE FUNCTION cancel_extraction_on_global_recording_disable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.enabled AND NOT NEW.enabled THEN
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
CREATE TRIGGER memory_settings_cancel_extraction
BEFORE UPDATE OF enabled ON memory_settings
FOR EACH ROW EXECUTE FUNCTION cancel_extraction_on_global_recording_disable();--> statement-breakpoint
CREATE OR REPLACE FUNCTION cancel_conversation_memory_extraction()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE memory_extraction_executions SET candidates = NULL
  WHERE run_id IN (SELECT id FROM memory_extraction_runs WHERE conversation_id = OLD.id);
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
  WHERE conversation_id = OLD.id;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE FUNCTION preserve_extraction_execution_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.run_id, NEW.execution_number, NEW.estimated_input_tokens, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.run_id, OLD.execution_number, OLD.estimated_input_tokens, OLD.created_at) THEN
    RAISE EXCEPTION 'extraction execution identity is immutable';
  END IF;
  IF OLD.response_at IS NOT NULL AND (
    ROW(NEW.model_id, NEW.provider_identity, NEW.estimated_output_tokens, NEW.input_tokens,
      NEW.output_tokens, NEW.latency_ms, NEW.error_category, NEW.retryable, NEW.response_at)
    IS DISTINCT FROM ROW(OLD.model_id, OLD.provider_identity, OLD.estimated_output_tokens, OLD.input_tokens,
      OLD.output_tokens, OLD.latency_ms, OLD.error_category, OLD.retryable, OLD.response_at)
    OR (NEW.candidates IS NOT NULL AND NEW.candidates IS DISTINCT FROM OLD.candidates)
  ) THEN
    RAISE EXCEPTION 'extraction response receipt is immutable except for candidate removal';
  END IF;
  IF OLD.settled_at IS NOT NULL AND NEW.settled_at IS DISTINCT FROM OLD.settled_at THEN
    RAISE EXCEPTION 'extraction execution settlement is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER memory_extraction_executions_preserve_receipt
BEFORE UPDATE ON memory_extraction_executions
FOR EACH ROW EXECUTE FUNCTION preserve_extraction_execution_receipt();