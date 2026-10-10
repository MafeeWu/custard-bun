CREATE OR REPLACE FUNCTION prevent_pending_verification_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner record;
  pending boolean;
  matched_owner boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.identifier IS DISTINCT FROM OLD.identifier
      OR NEW.value IS DISTINCT FROM OLD.value THEN
      RAISE EXCEPTION 'account access is disabled' USING ERRCODE = '23514';
    END IF;
    -- UPDATE already owns the verification row. Late settings/owner locks
    -- invert final purge's DELETE order. Immutable private identity keeps this
    -- row in the purge inventory; authoritative reads must not acquire locks.
    IF OLD.identifier LIKE 'reset-password:%' THEN
      SELECT deletion_pending_at IS NOT NULL INTO pending
      FROM "user" WHERE id = OLD.value;
      IF NOT FOUND OR pending THEN
        RAISE EXCEPTION 'recovery owner is unavailable' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    FOR owner IN SELECT id, deletion_pending_at FROM "user"
      WHERE strpos(OLD.identifier, id) > 0 OR strpos(OLD.value, id) > 0
        OR strpos(OLD.identifier, email) > 0 OR strpos(OLD.value, email) > 0
      ORDER BY id
    LOOP
      matched_owner := true;
      IF owner.deletion_pending_at IS NOT NULL THEN
        RAISE EXCEPTION 'account access is disabled' USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF NOT matched_owner THEN
      RAISE EXCEPTION 'account access is disabled' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM id FROM chat_settings WHERE id = 'global' FOR UPDATE;
  PERFORM id FROM memory_settings WHERE id = 'global' FOR UPDATE;
  -- Better Auth reset records carry the exact owner ID in value, not identifier.
  IF NEW.identifier LIKE 'reset-password:%' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('chat-user:' || NEW.value, 0));
    SELECT deletion_pending_at IS NOT NULL INTO pending
    FROM "user" WHERE id = NEW.value FOR SHARE;
    IF NOT FOUND OR pending THEN
      RAISE EXCEPTION 'recovery owner is unavailable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  FOR owner IN SELECT id, deletion_pending_at FROM "user"
    WHERE strpos(NEW.identifier, id) > 0 OR strpos(NEW.value, id) > 0
      OR strpos(NEW.identifier, email) > 0 OR strpos(NEW.value, email) > 0
    ORDER BY id FOR SHARE
  LOOP
    IF owner.deletion_pending_at IS NOT NULL THEN
      RAISE EXCEPTION 'account access is disabled' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;