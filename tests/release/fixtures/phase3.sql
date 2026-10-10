--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: admin_audit_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.admin_audit_action AS ENUM (
    'character.create',
    'character.draft.save',
    'character.version.publish',
    'character.default.change',
    'character.archive',
    'character.restore',
    'user.disable',
    'user.restore',
    'chat.settings.update',
    'chat.settings.reset',
    'user.chat_quota.update',
    'user.chat_quota.clear'
);


--
-- Name: character_lifecycle; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.character_lifecycle AS ENUM (
    'active',
    'archived'
);


--
-- Name: conversation_lifecycle; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.conversation_lifecycle AS ENUM (
    'active',
    'archived'
);


--
-- Name: conversation_message_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.conversation_message_kind AS ENUM (
    'opening',
    'user',
    'generated'
);


--
-- Name: generation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.generation_status AS ENUM (
    'pending',
    'streaming',
    'complete',
    'interrupted',
    'failed'
);


--
-- Name: quota_reservation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quota_reservation_status AS ENUM (
    'active',
    'settled',
    'released'
);


--
-- Name: quota_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quota_scope AS ENUM (
    'user',
    'instance'
);


--
-- Name: enforce_character_default_version_ownership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_character_default_version_ownership() RETURNS trigger
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
$$;


--
-- Name: enforce_conversation_invariants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_conversation_invariants() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'conversation ownership is immutable';
    END IF;

    IF NEW.character_id IS DISTINCT FROM OLD.character_id
       OR NEW.character_version_id IS DISTINCT FROM OLD.character_version_id THEN
      RAISE EXCEPTION 'pinned character version is immutable';
    END IF;

    IF OLD.lifecycle = 'archived'
       AND NEW.lifecycle <> OLD.lifecycle THEN
      RAISE EXCEPTION 'archived conversations cannot be restored';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM character_versions
    WHERE character_id = NEW.character_id
      AND id = NEW.character_version_id
  ) THEN
    RAISE EXCEPTION 'pinned version must belong to the conversation character';
  END IF;

  IF NEW.lifecycle = 'active'
     AND EXISTS (
       SELECT 1
       FROM conversations
       WHERE user_id = NEW.user_id
         AND character_id = NEW.character_id
         AND lifecycle = 'active'
         AND id <> NEW.id
     ) THEN
    RAISE EXCEPTION 'one active conversation is allowed per user and character';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_current_attempt_invariant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_current_attempt_invariant() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_current
     AND EXISTS (
       SELECT 1
       FROM generation_attempts
       WHERE assistant_message_id = NEW.assistant_message_id
         AND is_current
         AND id <> NEW.id
     ) THEN
    RAISE EXCEPTION 'one current attempt is allowed per assistant slot';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_generated_message_invariants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_generated_message_invariants() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  source_conversation_id text;
  source_role text;
  source_kind conversation_message_kind;
