CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "app_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"level" "log_level" NOT NULL,
	"module" text NOT NULL,
	"message" text NOT NULL,
	"request_id" text,
	"user_id" uuid,
	"meta" jsonb,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" "audit_action" NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"changes" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"request_id" text,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 8) DEFAULT 0 NOT NULL,
	"estimated" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "difficulty" "quiz_difficulty";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE INDEX "app_logs_timestamp_idx" ON "app_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "app_logs_level_ts_idx" ON "app_logs" USING btree ("level","timestamp");--> statement-breakpoint
CREATE INDEX "app_logs_module_idx" ON "app_logs" USING btree ("module");--> statement-breakpoint
CREATE INDEX "app_logs_request_idx" ON "app_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "app_logs_user_idx" ON "app_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "llm_usage_created_idx" ON "llm_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_usage_feature_idx" ON "llm_usage" USING btree ("feature");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_user_hash_idx" ON "documents" USING btree ("user_id","content_hash") WHERE "documents"."content_hash" is not null;