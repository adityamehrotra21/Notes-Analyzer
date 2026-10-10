ALTER TABLE "documents" ADD COLUMN "summary_exam" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "outline" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "summary_coverage" jsonb;