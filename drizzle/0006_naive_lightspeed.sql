ALTER TABLE "generation_attempts" DROP CONSTRAINT "generation_attempts_client_request_id_unique";--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "generation_attempts" AS attempts
SET "user_id" = conversations."user_id"
FROM "conversation_messages" AS messages
JOIN "conversations"
  ON conversations."id" = messages."conversation_id"
WHERE messages."id" = attempts."assistant_message_id";--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "generation_attempts" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_attempts_user_client_request_unique" ON "generation_attempts" USING btree ("user_id","client_request_id") WHERE "generation_attempts"."client_request_id" IS NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_generation_attempt_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(NEW.user_id, NEW.assistant_message_id, NEW.attempt_number)
     IS DISTINCT FROM ROW(OLD.user_id, OLD.assistant_message_id, OLD.attempt_number) THEN
    RAISE EXCEPTION 'generation attempt identity fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_generation_attempt_user_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM conversation_messages
    JOIN conversations
      ON conversations.id = conversation_messages.conversation_id
    WHERE conversation_messages.id = NEW.assistant_message_id
      AND conversations.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'generation attempt user must own the assistant message conversation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER generation_attempts_validate_user_ownership
BEFORE INSERT OR UPDATE OF user_id, assistant_message_id ON generation_attempts
FOR EACH ROW
EXECUTE FUNCTION enforce_generation_attempt_user_ownership();