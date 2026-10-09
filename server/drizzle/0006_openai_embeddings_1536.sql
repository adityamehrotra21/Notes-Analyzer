-- Switch embeddings to OpenAI text-embedding-3-small (1536 dims).
-- DESTRUCTIVE (approved): existing chunks were embedded with a different model/size and the original
-- PDFs are not stored, so they cannot be re-embedded. Wipe all document data; users are kept.
-- Cascades: documents -> chunks, quiz_document, generated_questions; quizzes -> quiz_questions, quiz_attempts.
DELETE FROM "quizzes";--> statement-breakpoint
DELETE FROM "documents";--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);