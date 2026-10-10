CREATE TABLE "memory_extraction_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"execution_number" integer NOT NULL,
	"candidates" jsonb,
	"model_id" text NOT NULL,
	"provider_identity" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_input_tokens" bigint NOT NULL,
	"estimated_output_tokens" bigint DEFAULT 0 NOT NULL,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error_category" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"response_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_extraction_executions_run_number_unique" UNIQUE("run_id","execution_number"),
	CONSTRAINT "memory_extraction_executions_number_check" CHECK ("memory_extraction_executions"."execution_number" BETWEEN 1 AND 5),
	CONSTRAINT "memory_extraction_executions_tokens_check" CHECK (
      "memory_extraction_executions"."estimated_input_tokens" >= 0 AND "memory_extraction_executions"."estimated_output_tokens" >= 0
      AND ("memory_extraction_executions"."input_tokens" IS NULL OR "memory_extraction_executions"."input_tokens" >= 0)
      AND ("memory_extraction_executions"."output_tokens" IS NULL OR "memory_extraction_executions"."output_tokens" >= 0)
      AND "memory_extraction_executions"."latency_ms" >= 0
    )
);
--> statement-breakpoint
ALTER TABLE "memory_extraction_runs" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "memory_extraction_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "automatic_digest" text;--> statement-breakpoint
ALTER TABLE "memory_items" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_extraction_executions" ADD CONSTRAINT "memory_extraction_executions_run_id_memory_extraction_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."memory_extraction_runs"("id") ON DELETE cascade ON UPDATE no action;