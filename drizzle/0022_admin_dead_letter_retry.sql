CREATE OR REPLACE FUNCTION enforce_extraction_run_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  admin_restart boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM generation_attempts
      JOIN conversation_messages ON conversation_messages.id = generation_attempts.assistant_message_id
      JOIN conversations ON conversations.id = conversation_messages.conversation_id
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
    admin_restart := OLD.status = 'dead_letter' AND OLD.attempt_count = 5
      AND NEW.status = 'pending' AND NEW.attempt_count = 0
      AND NEW.dead_letter_published_at IS NULL
      AND NEW.finished_at IS NULL AND NEW.next_retry_at IS NULL
      AND NEW.job_id IS NULL AND NEW.error_category IS NULL
      AND NEW.claim_token IS NULL AND NEW.lease_expires_at IS NULL
      AND ROW(NEW.provider_request_ids, NEW.estimated_input_tokens, NEW.input_tokens,
        NEW.output_tokens, NEW.usage_estimated, NEW.started_at)
        IS NOT DISTINCT FROM ROW(OLD.provider_request_ids, OLD.estimated_input_tokens, OLD.input_tokens,
        OLD.output_tokens, OLD.usage_estimated, OLD.started_at);
    IF ROW(NEW.id, NEW.user_id, NEW.character_id, NEW.memory_epoch, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.character_id, OLD.memory_epoch, OLD.created_at) THEN
      RAISE EXCEPTION 'memory extraction run identity is immutable';
    END IF;
    IF (NEW.attempt_count < OLD.attempt_count AND NOT admin_restart)
       OR NEW.attempt_count > 5 THEN
      RAISE EXCEPTION 'memory extraction execution count must be monotonic and at most five';
    END IF;
    IF ROW(NEW.conversation_id, NEW.generation_attempt_id)
       IS DISTINCT FROM ROW(OLD.conversation_id, OLD.generation_attempt_id)
       AND NOT (
         pg_trigger_depth() > 1
         AND OLD.conversation_id IS NOT NULL
         AND NEW.conversation_id IS NULL
         AND NEW.generation_attempt_id IS NULL
         AND (
           (OLD.status IN ('pending', 'queued', 'running', 'retrying')
             AND NEW.status = 'cancelled' AND NEW.finished_at IS NOT NULL)
           OR
           (OLD.status IN ('complete', 'failed', 'dead_letter', 'cancelled')
             AND NEW.status = OLD.status
             AND NEW.finished_at IS NOT DISTINCT FROM OLD.finished_at)
         )
       ) THEN
      RAISE EXCEPTION 'memory extraction source identity is immutable except during conversation deletion';
    END IF;
    IF OLD.status IN ('complete', 'failed', 'dead_letter', 'cancelled')
       AND ROW(NEW.status, NEW.job_id, NEW.attempt_count, NEW.next_retry_at,
         NEW.error_category, NEW.provider_request_ids, NEW.estimated_input_tokens,
         NEW.input_tokens, NEW.output_tokens, NEW.usage_estimated,
         NEW.started_at, NEW.finished_at)
       IS DISTINCT FROM ROW(OLD.status, OLD.job_id, OLD.attempt_count, OLD.next_retry_at,
         OLD.error_category, OLD.provider_request_ids, OLD.estimated_input_tokens,
         OLD.input_tokens, OLD.output_tokens, OLD.usage_estimated,
         OLD.started_at, OLD.finished_at)
       AND NOT admin_restart
       AND NOT (
         OLD.status = 'failed' AND NEW.status = 'pending'
         AND OLD.attempt_count < 5 AND NEW.attempt_count = OLD.attempt_count
         AND NEW.finished_at IS NULL AND NEW.next_retry_at IS NULL
         AND NEW.job_id IS NULL AND NEW.error_category IS NULL
         AND NEW.claim_token IS NULL AND NEW.lease_expires_at IS NULL
         AND ROW(NEW.provider_request_ids, NEW.estimated_input_tokens,
           NEW.input_tokens, NEW.output_tokens, NEW.usage_estimated, NEW.started_at)
           IS NOT DISTINCT FROM ROW(OLD.provider_request_ids, OLD.estimated_input_tokens,
           OLD.input_tokens, OLD.output_tokens, OLD.usage_estimated, OLD.started_at)
       ) THEN
      RAISE EXCEPTION 'terminal memory extraction run is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_extraction_dead_letter_publication()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.dead_letter_published_at IS NOT NULL
     AND NEW.dead_letter_published_at IS DISTINCT FROM OLD.dead_letter_published_at
     AND NOT (OLD.status = 'dead_letter' AND OLD.attempt_count = 5
       AND NEW.status = 'pending' AND NEW.attempt_count = 0
       AND NEW.dead_letter_published_at IS NULL) THEN
    RAISE EXCEPTION 'extraction dead-letter publication receipt is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_summary_run_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  admin_restart boolean;
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
    admin_restart := OLD.status = 'dead_letter' AND OLD.attempt_count = 5
      AND NEW.status = 'pending' AND NEW.attempt_count = 0
      AND NEW.dead_letter_published_at IS NULL
      AND NEW.finished_at IS NULL AND NEW.next_retry_at IS NULL
      AND NEW.job_id IS NULL AND NEW.error_category IS NULL
      AND NEW.claim_token IS NULL AND NEW.lease_expires_at IS NULL
      AND ROW(NEW.provider_request_ids, NEW.estimated_input_tokens, NEW.input_tokens,
        NEW.output_tokens, NEW.usage_estimated, NEW.started_at)
        IS NOT DISTINCT FROM ROW(OLD.provider_request_ids, OLD.estimated_input_tokens, OLD.input_tokens,
        OLD.output_tokens, OLD.usage_estimated, OLD.started_at);
    IF ROW(NEW.id, NEW.user_id, NEW.character_id, NEW.memory_epoch,
      NEW.expected_summary_revision, NEW.based_on_memory_revision, NEW.explicit_regeneration, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.character_id, OLD.memory_epoch,
      OLD.expected_summary_revision, OLD.based_on_memory_revision, OLD.explicit_regeneration, OLD.created_at) THEN
      RAISE EXCEPTION 'relationship summary run identity is immutable';
    END IF;
    IF (NEW.attempt_count < OLD.attempt_count AND NOT admin_restart)
      OR NEW.attempt_count > 5 THEN
      RAISE EXCEPTION 'relationship summary execution count must be monotonic and at most five';
    END IF;
    IF OLD.status IN ('complete', 'failed', 'dead_letter', 'cancelled')
      AND ROW(NEW.status, NEW.job_id, NEW.attempt_count, NEW.next_retry_at,
        NEW.error_category, NEW.provider_request_ids, NEW.estimated_input_tokens,
        NEW.input_tokens, NEW.output_tokens, NEW.usage_estimated, NEW.started_at, NEW.finished_at)
      IS DISTINCT FROM ROW(OLD.status, OLD.job_id, OLD.attempt_count, OLD.next_retry_at,
        OLD.error_category, OLD.provider_request_ids, OLD.estimated_input_tokens,
        OLD.input_tokens, OLD.output_tokens, OLD.usage_estimated, OLD.started_at, OLD.finished_at)
      AND NOT admin_restart
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
      AND NEW.dead_letter_published_at IS DISTINCT FROM OLD.dead_letter_published_at
      AND NOT admin_restart THEN
      RAISE EXCEPTION 'summary dead-letter publication receipt is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
