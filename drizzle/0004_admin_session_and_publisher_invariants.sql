ALTER TABLE "character_versions" DROP CONSTRAINT "character_versions_published_by_user_id_fk";
--> statement-breakpoint
CREATE FUNCTION "public"."enforce_session_user_eligibility"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	user_banned boolean;
BEGIN
	-- Hold through session insertion: disabling either waits and deletes it,
	-- or commits first and this authoritative read rejects it.
	SELECT banned INTO user_banned
	FROM "public"."user"
	WHERE id = NEW.user_id
	FOR SHARE;

	IF user_banned IS TRUE THEN
		RAISE EXCEPTION 'cannot create a session for a disabled user'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "session_enforce_user_eligibility"
BEFORE INSERT OR UPDATE OF "user_id" ON "public"."session"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_session_user_eligibility"();
