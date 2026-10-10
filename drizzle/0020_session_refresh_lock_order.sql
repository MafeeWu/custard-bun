CREATE OR REPLACE FUNCTION enforce_session_user_eligibility()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner_id text;
  disabled boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.impersonated_by IS DISTINCT FROM OLD.impersonated_by THEN
      RAISE EXCEPTION 'cannot create a session for a disabled user' USING ERRCODE = '23514';
    END IF;
    -- UPDATE already owns the session row. Taking settings or owner locks here
    -- would invert confirmation's order before DELETE. The row lock serializes
    -- refresh with revocation; immutable relationships cannot introduce an owner.
    FOR owner_id IN
      SELECT DISTINCT id FROM unnest(ARRAY[NEW.user_id, NEW.impersonated_by]) AS owners(id)
      WHERE id IS NOT NULL ORDER BY id
    LOOP
      SELECT COALESCE(banned, false) OR deletion_pending_at IS NOT NULL INTO disabled
      FROM "user" WHERE id = owner_id;
      IF NOT FOUND OR disabled THEN
        RAISE EXCEPTION 'cannot create a session for a disabled user' USING ERRCODE = '23514';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;
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