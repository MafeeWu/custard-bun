CREATE OR REPLACE FUNCTION enforce_session_user_eligibility()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner_id text;
  disabled boolean;
BEGIN
  PERFORM id FROM chat_settings WHERE id = 'global' FOR UPDATE;
  PERFORM id FROM memory_settings WHERE id = 'global' FOR UPDATE;
  FOR owner_id IN
    SELECT DISTINCT id FROM unnest(ARRAY[NEW.user_id, NEW.impersonated_by]) AS owners(id)
    WHERE id IS NOT NULL ORDER BY id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('chat-user:' || owner_id, 0));
    SELECT COALESCE(banned, false) OR deletion_pending_at IS NOT NULL INTO disabled
    FROM "user" WHERE id = owner_id FOR SHARE;
    IF NOT FOUND OR disabled THEN
      RAISE EXCEPTION 'cannot create a session for a disabled user' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_pending_verification_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner record;
  pending boolean;
BEGIN
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
--> statement-breakpoint
DROP TRIGGER user_pending_private_write_guard ON "user";
--> statement-breakpoint
CREATE TRIGGER user_pending_private_write_guard
BEFORE UPDATE OF name, email, email_verified, image, role, banned, ban_reason, ban_expires ON "user"
FOR EACH ROW EXECUTE FUNCTION prevent_pending_auth_user_write();