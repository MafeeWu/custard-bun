CREATE FUNCTION preserve_extraction_dead_letter_publication()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.dead_letter_published_at IS NOT NULL
     AND NEW.dead_letter_published_at IS DISTINCT FROM OLD.dead_letter_published_at THEN
    RAISE EXCEPTION 'extraction dead-letter publication receipt is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER memory_extraction_runs_preserve_dead_letter_publication
BEFORE UPDATE OF dead_letter_published_at ON memory_extraction_runs
FOR EACH ROW EXECUTE FUNCTION preserve_extraction_dead_letter_publication();