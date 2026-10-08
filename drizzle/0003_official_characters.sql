CREATE TYPE "public"."admin_audit_action" AS ENUM('character.create', 'character.draft.save', 'character.version.publish', 'character.default.change', 'character.archive', 'character.restore', 'user.disable', 'user.restore');--> statement-breakpoint
CREATE TYPE "public"."character_lifecycle" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "admin_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"actor_label" text NOT NULL,
	"action" "admin_audit_action" NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"lifecycle" character_lifecycle DEFAULT 'active' NOT NULL,
	"default_version_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" text,
	CONSTRAINT "characters_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "character_drafts" (
	"character_id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"base_version_id" text,
	"display_name" text NOT NULL,
	"avatar_path" text NOT NULL,
	"short_description" text NOT NULL,
	"long_description" text NOT NULL,
	"personality_principles" jsonb NOT NULL,
	"speaking_style" text NOT NULL,
	"response_rhythm" text NOT NULL,
	"relationship_boundaries" jsonb NOT NULL,
	"opening_message" text NOT NULL,
	"example_conversations" jsonb NOT NULL,
	"generation_parameters" jsonb NOT NULL,
	"safety_additions" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"character_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"display_name" text NOT NULL,
	"avatar_path" text NOT NULL,
	"short_description" text NOT NULL,
	"long_description" text NOT NULL,
	"personality_principles" jsonb NOT NULL,
	"speaking_style" text NOT NULL,
	"response_rhythm" text NOT NULL,
	"relationship_boundaries" jsonb NOT NULL,
	"opening_message" text NOT NULL,
	"example_conversations" jsonb NOT NULL,
	"generation_parameters" jsonb NOT NULL,
	"safety_additions" jsonb NOT NULL,
	"content_digest" varchar(64) NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "character_versions_character_id_version_number_unique" UNIQUE("character_id","version_number"),
	CONSTRAINT "character_versions_character_id_id_unique" UNIQUE("character_id","id")
);
--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_default_version_id_character_versions_id_fk" FOREIGN KEY ("default_version_id") REFERENCES "public"."character_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_archived_by_user_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD CONSTRAINT "character_drafts_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD CONSTRAINT "character_drafts_base_version_id_character_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."character_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD CONSTRAINT "character_drafts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_versions" ADD CONSTRAINT "character_versions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_versions" ADD CONSTRAINT "character_versions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION "public"."prevent_character_version_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'published character versions are immutable';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."prevent_character_slug_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.slug IS DISTINCT FROM OLD.slug THEN
		RAISE EXCEPTION 'character slug is immutable';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."enforce_character_default_version_ownership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.default_version_id IS NULL THEN
		RETURN NEW;
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM "character_versions"
		WHERE "id" = NEW.default_version_id
			AND "character_id" = NEW.id
	) THEN
		RAISE EXCEPTION 'default version must belong to the same character';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "character_versions_prevent_update"
BEFORE UPDATE ON "character_versions"
FOR EACH ROW
EXECUTE FUNCTION "public"."prevent_character_version_mutation"();--> statement-breakpoint
CREATE TRIGGER "character_versions_prevent_delete"
BEFORE DELETE ON "character_versions"
FOR EACH ROW
EXECUTE FUNCTION "public"."prevent_character_version_mutation"();--> statement-breakpoint
CREATE TRIGGER "characters_prevent_slug_change"
BEFORE UPDATE ON "characters"
FOR EACH ROW
EXECUTE FUNCTION "public"."prevent_character_slug_change"();--> statement-breakpoint
CREATE TRIGGER "characters_enforce_default_version_ownership"
BEFORE INSERT OR UPDATE OF "default_version_id" ON "characters"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_character_default_version_ownership"();