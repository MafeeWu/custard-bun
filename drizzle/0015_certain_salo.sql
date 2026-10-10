ALTER TABLE "data_export_jobs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_export_jobs" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_export_jobs" ADD COLUMN "dead_letter_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_export_jobs" ADD CONSTRAINT "data_export_jobs_attempt_count_range" CHECK ("data_export_jobs"."attempt_count" BETWEEN 0 AND 5);--> statement-breakpoint
ALTER TABLE "data_export_jobs" ADD CONSTRAINT "data_export_jobs_retry_shape_check" CHECK ("data_export_jobs"."next_retry_at" IS NULL OR "data_export_jobs"."status" = 'pending');