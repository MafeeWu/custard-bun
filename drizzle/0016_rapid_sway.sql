ALTER TABLE "usage_ledger" DROP CONSTRAINT "usage_ledger_workload_shape_check";--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_workload_shape_check" CHECK ((
        (
          "usage_ledger"."workload_type" = 'chat_generation'
          AND "usage_ledger"."background_operation_id" IS NULL
          AND "usage_ledger"."memory_extraction_run_id" IS NULL
          AND "usage_ledger"."relationship_summary_version_id" IS NULL
        )
        OR
        (
          "usage_ledger"."workload_type" IN ('memory_extraction', 'summary_refresh')
          AND "usage_ledger"."user_id" IS NULL
          AND "usage_ledger"."conversation_id" IS NULL
          AND "usage_ledger"."attempt_id" IS NULL
          AND "usage_ledger"."background_operation_id" IS NULL
          AND "usage_ledger"."memory_extraction_run_id" IS NULL
          AND "usage_ledger"."relationship_summary_version_id" IS NULL
          AND "usage_ledger"."user_request_units" = 0
        )
        OR
        (
          "usage_ledger"."workload_type" = 'memory_extraction'
          AND "usage_ledger"."background_operation_id" IS NOT NULL
          AND "usage_ledger"."user_request_units" = 0
          AND "usage_ledger"."relationship_summary_version_id" IS NULL
        )
        OR
        (
          "usage_ledger"."workload_type" = 'summary_refresh'
          AND "usage_ledger"."background_operation_id" IS NOT NULL
          AND "usage_ledger"."user_request_units" = 0
          AND "usage_ledger"."memory_extraction_run_id" IS NULL
        )
      ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_session_user_eligibility()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  disabled boolean;
BEGIN
  SELECT COALESCE(banned, false) OR deletion_pending_at IS NOT NULL INTO disabled
  FROM "user" WHERE id = NEW.user_id FOR SHARE;
  IF disabled THEN
    RAISE EXCEPTION 'cannot create a session for a disabled user' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER session_enforce_user_eligibility ON session;
--> statement-breakpoint
CREATE TRIGGER session_enforce_user_eligibility BEFORE INSERT OR UPDATE ON session
FOR EACH ROW EXECUTE FUNCTION enforce_session_user_eligibility();
--> statement-breakpoint
CREATE FUNCTION prevent_pending_auth_account_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pending boolean;
BEGIN
  SELECT deletion_pending_at IS NOT NULL INTO pending FROM "user" WHERE id = NEW.user_id FOR SHARE;
  IF pending THEN
    RAISE EXCEPTION 'account access is disabled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_pending_write_guard BEFORE INSERT OR UPDATE ON account
FOR EACH ROW EXECUTE FUNCTION prevent_pending_auth_account_write();
--> statement-breakpoint
CREATE FUNCTION prevent_pending_auth_user_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deletion_pending_at IS NOT NULL THEN
    RAISE EXCEPTION 'account access is disabled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_pending_private_write_guard BEFORE UPDATE OF name, email, email_verified, image ON "user"
FOR EACH ROW EXECUTE FUNCTION prevent_pending_auth_user_write();
--> statement-breakpoint
CREATE FUNCTION prevent_pending_verification_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner record;
BEGIN
  FOR owner IN SELECT deletion_pending_at FROM "user"
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
CREATE TRIGGER verification_pending_write_guard BEFORE INSERT OR UPDATE ON verification
FOR EACH ROW EXECUTE FUNCTION prevent_pending_verification_write();