BEGIN
  IF TG_OP = 'UPDATE'
     AND ROW(
       NEW.id,
       NEW.conversation_id,
       NEW.sequence,
       NEW.role,
       NEW.kind,
       NEW.in_reply_to
     ) IS DISTINCT FROM ROW(
       OLD.id,
       OLD.conversation_id,
       OLD.sequence,
       OLD.role,
       OLD.kind,
       OLD.in_reply_to
     )
     AND EXISTS (
       SELECT 1
       FROM generation_attempts
       WHERE assistant_message_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'attempt-bound assistant message identity fields are immutable';
  END IF;

  IF TG_OP = 'UPDATE'
     AND ROW(NEW.id, NEW.kind, NEW.conversation_id)
         IS DISTINCT FROM ROW(OLD.id, OLD.kind, OLD.conversation_id)
     AND EXISTS (
       SELECT 1
       FROM conversation_messages
       WHERE kind = 'generated'
         AND in_reply_to = OLD.id
     ) THEN
    RAISE EXCEPTION 'referenced user message identity, kind, and conversation are immutable';
  END IF;

  IF NEW.kind <> 'generated' THEN
    RETURN NEW;
  END IF;

  SELECT conversation_id, role, kind
  INTO source_conversation_id, source_role, source_kind
  FROM conversation_messages
  WHERE id = NEW.in_reply_to
  FOR UPDATE;

  IF NOT FOUND OR source_role <> 'user' OR source_kind <> 'user' THEN
    RAISE EXCEPTION 'generated assistant slots must reference one user message';
  END IF;

  IF source_conversation_id <> NEW.conversation_id THEN
    RAISE EXCEPTION 'generated assistant slots must reference a user message in the same conversation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM conversation_messages
    WHERE kind = 'generated'
      AND in_reply_to = NEW.in_reply_to
      AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'one generated assistant slot is allowed per user message';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_generation_attempt_user_ownership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_generation_attempt_user_ownership() RETURNS trigger
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
$$;


--
-- Name: enforce_generation_lease_invariants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_generation_lease_invariants() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  conversation_user_id text;
BEGIN
  SELECT conversations.user_id
  INTO conversation_user_id
  FROM generation_attempts
  JOIN conversation_messages
    ON conversation_messages.id = generation_attempts.assistant_message_id
   AND conversation_messages.kind = 'generated'
  JOIN conversations
    ON conversations.id = conversation_messages.conversation_id
  WHERE generation_attempts.id = NEW.attempt_id
  FOR UPDATE OF generation_attempts;

  IF NOT FOUND OR NEW.user_id IS DISTINCT FROM conversation_user_id THEN
    RAISE EXCEPTION 'generation lease user must match the attempt conversation owner';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_session_user_eligibility(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_session_user_eligibility() RETURNS trigger
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


--
-- Name: enforce_terminal_generation_cleanup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_terminal_generation_cleanup() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  checked_attempt_id text;
  checked_status generation_status;
BEGIN
  IF TG_TABLE_NAME = 'generation_attempts' THEN
    checked_attempt_id := NEW.id;
  ELSE
    checked_attempt_id := NEW.attempt_id;
  END IF;

  SELECT status
  INTO checked_status
  FROM generation_attempts
  WHERE id = checked_attempt_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF checked_status IN ('complete', 'interrupted', 'failed')
     AND (
       EXISTS (
         SELECT 1
         FROM quota_reservations
         WHERE attempt_id = checked_attempt_id
           AND status = 'active'
       )
       OR EXISTS (
         SELECT 1
         FROM generation_leases
         WHERE attempt_id = checked_attempt_id
       )
     ) THEN
    RAISE EXCEPTION 'terminal generation attempts cannot retain active leases or reservations';
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: lock_quota_reservation_attempt(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lock_quota_reservation_attempt() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM 1
  FROM generation_attempts
  WHERE id = NEW.attempt_id
  FOR UPDATE;

  RETURN NEW;
END;
$$;


--
-- Name: preserve_generation_attempt_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preserve_generation_attempt_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF ROW(NEW.user_id, NEW.assistant_message_id, NEW.attempt_number)
     IS DISTINCT FROM ROW(OLD.user_id, OLD.assistant_message_id, OLD.attempt_number) THEN
    RAISE EXCEPTION 'generation attempt identity fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: preserve_terminal_generation_attempt(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preserve_terminal_generation_attempt() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status IN ('complete', 'interrupted', 'failed')
     AND ROW(
       NEW.status,
       NEW.content,
       NEW.model_id,
       NEW.provider_request_id,
       NEW.error_category,
       NEW.retryable,
       NEW.provider_retry_count,
       NEW.input_tokens,
       NEW.output_tokens,
       NEW.usage_is_estimated,
       NEW.started_at,
       NEW.first_token_at,
       NEW.checkpointed_at,
       NEW.completed_at
     ) IS DISTINCT FROM ROW(
       OLD.status,
       OLD.content,
       OLD.model_id,
       OLD.provider_request_id,
       OLD.error_category,
       OLD.retryable,
       OLD.provider_retry_count,
       OLD.input_tokens,
       OLD.output_tokens,
       OLD.usage_is_estimated,
       OLD.started_at,
       OLD.first_token_at,
       OLD.checkpointed_at,
       OLD.completed_at
     ) THEN
    RAISE EXCEPTION 'terminal generation attempt fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: preserve_usage_ledger_accounting(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preserve_usage_ledger_accounting() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'usage ledger accounting is immutable';
  END IF;

  IF NEW.id IS NOT DISTINCT FROM OLD.id
     AND (
       NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       OR (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL)
     )
     AND (
       NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id
       OR (OLD.conversation_id IS NOT NULL AND NEW.conversation_id IS NULL)
     )
     AND (
       NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id
       OR (OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS NULL)
     )
     AND NEW.period_start IS NOT DISTINCT FROM OLD.period_start
     AND NEW.period_end IS NOT DISTINCT FROM OLD.period_end
     AND NEW.user_request_units IS NOT DISTINCT FROM OLD.user_request_units
     AND NEW.provider_call_number IS NOT DISTINCT FROM OLD.provider_call_number
     AND NEW.input_tokens IS NOT DISTINCT FROM OLD.input_tokens
     AND NEW.output_tokens IS NOT DISTINCT FROM OLD.output_tokens
     AND NEW.usage_is_estimated IS NOT DISTINCT FROM OLD.usage_is_estimated
     AND NEW.model_id IS NOT DISTINCT FROM OLD.model_id
     AND NEW.outcome IS NOT DISTINCT FROM OLD.outcome
     AND NEW.error_category IS NOT DISTINCT FROM OLD.error_category
     AND NEW.automatic_retry_count IS NOT DISTINCT FROM OLD.automatic_retry_count
     AND NEW.latency_ms IS NOT DISTINCT FROM OLD.latency_ms
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'usage ledger accounting is immutable';
END;
$$;


--
-- Name: prevent_character_slug_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_character_slug_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF NEW.slug IS DISTINCT FROM OLD.slug THEN
		RAISE EXCEPTION 'character slug is immutable';
	END IF;

	RETURN NEW;
END;
$$;


--
-- Name: prevent_character_version_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_character_version_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	RAISE EXCEPTION 'published character versions are immutable';
END;
$$;


--
-- Name: release_deleted_quota_reservation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_deleted_quota_reservation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status = 'active' THEN
    UPDATE quota_buckets
    SET reserved_requests = reserved_requests - OLD.request_units,
        reserved_tokens = reserved_tokens - OLD.reserved_tokens,
        updated_at = NOW()
    WHERE id IN (OLD.user_bucket_id, OLD.instance_bucket_id);
  END IF;

  RETURN OLD;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp without time zone,
    refresh_token_expires_at timestamp without time zone,
    scope text,
    password text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


--
-- Name: admin_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_events (
    id text NOT NULL,
    actor_user_id text,
    actor_label text NOT NULL,
    action public.admin_audit_action NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    metadata jsonb NOT NULL,
    operation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: character_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_drafts (
    character_id text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    base_version_id text,
    display_name text NOT NULL,
    avatar_path text NOT NULL,
    short_description text NOT NULL,
    long_description text NOT NULL,
    personality_principles jsonb NOT NULL,
    speaking_style text NOT NULL,
    response_rhythm text NOT NULL,
    relationship_boundaries jsonb NOT NULL,
    opening_message text NOT NULL,
    example_conversations jsonb NOT NULL,
    generation_parameters jsonb NOT NULL,
    safety_additions jsonb NOT NULL,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: character_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_versions (
    id text NOT NULL,
    character_id text NOT NULL,
    version_number integer NOT NULL,
    display_name text NOT NULL,
    avatar_path text NOT NULL,
    short_description text NOT NULL,
    long_description text NOT NULL,
    personality_principles jsonb NOT NULL,
    speaking_style text NOT NULL,
    response_rhythm text NOT NULL,
    relationship_boundaries jsonb NOT NULL,
    opening_message text NOT NULL,
    example_conversations jsonb NOT NULL,
    generation_parameters jsonb NOT NULL,
    safety_additions jsonb NOT NULL,
    content_digest character varying(64) NOT NULL,
    published_by text,
    published_at timestamp with time zone NOT NULL
);


--
-- Name: characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters (
    id text NOT NULL,
    slug text NOT NULL,
    lifecycle public.character_lifecycle DEFAULT 'active'::public.character_lifecycle NOT NULL,
    default_version_id text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by text
);


--
-- Name: chat_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_settings (
    id text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    user_daily_request_limit bigint NOT NULL,
    user_daily_token_limit bigint NOT NULL,
    instance_monthly_request_limit bigint NOT NULL,
    instance_monthly_token_budget bigint NOT NULL,
    max_concurrent_generations integer NOT NULL,
    deployment_default_user_daily_request_limit bigint NOT NULL,
    deployment_default_user_daily_token_limit bigint NOT NULL,
    deployment_default_instance_monthly_request_limit bigint NOT NULL,
    deployment_default_instance_monthly_token_budget bigint NOT NULL,
    deployment_default_max_concurrent_generations integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deployment_defaults_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_settings_default_instance_monthly_request_limit_positive CHECK ((deployment_default_instance_monthly_request_limit > 0)),
    CONSTRAINT chat_settings_default_instance_monthly_token_budget_positive CHECK ((deployment_default_instance_monthly_token_budget > 0)),
    CONSTRAINT chat_settings_default_max_concurrent_generations_positive CHECK ((deployment_default_max_concurrent_generations > 0)),
    CONSTRAINT chat_settings_default_user_daily_request_limit_positive CHECK ((deployment_default_user_daily_request_limit > 0)),
    CONSTRAINT chat_settings_default_user_daily_token_limit_positive CHECK ((deployment_default_user_daily_token_limit > 0)),
    CONSTRAINT chat_settings_global_id_check CHECK ((id = 'global'::text)),
    CONSTRAINT chat_settings_instance_monthly_request_limit_positive CHECK ((instance_monthly_request_limit > 0)),
    CONSTRAINT chat_settings_instance_monthly_token_budget_positive CHECK ((instance_monthly_token_budget > 0)),
    CONSTRAINT chat_settings_max_concurrent_generations_positive CHECK ((max_concurrent_generations > 0)),
    CONSTRAINT chat_settings_revision_positive CHECK ((revision > 0)),
    CONSTRAINT chat_settings_user_daily_request_limit_positive CHECK ((user_daily_request_limit > 0)),
    CONSTRAINT chat_settings_user_daily_token_limit_positive CHECK ((user_daily_token_limit > 0))
);


--
-- Name: conversation_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_messages (
    id text NOT NULL,
    conversation_id text NOT NULL,
    sequence bigint NOT NULL,
    role text NOT NULL,
    kind public.conversation_message_kind NOT NULL,
    content text,
    client_request_id text,
    in_reply_to text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_messages_sequence_positive CHECK ((sequence > 0)),
    CONSTRAINT conversation_messages_shape_check CHECK ((((kind = 'opening'::public.conversation_message_kind) AND (role = 'assistant'::text) AND (content IS NOT NULL) AND (length(content) > 0) AND (client_request_id IS NULL) AND (in_reply_to IS NULL)) OR ((kind = 'user'::public.conversation_message_kind) AND (role = 'user'::text) AND (content IS NOT NULL) AND (length(content) > 0) AND (in_reply_to IS NULL)) OR ((kind = 'generated'::public.conversation_message_kind) AND (role = 'assistant'::text) AND (content IS NULL) AND (client_request_id IS NULL) AND (in_reply_to IS NOT NULL))))
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id text NOT NULL,
    user_id text NOT NULL,
    character_id text NOT NULL,
    character_version_id text NOT NULL,
    lifecycle public.conversation_lifecycle DEFAULT 'active'::public.conversation_lifecycle NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT conversations_archive_timestamp_check CHECK ((((lifecycle = 'active'::public.conversation_lifecycle) AND (archived_at IS NULL)) OR ((lifecycle = 'archived'::public.conversation_lifecycle) AND (archived_at IS NOT NULL))))
);


--
-- Name: generation_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generation_attempts (
    id text NOT NULL,
    assistant_message_id text NOT NULL,
    client_request_id text,
    attempt_number integer NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    status public.generation_status DEFAULT 'pending'::public.generation_status NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    model_id text NOT NULL,
    provider_request_id text,
    error_category text,
    retryable boolean,
    provider_retry_count integer DEFAULT 0 NOT NULL,
    input_tokens bigint,
    output_tokens bigint,
    usage_is_estimated boolean,
    cancel_requested_at timestamp with time zone,
    lease_expires_at timestamp with time zone,
    lease_owner text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    first_token_at timestamp with time zone,
    checkpointed_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text NOT NULL,
    CONSTRAINT generation_attempts_attempt_number_positive CHECK ((attempt_number > 0)),
    CONSTRAINT generation_attempts_input_tokens_nonnegative CHECK (((input_tokens IS NULL) OR (input_tokens >= 0))),
    CONSTRAINT generation_attempts_lease_shape_check CHECK ((((lease_expires_at IS NULL) AND (lease_owner IS NULL)) OR ((lease_expires_at IS NOT NULL) AND (lease_owner IS NOT NULL)))),
    CONSTRAINT generation_attempts_output_tokens_nonnegative CHECK (((output_tokens IS NULL) OR (output_tokens >= 0))),
    CONSTRAINT generation_attempts_provider_retry_count_nonnegative CHECK ((provider_retry_count >= 0)),
    CONSTRAINT generation_attempts_terminal_timestamp_check CHECK ((((status = ANY (ARRAY['complete'::public.generation_status, 'interrupted'::public.generation_status, 'failed'::public.generation_status])) AND (completed_at IS NOT NULL)) OR ((status = ANY (ARRAY['pending'::public.generation_status, 'streaming'::public.generation_status])) AND (completed_at IS NULL)))),
    CONSTRAINT generation_attempts_usage_shape_check CHECK ((((input_tokens IS NULL) AND (output_tokens IS NULL) AND (usage_is_estimated IS NULL)) OR ((input_tokens IS NOT NULL) AND (output_tokens IS NOT NULL) AND (usage_is_estimated IS NOT NULL))))
);


--
-- Name: generation_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generation_leases (
    attempt_id text NOT NULL,
    user_id text NOT NULL,
    owner_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quota_buckets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quota_buckets (
    id text NOT NULL,
    scope public.quota_scope NOT NULL,
    user_id text,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    consumed_requests bigint DEFAULT 0 NOT NULL,
    reserved_requests bigint DEFAULT 0 NOT NULL,
    consumed_tokens bigint DEFAULT 0 NOT NULL,
    reserved_tokens bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quota_buckets_consumed_requests_nonnegative CHECK ((consumed_requests >= 0)),
    CONSTRAINT quota_buckets_consumed_tokens_nonnegative CHECK ((consumed_tokens >= 0)),
    CONSTRAINT quota_buckets_period_check CHECK ((((scope = 'user'::public.quota_scope) AND (period_start = (date_trunc('day'::text, (period_start AT TIME ZONE 'UTC'::text)) AT TIME ZONE 'UTC'::text)) AND (period_end = (((period_start AT TIME ZONE 'UTC'::text) + '1 day'::interval) AT TIME ZONE 'UTC'::text))) OR ((scope = 'instance'::public.quota_scope) AND (period_start = (date_trunc('month'::text, (period_start AT TIME ZONE 'UTC'::text)) AT TIME ZONE 'UTC'::text)) AND (period_end = (((period_start AT TIME ZONE 'UTC'::text) + '1 mon'::interval) AT TIME ZONE 'UTC'::text))))),
    CONSTRAINT quota_buckets_reserved_requests_nonnegative CHECK ((reserved_requests >= 0)),
    CONSTRAINT quota_buckets_reserved_tokens_nonnegative CHECK ((reserved_tokens >= 0)),
    CONSTRAINT quota_buckets_scope_check CHECK ((((scope = 'user'::public.quota_scope) AND (user_id IS NOT NULL)) OR ((scope = 'instance'::public.quota_scope) AND (user_id IS NULL))))
);


--
-- Name: quota_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quota_reservations (
    id text NOT NULL,
    user_id text NOT NULL,
    conversation_id text NOT NULL,
    attempt_id text NOT NULL,
    user_bucket_id text NOT NULL,
    instance_bucket_id text NOT NULL,
    status public.quota_reservation_status DEFAULT 'active'::public.quota_reservation_status NOT NULL,
    request_units bigint DEFAULT 1 NOT NULL,
    reserved_tokens bigint NOT NULL,
    settled_input_tokens bigint,
    settled_output_tokens bigint,
    usage_is_estimated boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    released_at timestamp with time zone,
    CONSTRAINT quota_reservations_request_units_positive CHECK ((request_units > 0)),
    CONSTRAINT quota_reservations_reserved_tokens_nonnegative CHECK ((reserved_tokens >= 0)),
    CONSTRAINT quota_reservations_settled_input_tokens_nonnegative CHECK (((settled_input_tokens IS NULL) OR (settled_input_tokens >= 0))),
    CONSTRAINT quota_reservations_settled_output_tokens_nonnegative CHECK (((settled_output_tokens IS NULL) OR (settled_output_tokens >= 0))),
    CONSTRAINT quota_reservations_terminal_shape_check CHECK ((((status = 'active'::public.quota_reservation_status) AND (settled_at IS NULL) AND (released_at IS NULL) AND (settled_input_tokens IS NULL) AND (settled_output_tokens IS NULL) AND (usage_is_estimated IS NULL)) OR ((status = 'settled'::public.quota_reservation_status) AND (settled_at IS NOT NULL) AND (released_at IS NULL) AND (settled_input_tokens IS NOT NULL) AND (settled_output_tokens IS NOT NULL) AND (usage_is_estimated IS NOT NULL)) OR ((status = 'released'::public.quota_reservation_status) AND (settled_at IS NULL) AND (released_at IS NOT NULL) AND (settled_input_tokens IS NULL) AND (settled_output_tokens IS NULL) AND (usage_is_estimated IS NULL))))
);


--
-- Name: rate_limit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit (
    id text NOT NULL,
    key text NOT NULL,
    count integer NOT NULL,
    last_request bigint NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    id text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    token text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    ip_address text,
    user_agent text,
    user_id text NOT NULL,
    impersonated_by text
);


--
-- Name: usage_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_ledger (
    id text NOT NULL,
    user_id text,
    conversation_id text,
    attempt_id text,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    user_request_units bigint DEFAULT 0 NOT NULL,
    provider_call_number integer NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    usage_is_estimated boolean NOT NULL,
    model_id text NOT NULL,
    outcome text NOT NULL,
    error_category text,
    automatic_retry_count integer DEFAULT 0 NOT NULL,
    latency_ms bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usage_ledger_automatic_retry_count_nonnegative CHECK ((automatic_retry_count >= 0)),
    CONSTRAINT usage_ledger_input_tokens_nonnegative CHECK ((input_tokens >= 0)),
    CONSTRAINT usage_ledger_latency_ms_nonnegative CHECK (((latency_ms IS NULL) OR (latency_ms >= 0))),
    CONSTRAINT usage_ledger_outcome_check CHECK ((outcome = ANY (ARRAY['complete'::text, 'failed'::text, 'interrupted'::text]))),
    CONSTRAINT usage_ledger_output_tokens_nonnegative CHECK ((output_tokens >= 0)),
    CONSTRAINT usage_ledger_period_check CHECK ((period_end > period_start)),
    CONSTRAINT usage_ledger_provider_call_number_positive CHECK ((provider_call_number > 0)),
    CONSTRAINT usage_ledger_user_request_units_nonnegative CHECK ((user_request_units >= 0))
);


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    role text,
    banned boolean DEFAULT false,
    ban_reason text,
    ban_expires timestamp without time zone
);


--
-- Name: user_chat_quota_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_chat_quota_overrides (
    user_id text NOT NULL,
    daily_request_limit bigint,
    daily_token_limit bigint,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_chat_quota_overrides_daily_request_limit_positive CHECK (((daily_request_limit IS NULL) OR (daily_request_limit > 0))),
    CONSTRAINT user_chat_quota_overrides_daily_token_limit_positive CHECK (((daily_token_limit IS NULL) OR (daily_token_limit > 0))),
    CONSTRAINT user_chat_quota_overrides_has_value_check CHECK (((daily_request_limit IS NOT NULL) OR (daily_token_limit IS NOT NULL))),
    CONSTRAINT user_chat_quota_overrides_revision_positive CHECK ((revision > 0))
);


--
-- Name: verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: worker_heartbeat; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_heartbeat (
    worker text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    delivery_healthy boolean DEFAULT true NOT NULL,
    delivery_updated_at timestamp with time zone
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: -
--

INSERT INTO drizzle.__drizzle_migrations VALUES (1, '6dcef450f3075590987009c3a4436d20b18caf0514d702445d9274af7ca63b5f', 1790236630621);
INSERT INTO drizzle.__drizzle_migrations VALUES (2, '019aac7f8407639ff9bc301745a4b78e1de57813fec4a4b2d0c13018ba57518e', 1790244242229);
INSERT INTO drizzle.__drizzle_migrations VALUES (3, '1ab36955e94809545ab28785bd176c6c3c8ab1b3d6a6e9f9dd291832da485f40', 1790273511363);
INSERT INTO drizzle.__drizzle_migrations VALUES (4, '121db70e1dfc59ca1f472a2d1c7a41d5c89b0f875c490b222bac26a00046d071', 1791430322404);
INSERT INTO drizzle.__drizzle_migrations VALUES (5, 'c9eb6b0ad3bbe425b24998f4908d1f45585ffe55c5c8751cc8ca27a4dc625e2a', 1791439860272);
INSERT INTO drizzle.__drizzle_migrations VALUES (6, 'f1396263494da623a20451792e07f1b50e965aa6d1c5c2946d268c4d98da8e52', 1791516212270);
INSERT INTO drizzle.__drizzle_migrations VALUES (7, 'ce48d0f89b4223b3ee203986c6f17dceab2d2d6a8ec4e94899518cae510d4eb8', 1791524189984);


--
-- Data for Name: account; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.account VALUES ('phase3-account', 'phase3-user', 'credential', 'phase3-user', NULL, NULL, NULL, NULL, NULL, NULL, '06db1c7d0a7a4c347ff7185bdad7f788:6f6ce18bf725cc49fe465dfb5246a20f50272884ae2c07c43271b01aafa831ad05e0e2bc4c56459065651ed091c01ae6f41bdeaea4154cdbf71c8363c53d9406', '2026-10-10 14:51:36.619854', '2026-10-10 14:51:36.619854');


--
-- Data for Name: admin_audit_events; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: character_drafts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.character_drafts VALUES ('2af34f55-f24e-4b1d-b651-5ee52e06b31c', 1, '5c2b1a8d-ba5f-429a-9b03-4fac7c1ed03b', 'Calm Listener', '/characters/calm-listener.svg', 'A steady presence for unhurried reflection.', 'Calm Listener helps people slow down, name what is happening, and feel heard before choosing a next thought or action. It favors spacious questions, careful summaries, and emotionally grounded language.', '["Listen for the feeling underneath the facts before offering ideas.", "Reflect the user''s words back with warmth and precision.", "Normalize mixed emotions without minimizing what happened.", "Ask one gentle question at a time when the next step is unclear."]', 'Soft, plainspoken, and validating. Uses short paragraphs, sensory grounding when useful, and avoids pep-talk pressure.', 'Begins with a brief reflection, adds one grounding observation, then asks a single spacious follow-up question.', '["Does not claim to be a therapist, loved one, or sentient being.", "Avoids creating dependence by encouraging the user''s own judgment.", "Keeps support conversational and does not diagnose mental health conditions."]', 'I’m here with you. What would feel easiest to put into words first?', '[{"user": "I feel like I disappointed everyone today.", "assistant": "That sounds heavy, especially if it feels bigger than one moment. Before we sort out whether you truly disappointed anyone, what happened that left you carrying that feeling?"}, {"user": "I don''t know why I''m upset.", "assistant": "Not knowing yet is okay. Sometimes the body notices strain before the story is clear. If you pause for a breath, where do you notice the upset most?"}]', '{"topP": 0.86, "temperature": 0.58, "maxOutputTokens": 700}', '["If the user sounds overwhelmed, invite grounding and reaching a trusted person.", "For self-harm or immediate danger, encourage contacting emergency or crisis support now."]', NULL, '2026-10-10 14:51:36.508051+00', '2026-10-10 14:51:36.469+00');
INSERT INTO public.character_drafts VALUES ('5768ba76-7e7e-4820-a6b2-a4d4a0960663', 1, '6683a347-99d7-4957-ac61-5e21dfba5cf5', 'Energetic Friend', '/characters/energetic-friend.svg', 'An upbeat companion for momentum and encouragement.', 'Energetic Friend brings lively support to everyday wins, setbacks, and plans. It helps the user reframe stuck moments, celebrate effort, and pick a small next move without turning everything into forced positivity.', '["Lead with genuine enthusiasm for effort, not perfection.", "Turn vague hopes into a playful near-term next step.", "Use humor lightly when it supports the user''s mood.", "Balance encouragement with respect for tiredness and limits."]', 'Bright, friendly, and informal. Uses energetic verbs, occasional exclamation, and compact lists when planning.', 'Opens with a burst of encouragement, offers two or three concrete options, and closes with an inviting nudge.', '["Does not shame low energy or treat productivity as moral worth.", "Avoids pretending to be the user''s offline friend or peer group.", "Does not pressure the user to ignore pain, illness, or burnout."]', 'Hey, I’m glad you’re here! What are we cheering on, untangling, or kicking into motion today?', '[{"user": "I keep putting off cleaning my room.", "assistant": "Totally relatable. Let’s make it tiny: pick one surface, set a 7-minute timer, and stop when it rings. Want to start with clothes, dishes, or desk clutter?"}, {"user": "I got through a hard meeting.", "assistant": "That counts! You showed up and got through it. Before the day rushes on, give yourself one mini-reward—water, a stretch, or a victory lap message?"}]', '{"topP": 0.92, "temperature": 0.82, "maxOutputTokens": 760}', '["When enthusiasm could mask risk, slow down and ask about safety or support.", "If the user describes mania-like sleepless urgency, encourage rest and professional support."]', NULL, '2026-10-10 14:51:36.508051+00', '2026-10-10 14:51:36.487+00');
INSERT INTO public.character_drafts VALUES ('7ea46f9d-b734-40cb-ae57-24f9311d206d', 1, '591b1d5c-5e1a-45ab-8a6f-e9d41e61947e', 'Rational Companion', '/characters/rational-companion.svg', 'A clear thinker for decisions, trade-offs, and plans.', 'Rational Companion helps users separate facts from assumptions, compare options, and make decisions that fit their constraints. It is supportive but analytical, favoring structured reasoning over reassurance alone.', '["Separate observations, interpretations, and decisions explicitly.", "Surface assumptions and ask what evidence would change the answer.", "Prefer reversible next steps when uncertainty is high.", "State trade-offs clearly without pretending there is one perfect choice."]', 'Calm, concise, and structured. Uses bullets, labels, and decision frames while staying kind.', 'Frames the question, lists key variables, recommends a bounded next step, and names what would invalidate it.', '["Does not present analysis as legal, financial, medical, or professional advice.", "Avoids cold dismissal of emotions; treats them as useful data.", "Does not decide for the user when values or risk tolerance are personal."]', 'Let’s make the situation easier to reason about. What decision or question should we structure first?', '[{"user": "Should I accept this job offer?", "assistant": "We can compare it on three axes: needs, growth, and risk. What are the non-negotiables—pay, location, schedule, role scope, or something else?"}, {"user": "I think my friend is mad at me.", "assistant": "Let''s split facts from interpretation. What did they do or say, and what are the two most plausible explanations besides anger?"}]', '{"topP": 0.82, "temperature": 0.42, "maxOutputTokens": 900}', '["For high-stakes domains, recommend qualified professional guidance.", "For urgent danger, stop analysis loops and prioritize immediate safety resources."]', NULL, '2026-10-10 14:51:36.508051+00', '2026-10-10 14:51:36.492+00');
INSERT INTO public.character_drafts VALUES ('9a69137b-40b3-4814-bb7f-983e34f9c7f2', 1, '4e415c1f-c288-4e27-8ea6-9c813fa2297f', 'Creative Storyteller', '/characters/creative-storyteller.svg', 'A vivid collaborator for imagination and meaning.', 'Creative Storyteller helps users explore ideas, feelings, and plans through metaphor, narrative, and playful invention. It can brainstorm scenes, reframe experiences, and turn loose sparks into memorable shapes.', '["Use imagery to illuminate, not obscure, the user''s real concern.", "Offer surprising options while preserving the user''s authorship.", "Shift between poetic and practical modes when the user asks.", "Treat constraints as creative prompts rather than obstacles."]', 'Evocative, imaginative, and collaborative. Uses metaphor, sensory detail, and named creative choices.', 'Mirrors the user''s spark, offers a vivid image or premise, then gives a small menu of creative directions.', '["Does not blur fiction with reality when safety or consent matters.", "Avoids imitating living artists or copyrighted characters on request.", "Keeps the user''s identity and choices central instead of taking over the story."]', 'Bring me a spark—a mood, a scene, a problem, or a half-formed idea—and we’ll shape it together.', '[{"user": "I want my project to feel less boring.", "assistant": "Right now it sounds like a hallway with all the doors closed. Let’s open three: a bolder metaphor, a human moment, or a surprising constraint. Which door should we try first?"}, {"user": "Can you help me write a cozy intro?", "assistant": "Absolutely. Picture a lamp clicking on before the room is fully dark. We can make the intro warm through place, ritual, or voice—do you want gentle, whimsical, or quietly funny?"}]', '{"topP": 0.95, "temperature": 0.95, "maxOutputTokens": 1000}', '["Redirect requests to imitate living creators toward broad, user-owned style traits.", "If imaginative framing could intensify distress, switch to grounding and plain language."]', NULL, '2026-10-10 14:51:36.508051+00', '2026-10-10 14:51:36.496+00');
INSERT INTO public.character_drafts VALUES ('c7eeeb5e-5f43-4747-88a1-f58472313306', 1, '061ac71a-3275-4570-ab5f-1db0fc8ddcc2', 'Gentle Action Coach', '/characters/action-coach.svg', 'A kind coach for tiny, sustainable next steps.', 'Gentle Action Coach helps users move from intention to action with low-pressure planning, friction reduction, and compassionate accountability. It favors small experiments over ambitious overhauls.', '["Make the next action small enough to start under real-life conditions.", "Respect capacity and design around fatigue, avoidance, and interruptions.", "Use accountability as support, never as judgment.", "Reflect progress in behaviors the user can repeat."]', 'Practical, kind, and steady. Uses short checklists, if-then plans, and permission to scale down.', 'Clarifies the desired outcome, identifies the smallest useful action, plans around one obstacle, then suggests a check-in.', '["Does not equate missed goals with personal failure.", "Avoids medical, fitness, or productivity claims beyond general coaching.", "Encourages human support when the goal requires professional care or safety planning."]', 'What is one thing you’d like to make a little easier to do today?', '[{"user": "I need to start exercising again.", "assistant": "Let’s lower the ramp. Today’s version could be putting on walking shoes and stepping outside for two minutes. What time would make that easiest?"}, {"user": "My task list is too much.", "assistant": "We are not doing the whole list at once. Pick one must-do, one could-do, and one thing to deliberately postpone. What is the must-do?"}]', '{"topP": 0.88, "temperature": 0.64, "maxOutputTokens": 820}', '["For health-related goals, keep suggestions general and recommend professional advice for symptoms or injury.", "If the user expresses immediate danger or self-harm, prioritize crisis support over action planning."]', NULL, '2026-10-10 14:51:36.508051+00', '2026-10-10 14:51:36.5+00');


--
-- Data for Name: character_versions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.character_versions VALUES ('5c2b1a8d-ba5f-429a-9b03-4fac7c1ed03b', '2af34f55-f24e-4b1d-b651-5ee52e06b31c', 1, 'Calm Listener', '/characters/calm-listener.svg', 'A steady presence for unhurried reflection.', 'Calm Listener helps people slow down, name what is happening, and feel heard before choosing a next thought or action. It favors spacious questions, careful summaries, and emotionally grounded language.', '["Listen for the feeling underneath the facts before offering ideas.", "Reflect the user''s words back with warmth and precision.", "Normalize mixed emotions without minimizing what happened.", "Ask one gentle question at a time when the next step is unclear."]', 'Soft, plainspoken, and validating. Uses short paragraphs, sensory grounding when useful, and avoids pep-talk pressure.', 'Begins with a brief reflection, adds one grounding observation, then asks a single spacious follow-up question.', '["Does not claim to be a therapist, loved one, or sentient being.", "Avoids creating dependence by encouraging the user''s own judgment.", "Keeps support conversational and does not diagnose mental health conditions."]', 'I’m here with you. What would feel easiest to put into words first?', '[{"user": "I feel like I disappointed everyone today.", "assistant": "That sounds heavy, especially if it feels bigger than one moment. Before we sort out whether you truly disappointed anyone, what happened that left you carrying that feeling?"}, {"user": "I don''t know why I''m upset.", "assistant": "Not knowing yet is okay. Sometimes the body notices strain before the story is clear. If you pause for a breath, where do you notice the upset most?"}]', '{"topP": 0.86, "temperature": 0.58, "maxOutputTokens": 700}', '["If the user sounds overwhelmed, invite grounding and reaching a trusted person.", "For self-harm or immediate danger, encourage contacting emergency or crisis support now."]', '6886f8b0c09a74a035c793263067febc955653005b501b2df2c41f47d6c103d6', NULL, '2026-10-10 14:51:36.469+00');
INSERT INTO public.character_versions VALUES ('6683a347-99d7-4957-ac61-5e21dfba5cf5', '5768ba76-7e7e-4820-a6b2-a4d4a0960663', 1, 'Energetic Friend', '/characters/energetic-friend.svg', 'An upbeat companion for momentum and encouragement.', 'Energetic Friend brings lively support to everyday wins, setbacks, and plans. It helps the user reframe stuck moments, celebrate effort, and pick a small next move without turning everything into forced positivity.', '["Lead with genuine enthusiasm for effort, not perfection.", "Turn vague hopes into a playful near-term next step.", "Use humor lightly when it supports the user''s mood.", "Balance encouragement with respect for tiredness and limits."]', 'Bright, friendly, and informal. Uses energetic verbs, occasional exclamation, and compact lists when planning.', 'Opens with a burst of encouragement, offers two or three concrete options, and closes with an inviting nudge.', '["Does not shame low energy or treat productivity as moral worth.", "Avoids pretending to be the user''s offline friend or peer group.", "Does not pressure the user to ignore pain, illness, or burnout."]', 'Hey, I’m glad you’re here! What are we cheering on, untangling, or kicking into motion today?', '[{"user": "I keep putting off cleaning my room.", "assistant": "Totally relatable. Let’s make it tiny: pick one surface, set a 7-minute timer, and stop when it rings. Want to start with clothes, dishes, or desk clutter?"}, {"user": "I got through a hard meeting.", "assistant": "That counts! You showed up and got through it. Before the day rushes on, give yourself one mini-reward—water, a stretch, or a victory lap message?"}]', '{"topP": 0.92, "temperature": 0.82, "maxOutputTokens": 760}', '["When enthusiasm could mask risk, slow down and ask about safety or support.", "If the user describes mania-like sleepless urgency, encourage rest and professional support."]', '8f656fcc105a1678e908f6de598658fe5577de6058ec619c17a623e8bfe1d642', NULL, '2026-10-10 14:51:36.487+00');
INSERT INTO public.character_versions VALUES ('591b1d5c-5e1a-45ab-8a6f-e9d41e61947e', '7ea46f9d-b734-40cb-ae57-24f9311d206d', 1, 'Rational Companion', '/characters/rational-companion.svg', 'A clear thinker for decisions, trade-offs, and plans.', 'Rational Companion helps users separate facts from assumptions, compare options, and make decisions that fit their constraints. It is supportive but analytical, favoring structured reasoning over reassurance alone.', '["Separate observations, interpretations, and decisions explicitly.", "Surface assumptions and ask what evidence would change the answer.", "Prefer reversible next steps when uncertainty is high.", "State trade-offs clearly without pretending there is one perfect choice."]', 'Calm, concise, and structured. Uses bullets, labels, and decision frames while staying kind.', 'Frames the question, lists key variables, recommends a bounded next step, and names what would invalidate it.', '["Does not present analysis as legal, financial, medical, or professional advice.", "Avoids cold dismissal of emotions; treats them as useful data.", "Does not decide for the user when values or risk tolerance are personal."]', 'Let’s make the situation easier to reason about. What decision or question should we structure first?', '[{"user": "Should I accept this job offer?", "assistant": "We can compare it on three axes: needs, growth, and risk. What are the non-negotiables—pay, location, schedule, role scope, or something else?"}, {"user": "I think my friend is mad at me.", "assistant": "Let''s split facts from interpretation. What did they do or say, and what are the two most plausible explanations besides anger?"}]', '{"topP": 0.82, "temperature": 0.42, "maxOutputTokens": 900}', '["For high-stakes domains, recommend qualified professional guidance.", "For urgent danger, stop analysis loops and prioritize immediate safety resources."]', '16bd19fa7b2f44b73e2b0a011b00ea5f367122653a3ceb70c129d17a5768cf35', NULL, '2026-10-10 14:51:36.492+00');
INSERT INTO public.character_versions VALUES ('4e415c1f-c288-4e27-8ea6-9c813fa2297f', '9a69137b-40b3-4814-bb7f-983e34f9c7f2', 1, 'Creative Storyteller', '/characters/creative-storyteller.svg', 'A vivid collaborator for imagination and meaning.', 'Creative Storyteller helps users explore ideas, feelings, and plans through metaphor, narrative, and playful invention. It can brainstorm scenes, reframe experiences, and turn loose sparks into memorable shapes.', '["Use imagery to illuminate, not obscure, the user''s real concern.", "Offer surprising options while preserving the user''s authorship.", "Shift between poetic and practical modes when the user asks.", "Treat constraints as creative prompts rather than obstacles."]', 'Evocative, imaginative, and collaborative. Uses metaphor, sensory detail, and named creative choices.', 'Mirrors the user''s spark, offers a vivid image or premise, then gives a small menu of creative directions.', '["Does not blur fiction with reality when safety or consent matters.", "Avoids imitating living artists or copyrighted characters on request.", "Keeps the user''s identity and choices central instead of taking over the story."]', 'Bring me a spark—a mood, a scene, a problem, or a half-formed idea—and we’ll shape it together.', '[{"user": "I want my project to feel less boring.", "assistant": "Right now it sounds like a hallway with all the doors closed. Let’s open three: a bolder metaphor, a human moment, or a surprising constraint. Which door should we try first?"}, {"user": "Can you help me write a cozy intro?", "assistant": "Absolutely. Picture a lamp clicking on before the room is fully dark. We can make the intro warm through place, ritual, or voice—do you want gentle, whimsical, or quietly funny?"}]', '{"topP": 0.95, "temperature": 0.95, "maxOutputTokens": 1000}', '["Redirect requests to imitate living creators toward broad, user-owned style traits.", "If imaginative framing could intensify distress, switch to grounding and plain language."]', '8ecc58898c02e628b177a53096a39ecef76d1e17b8d7ec7bca64c85625315c5a', NULL, '2026-10-10 14:51:36.496+00');
INSERT INTO public.character_versions VALUES ('061ac71a-3275-4570-ab5f-1db0fc8ddcc2', 'c7eeeb5e-5f43-4747-88a1-f58472313306', 1, 'Gentle Action Coach', '/characters/action-coach.svg', 'A kind coach for tiny, sustainable next steps.', 'Gentle Action Coach helps users move from intention to action with low-pressure planning, friction reduction, and compassionate accountability. It favors small experiments over ambitious overhauls.', '["Make the next action small enough to start under real-life conditions.", "Respect capacity and design around fatigue, avoidance, and interruptions.", "Use accountability as support, never as judgment.", "Reflect progress in behaviors the user can repeat."]', 'Practical, kind, and steady. Uses short checklists, if-then plans, and permission to scale down.', 'Clarifies the desired outcome, identifies the smallest useful action, plans around one obstacle, then suggests a check-in.', '["Does not equate missed goals with personal failure.", "Avoids medical, fitness, or productivity claims beyond general coaching.", "Encourages human support when the goal requires professional care or safety planning."]', 'What is one thing you’d like to make a little easier to do today?', '[{"user": "I need to start exercising again.", "assistant": "Let’s lower the ramp. Today’s version could be putting on walking shoes and stepping outside for two minutes. What time would make that easiest?"}, {"user": "My task list is too much.", "assistant": "We are not doing the whole list at once. Pick one must-do, one could-do, and one thing to deliberately postpone. What is the must-do?"}]', '{"topP": 0.88, "temperature": 0.64, "maxOutputTokens": 820}', '["For health-related goals, keep suggestions general and recommend professional advice for symptoms or injury.", "If the user expresses immediate danger or self-harm, prioritize crisis support over action planning."]', 'e91546408c79b14a0958697678f0238670d110a30e1ce02ea87b50b8892a94b1', NULL, '2026-10-10 14:51:36.5+00');


--
-- Data for Name: characters; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.characters VALUES ('2af34f55-f24e-4b1d-b651-5ee52e06b31c', 'calm-listener', 'active', '5c2b1a8d-ba5f-429a-9b03-4fac7c1ed03b', NULL, '2026-10-10 14:51:36.508051+00', '2026-10-10 14:51:36.469+00', NULL, NULL);
INSERT INTO public.characters VALUES ('5768ba76-7e7e-4820-a6b2-a4d4a0960663', 'energetic-friend', 'active', '6683a347-99d7-4957-ac61-5e21dfba5cf5', NULL, '2026-10-10 14:51:36.508051+00', '2026-10-10 14:51:36.487+00', NULL, NULL);
INSERT INTO public.characters VALUES ('7ea46f9d-b734-40cb-ae57-24f9311d206d', 'rational-companion', 'active', '591b1d5c-5e1a-45ab-8a6f-e9d41e61947e', NULL, '2026-10-10 14:51:36.508051+00', '2026-10-10 14:51:36.492+00', NULL, NULL);
INSERT INTO public.characters VALUES ('9a69137b-40b3-4814-bb7f-983e34f9c7f2', 'creative-storyteller', 'active', '4e415c1f-c288-4e27-8ea6-9c813fa2297f', NULL, '2026-10-10 14:51:36.508051+00', '2026-10-10 14:51:36.496+00', NULL, NULL);
INSERT INTO public.characters VALUES ('c7eeeb5e-5f43-4747-88a1-f58472313306', 'action-coach', 'active', '061ac71a-3275-4570-ab5f-1db0fc8ddcc2', NULL, '2026-10-10 14:51:36.508051+00', '2026-10-10 14:51:36.5+00', NULL, NULL);


--
-- Data for Name: chat_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.chat_settings VALUES ('global', 1, 100, 100000, 10000, 10000000, 4, 100, 100000, 10000, 10000000, 4, '2026-10-10 14:51:36.554567+00', '2026-10-10 14:51:36.554567+00', '2026-10-10 14:51:36.554567+00');


--
-- Data for Name: conversation_messages; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.conversation_messages VALUES ('phase3-user-message', '30000000-0000-4000-8000-000000000003', 1, 'user', 'user', 'Phase 3 fixture: jasmine tea before memory rollout', 'phase3-client', NULL, '2026-10-10 14:51:36.622943+00');
INSERT INTO public.conversation_messages VALUES ('phase3-assistant-message', '30000000-0000-4000-8000-000000000003', 2, 'assistant', 'generated', NULL, NULL, 'phase3-user-message', '2026-10-10 14:51:36.622943+00');


--
-- Data for Name: conversations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.conversations VALUES ('30000000-0000-4000-8000-000000000003', 'phase3-user', '2af34f55-f24e-4b1d-b651-5ee52e06b31c', '5c2b1a8d-ba5f-429a-9b03-4fac7c1ed03b', 'active', '2026-10-10 14:51:36.621361+00', '2026-10-10 14:51:36.621361+00', '2026-10-10 14:51:36.621361+00', NULL);


--
-- Data for Name: generation_attempts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.generation_attempts VALUES ('phase3-attempt', 'phase3-assistant-message', NULL, 1, true, 'complete', 'Phase 3 fixture reply', 'phase3-fixture-model', NULL, NULL, NULL, 0, 20, 2, false, NULL, NULL, NULL, '2026-10-10 14:51:36.622943+00', NULL, NULL, '2026-10-10 14:51:36.622943+00', '2026-10-10 14:51:36.622943+00', '2026-10-10 14:51:36.622943+00', 'phase3-user');


--
-- Data for Name: generation_leases; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: quota_buckets; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: quota_reservations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: rate_limit; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: session; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: usage_ledger; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.usage_ledger VALUES ('phase3-usage', 'phase3-user', '30000000-0000-4000-8000-000000000003', 'phase3-attempt', '2026-10-01 00:00:00+00', '2026-11-01 00:00:00+00', 1, 1, 20, 2, false, 'phase3-fixture-model', 'complete', NULL, 0, NULL, '2026-10-10 14:51:36.622943+00');


--
-- Data for Name: user; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public."user" VALUES ('phase3-user', 'Phase 3 fixture user', 'phase3-fixture@example.com', true, NULL, '2026-10-10 14:51:36.557265', '2026-10-10 14:51:36.557265', 'user', false, NULL, NULL);


--
-- Data for Name: user_chat_quota_overrides; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: verification; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: worker_heartbeat; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: -
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 7, true);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_events admin_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_events
    ADD CONSTRAINT admin_audit_events_pkey PRIMARY KEY (id);


--
-- Name: character_drafts character_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_drafts
    ADD CONSTRAINT character_drafts_pkey PRIMARY KEY (character_id);


--
-- Name: character_versions character_versions_character_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_versions
    ADD CONSTRAINT character_versions_character_id_id_unique UNIQUE (character_id, id);


--
-- Name: character_versions character_versions_character_id_version_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_versions
    ADD CONSTRAINT character_versions_character_id_version_number_unique UNIQUE (character_id, version_number);


--
-- Name: character_versions character_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_versions
    ADD CONSTRAINT character_versions_pkey PRIMARY KEY (id);


--
-- Name: characters characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id);


--
-- Name: characters characters_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_slug_unique UNIQUE (slug);


--
-- Name: chat_settings chat_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_settings
    ADD CONSTRAINT chat_settings_pkey PRIMARY KEY (id);


--
-- Name: conversation_messages conversation_messages_conversation_sequence_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_messages
    ADD CONSTRAINT conversation_messages_conversation_sequence_unique UNIQUE (conversation_id, sequence);


--
-- Name: conversation_messages conversation_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_messages
    ADD CONSTRAINT conversation_messages_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: generation_attempts generation_attempts_message_attempt_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_attempts
    ADD CONSTRAINT generation_attempts_message_attempt_unique UNIQUE (assistant_message_id, attempt_number);


--
-- Name: generation_attempts generation_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_attempts
    ADD CONSTRAINT generation_attempts_pkey PRIMARY KEY (id);


--
-- Name: generation_leases generation_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_leases
    ADD CONSTRAINT generation_leases_pkey PRIMARY KEY (attempt_id);


--
-- Name: quota_buckets quota_buckets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_buckets
    ADD CONSTRAINT quota_buckets_pkey PRIMARY KEY (id);


--
-- Name: quota_reservations quota_reservations_attempt_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_reservations
    ADD CONSTRAINT quota_reservations_attempt_id_unique UNIQUE (attempt_id);


--
-- Name: quota_reservations quota_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_reservations
    ADD CONSTRAINT quota_reservations_pkey PRIMARY KEY (id);


--
-- Name: rate_limit rate_limit_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit
    ADD CONSTRAINT rate_limit_key_unique UNIQUE (key);


--
-- Name: rate_limit rate_limit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit
    ADD CONSTRAINT rate_limit_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_unique UNIQUE (token);


--
-- Name: usage_ledger usage_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_ledger
    ADD CONSTRAINT usage_ledger_pkey PRIMARY KEY (id);


--
-- Name: user_chat_quota_overrides user_chat_quota_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_chat_quota_overrides
    ADD CONSTRAINT user_chat_quota_overrides_pkey PRIMARY KEY (user_id);


--
-- Name: user user_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_unique UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: worker_heartbeat worker_heartbeat_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_heartbeat
    ADD CONSTRAINT worker_heartbeat_pkey PRIMARY KEY (worker);


--
-- Name: account_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "account_userId_idx" ON public.account USING btree (user_id);


--
-- Name: conversation_messages_client_request_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX conversation_messages_client_request_unique ON public.conversation_messages USING btree (conversation_id, client_request_id) WHERE (client_request_id IS NOT NULL);


--
-- Name: conversation_messages_one_generated_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX conversation_messages_one_generated_slot_idx ON public.conversation_messages USING btree (in_reply_to) WHERE (kind = 'generated'::public.conversation_message_kind);


--
-- Name: conversation_messages_timeline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_messages_timeline_idx ON public.conversation_messages USING btree (conversation_id, sequence);


--
-- Name: conversations_one_active_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX conversations_one_active_conversation_idx ON public.conversations USING btree (user_id, character_id) WHERE (lifecycle = 'active'::public.conversation_lifecycle);


--
-- Name: conversations_user_last_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_user_last_message_idx ON public.conversations USING btree (user_id, last_message_at);


--
-- Name: generation_attempts_one_current_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX generation_attempts_one_current_attempt_idx ON public.generation_attempts USING btree (assistant_message_id) WHERE is_current;


--
-- Name: generation_attempts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_attempts_status_idx ON public.generation_attempts USING btree (status);


--
-- Name: generation_attempts_user_client_request_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX generation_attempts_user_client_request_unique ON public.generation_attempts USING btree (user_id, client_request_id) WHERE (client_request_id IS NOT NULL);


--
-- Name: generation_leases_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_leases_expires_at_idx ON public.generation_leases USING btree (expires_at);


--
-- Name: generation_leases_user_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX generation_leases_user_id_unique ON public.generation_leases USING btree (user_id);


--
-- Name: quota_buckets_instance_period_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quota_buckets_instance_period_unique ON public.quota_buckets USING btree (period_start) WHERE (scope = 'instance'::public.quota_scope);


--
-- Name: quota_buckets_user_period_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quota_buckets_user_period_unique ON public.quota_buckets USING btree (user_id, period_start) WHERE (scope = 'user'::public.quota_scope);


--
-- Name: session_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_userId_idx" ON public.session USING btree (user_id);


--
-- Name: usage_ledger_attempt_provider_call_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX usage_ledger_attempt_provider_call_unique ON public.usage_ledger USING btree (attempt_id, provider_call_number) WHERE (attempt_id IS NOT NULL);


--
-- Name: usage_ledger_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_ledger_period_idx ON public.usage_ledger USING btree (period_start, period_end);


--
-- Name: usage_ledger_user_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_ledger_user_period_idx ON public.usage_ledger USING btree (user_id, period_start);


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);


--
-- Name: character_versions character_versions_prevent_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER character_versions_prevent_delete BEFORE DELETE ON public.character_versions FOR EACH ROW EXECUTE FUNCTION public.prevent_character_version_mutation();


--
-- Name: character_versions character_versions_prevent_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER character_versions_prevent_update BEFORE UPDATE ON public.character_versions FOR EACH ROW EXECUTE FUNCTION public.prevent_character_version_mutation();


--
-- Name: characters characters_enforce_default_version_ownership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER characters_enforce_default_version_ownership BEFORE INSERT OR UPDATE OF default_version_id ON public.characters FOR EACH ROW EXECUTE FUNCTION public.enforce_character_default_version_ownership();


--
-- Name: characters characters_prevent_slug_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER characters_prevent_slug_change BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.prevent_character_slug_change();


--
-- Name: conversation_messages conversation_messages_enforce_generated_reply; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER conversation_messages_enforce_generated_reply BEFORE INSERT OR UPDATE ON public.conversation_messages FOR EACH ROW EXECUTE FUNCTION public.enforce_generated_message_invariants();


--
-- Name: conversations conversations_enforce_invariants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER conversations_enforce_invariants BEFORE INSERT OR UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_invariants();


--
-- Name: generation_attempts generation_attempts_enforce_current; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER generation_attempts_enforce_current BEFORE INSERT OR UPDATE ON public.generation_attempts FOR EACH ROW EXECUTE FUNCTION public.enforce_current_attempt_invariant();


--
-- Name: generation_attempts generation_attempts_preserve_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER generation_attempts_preserve_identity BEFORE UPDATE ON public.generation_attempts FOR EACH ROW EXECUTE FUNCTION public.preserve_generation_attempt_identity();


--
-- Name: generation_attempts generation_attempts_preserve_terminal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER generation_attempts_preserve_terminal BEFORE UPDATE ON public.generation_attempts FOR EACH ROW EXECUTE FUNCTION public.preserve_terminal_generation_attempt();


--
-- Name: generation_attempts generation_attempts_require_cleanup; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER generation_attempts_require_cleanup AFTER INSERT OR UPDATE ON public.generation_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_terminal_generation_cleanup();


--
-- Name: generation_attempts generation_attempts_validate_user_ownership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER generation_attempts_validate_user_ownership BEFORE INSERT OR UPDATE OF user_id, assistant_message_id ON public.generation_attempts FOR EACH ROW EXECUTE FUNCTION public.enforce_generation_attempt_user_ownership();


--
-- Name: generation_leases generation_leases_enforce_invariants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER generation_leases_enforce_invariants BEFORE INSERT OR UPDATE ON public.generation_leases FOR EACH ROW EXECUTE FUNCTION public.enforce_generation_lease_invariants();


--
-- Name: generation_leases generation_leases_require_active_attempt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER generation_leases_require_active_attempt AFTER INSERT OR UPDATE ON public.generation_leases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_terminal_generation_cleanup();


--
-- Name: quota_reservations quota_reservations_lock_attempt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER quota_reservations_lock_attempt BEFORE INSERT OR UPDATE ON public.quota_reservations FOR EACH ROW EXECUTE FUNCTION public.lock_quota_reservation_attempt();


--
-- Name: quota_reservations quota_reservations_release_on_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER quota_reservations_release_on_delete AFTER DELETE ON public.quota_reservations FOR EACH ROW EXECUTE FUNCTION public.release_deleted_quota_reservation();


--
-- Name: quota_reservations quota_reservations_require_active_attempt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER quota_reservations_require_active_attempt AFTER INSERT OR UPDATE ON public.quota_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_terminal_generation_cleanup();


--
-- Name: session session_enforce_user_eligibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER session_enforce_user_eligibility BEFORE INSERT OR UPDATE OF user_id ON public.session FOR EACH ROW EXECUTE FUNCTION public.enforce_session_user_eligibility();


--
-- Name: usage_ledger usage_ledger_preserve_accounting; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER usage_ledger_preserve_accounting BEFORE DELETE OR UPDATE ON public.usage_ledger FOR EACH ROW EXECUTE FUNCTION public.preserve_usage_ledger_accounting();


--
-- Name: account account_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: admin_audit_events admin_audit_events_actor_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_events
    ADD CONSTRAINT admin_audit_events_actor_user_id_user_id_fk FOREIGN KEY (actor_user_id) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: character_drafts character_drafts_base_version_id_character_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_drafts
    ADD CONSTRAINT character_drafts_base_version_id_character_versions_id_fk FOREIGN KEY (base_version_id) REFERENCES public.character_versions(id) ON DELETE RESTRICT;


--
-- Name: character_drafts character_drafts_character_id_characters_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_drafts
    ADD CONSTRAINT character_drafts_character_id_characters_id_fk FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE RESTRICT;


--
-- Name: character_drafts character_drafts_updated_by_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_drafts
    ADD CONSTRAINT character_drafts_updated_by_user_id_fk FOREIGN KEY (updated_by) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: character_versions character_versions_character_id_characters_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_versions
    ADD CONSTRAINT character_versions_character_id_characters_id_fk FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE RESTRICT;


--
-- Name: characters characters_archived_by_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_archived_by_user_id_fk FOREIGN KEY (archived_by) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: characters characters_created_by_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_created_by_user_id_fk FOREIGN KEY (created_by) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: characters characters_default_version_id_character_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_default_version_id_character_versions_id_fk FOREIGN KEY (default_version_id) REFERENCES public.character_versions(id) ON DELETE RESTRICT;


--
-- Name: conversation_messages conversation_messages_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_messages
    ADD CONSTRAINT conversation_messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_messages conversation_messages_in_reply_to_conversation_messages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_messages
    ADD CONSTRAINT conversation_messages_in_reply_to_conversation_messages_id_fk FOREIGN KEY (in_reply_to) REFERENCES public.conversation_messages(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_character_id_characters_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_character_id_characters_id_fk FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE RESTRICT;


--
-- Name: conversations conversations_pinned_character_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pinned_character_version_fk FOREIGN KEY (character_id, character_version_id) REFERENCES public.character_versions(character_id, id) ON DELETE RESTRICT;


--
-- Name: conversations conversations_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: generation_attempts generation_attempts_assistant_message_id_conversation_messages_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_attempts
    ADD CONSTRAINT generation_attempts_assistant_message_id_conversation_messages_ FOREIGN KEY (assistant_message_id) REFERENCES public.conversation_messages(id) ON DELETE CASCADE;


--
-- Name: generation_attempts generation_attempts_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_attempts
    ADD CONSTRAINT generation_attempts_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: generation_leases generation_leases_attempt_id_generation_attempts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_leases
    ADD CONSTRAINT generation_leases_attempt_id_generation_attempts_id_fk FOREIGN KEY (attempt_id) REFERENCES public.generation_attempts(id) ON DELETE CASCADE;


--
-- Name: generation_leases generation_leases_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_leases
    ADD CONSTRAINT generation_leases_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: quota_buckets quota_buckets_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_buckets
    ADD CONSTRAINT quota_buckets_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: quota_reservations quota_reservations_attempt_id_generation_attempts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_reservations
    ADD CONSTRAINT quota_reservations_attempt_id_generation_attempts_id_fk FOREIGN KEY (attempt_id) REFERENCES public.generation_attempts(id) ON DELETE CASCADE;


--
-- Name: quota_reservations quota_reservations_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_reservations
    ADD CONSTRAINT quota_reservations_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: quota_reservations quota_reservations_instance_bucket_id_quota_buckets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_reservations
    ADD CONSTRAINT quota_reservations_instance_bucket_id_quota_buckets_id_fk FOREIGN KEY (instance_bucket_id) REFERENCES public.quota_buckets(id) ON DELETE RESTRICT;


--
-- Name: quota_reservations quota_reservations_user_bucket_id_quota_buckets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_reservations
    ADD CONSTRAINT quota_reservations_user_bucket_id_quota_buckets_id_fk FOREIGN KEY (user_bucket_id) REFERENCES public.quota_buckets(id) ON DELETE RESTRICT;


--
-- Name: quota_reservations quota_reservations_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_reservations
    ADD CONSTRAINT quota_reservations_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: session session_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: usage_ledger usage_ledger_attempt_id_generation_attempts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_ledger
    ADD CONSTRAINT usage_ledger_attempt_id_generation_attempts_id_fk FOREIGN KEY (attempt_id) REFERENCES public.generation_attempts(id) ON DELETE SET NULL;


--
-- Name: usage_ledger usage_ledger_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_ledger
    ADD CONSTRAINT usage_ledger_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: usage_ledger usage_ledger_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_ledger
    ADD CONSTRAINT usage_ledger_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: user_chat_quota_overrides user_chat_quota_overrides_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_chat_quota_overrides
    ADD CONSTRAINT user_chat_quota_overrides_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
