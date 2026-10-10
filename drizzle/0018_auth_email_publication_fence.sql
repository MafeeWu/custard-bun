CREATE FUNCTION serialize_auth_user_publication()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- SMTP eligibility reads must wait until signup commits or rolls back.
  PERFORM id FROM chat_settings WHERE id = 'global' FOR UPDATE;
  PERFORM id FROM memory_settings WHERE id = 'global' FOR UPDATE;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_serialize_auth_publication BEFORE INSERT ON "user"
FOR EACH ROW EXECUTE FUNCTION serialize_auth_user_publication();