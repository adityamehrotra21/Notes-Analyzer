ALTER TABLE "generated_questions" ADD COLUMN "cache_key" text;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "cache_key" text;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_questions_cache_idx" ON "generated_questions" USING btree ("user_id","cache_key");--> statement-breakpoint
CREATE INDEX "quizzes_cache_idx" ON "quizzes" USING btree ("user_id","cache_key");