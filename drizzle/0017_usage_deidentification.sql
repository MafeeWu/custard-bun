CREATE OR REPLACE FUNCTION preserve_usage_ledger_accounting()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'usage ledger accounting is immutable';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['user_id', 'conversation_id', 'attempt_id',
      'background_operation_id', 'memory_extraction_run_id', 'relationship_summary_version_id'])
    IS NOT DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['user_id', 'conversation_id', 'attempt_id',
      'background_operation_id', 'memory_extraction_run_id', 'relationship_summary_version_id'])
    AND (NEW.user_id IS NOT DISTINCT FROM OLD.user_id OR NEW.user_id IS NULL)
    AND (NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id OR NEW.conversation_id IS NULL)
    AND (NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id OR NEW.attempt_id IS NULL)
    AND (NEW.background_operation_id IS NOT DISTINCT FROM OLD.background_operation_id OR NEW.background_operation_id IS NULL)
    AND (NEW.memory_extraction_run_id IS NOT DISTINCT FROM OLD.memory_extraction_run_id OR NEW.memory_extraction_run_id IS NULL)
    AND (NEW.relationship_summary_version_id IS NOT DISTINCT FROM OLD.relationship_summary_version_id OR NEW.relationship_summary_version_id IS NULL)
  THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'usage ledger accounting is immutable';
END;
$$;