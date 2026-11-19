# Changelog

All notable changes to NotesAnalyser. Newest first. One entry per phase/change.

## 2026-11-20 — Deployment: Vercel (client) + Render (API, Docker) + Supabase (Postgres)

- New `Dockerfile` (repo root):
  - Node 22 with Debian Chromium for PDF exports, plus fonts. Runs as a non-root user under dumb-init.
  - Runs migrations on start, then the server, on port 10000.
  - `.dockerignore` keeps `.env`, `node_modules`, storage and the client out of the image.
- New `render.yaml` Blueprint: a free Docker web service with health check `/api/health` (which already runs `SELECT 1`). Secrets are `sync: false`, `TRUST_PROXY=2` and `JWT_SECRET` is generated.
- New `client/vercel.json`: an `/api/*` rewrite to Render (one origin, first-party cookie), an SPA fallback, and immutable caching for `/assets`.
- Client: the API base comes from `VITE_API_URL` (default `/api`; `client/.env.example`).
- Express serves `client/dist` only with `SERVE_CLIENT=true`. Before this, `NODE_ENV=production` turned it on.
- Postgres (`server/src/db/pgConfig.js`, shared with the migrate and make-admin scripts):
  - `DB_SSL` is `auto`, `off`, `require` or `verify`. Any `sslmode` in the URL is ignored in favour of `DB_SSL`.
  - `DB_POOL_MAX` defaults to 5 (it was 10).
- Email: `EMAIL_PROVIDER` is `brevo`, `resend`, `smtp` or `console`. Brevo and Resend use their HTTPS APIs (no new dependencies) because Render free blocks SMTP. Attachments are supported.
- `docker-compose.yml`: optional `app` profile (the API image, the built client mounted, `SERVE_CLIENT=true`) on http://localhost:8080.
- README: new step-by-step **Deploy** section covering Supabase, Brevo or Resend, Render, Vercel, the direct-call fallback, UptimeRobot and make-admin via Render Shell.
- Verified the image locally against a fresh Postgres (mock LLM, local SMTP sink):
  - exports, sessions and email checks: 27/27
  - auth and OTP checks: 28/28
  - auth browser flow: 11/11
  - Stop and Doubts browser test: passing
  - Brevo and Resend request payloads: checked against their API formats

## 2026-11-20 — Cookie login with refresh tokens, forgot password (email OTP)

- **Login now uses a refresh cookie.** The token is no longer kept in localStorage.
  - Login and register set an httpOnly `na_rt` cookie (path `/api/auth`, SameSite from `COOKIE_SAMESITE`, default `lax`; Secure in production).
  - The access token is short-lived (`ACCESS_TOKEN_TTL`, 15 min) and lives only in memory.
  - On page load and on any 401 the client calls `POST /api/auth/refresh` once, then retries the request. This also covers Doubts streaming, exports and the admin log stream.
- **Refresh tokens rotate on every use.** Only their SHA-256 is stored on `sessions`.
  - Replaying an old token after a 60 s grace window revokes the whole session (theft detection). The grace window covers two tabs refreshing at once.
  - Refresh needs an `X-Requested-With` header (CSRF guard).
  - The session lasts `REFRESH_TOKEN_DAYS` (30) and extends with use. Logout and "log out everywhere" clear the cookie.
- **Forgot password.** New `/forgot-password` page, linked from Login.
  - The user enters their email, then gets a 6-digit code by email (valid 10 min), and sets a new password.
  - The code is stored as an HMAC. It is single-use, allows 5 wrong guesses, and can be resent after 60 s. Rate limits: per IP, and 5 emails per address per hour.
  - The reply is identical whether or not the account exists.
  - A successful reset signs out every device and sends the "password changed" email (which now links to reset).
- Migration `0009_auth_refresh_otp` (additive: 4 columns on `sessions`, new `password_resets` table).
- New env: `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_DAYS`, `COOKIE_SAMESITE`, `COOKIE_SECURE`, `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_SECONDS`. `JWT_EXPIRES_IN` is no longer used.
- CORS: `CLIENT_ORIGIN` accepts a comma-separated list, and credentials are allowed.

## 2026-11-20 — Chat → Doubts, Stop button fix, chunk counts hidden

- **Stop fixed:** if the page reloaded while an answer was streaming, the restored message stayed "streaming" with no request behind it. Stop did nothing and the input stayed locked. Such messages are now marked *Stopped* on load, and Stop updates the UI immediately (and ignores late tokens).
- **Doubts tab replaces Chat.** It is a patient tutor that answers from your PDF with page citations, re-explains more simply on follow-ups, and keeps any requested style or language. When the notes don't cover something, it says so and still explains, under "**Beyond your notes:**" (no citations on that part). The old "I couldn't find this in your notes" dead end and its no-LLM shortcut are gone. Old `?tab=chat` links open Doubts.
- **No chunk counts for users:** removed from the Study header (pages only), the document list, and the upload badge (now "Indexing 42%"). The admin-only Re-index tool still shows them.

## 2026-11-20 — Bullets mode removed

- The Summary tab now offers **Brief**, **Detailed Notes** (default) and **Exam Revision**.
- The API no longer accepts `mode: "bullet"` for `/api/summarize` or exports. Its prompt was removed.
- `documents.summary_bullet` is kept (no destructive migration) but is no longer read or written.

## 2026-11-20 — Calm callouts, exports (PDF/Markdown/email), Gmail SMTP, account & sessions

### Fixed: callouts looked like errors
- Callouts now use GitHub alert syntax: `> [!IMPORTANT]`, `> [!MISTAKE]`, `> [!TIP]`, `> [!EXAMPLE]`, `> [!NOTE]`. All prompts (notes, exam revision, gap fill, chat) emit them, one per blockquote.
- New `Callout` component with calm tints (`bg-*-500/10`, subtle left border): Important = indigo + Star, **Common pitfall** = amber + Lightbulb (no longer red-looking), Tip = emerald + Sparkles, Example = zinc + Code, Note = slate + Info.
- `remarkCallouts` also converts older notes: `> ⚠️ …` / `> ⭐ …`. A blockquote holding several callouts (the case in the bug report) is split into one card each, and redundant "Common mistakes:" labels are dropped.

### Added: exports (no LLM calls)
- `POST /api/export { type: notes|qa|quiz|attempt|all, documentId(s)/refId, options, format: pdf|md, email }`.
- **PDF** via Puppeteer (one shared headless browser, at most 2 at a time): cover page, table of contents, highlighted code, callout colours, tables, page citations, and a footer with "title · page X / Y". **Markdown** download too.
- **Notes** in any mode; **Q&A** grouped by outline topic, then short/long/conceptual, with model answers and marking points, or *questions only* with answer lines; **Quiz** questions only or with answer key; **My attempt** with my answers, correct answers, score and explanations; **Export all** as one study-pack PDF.
- **Email PDF to me** (attachment) for every export.
- Filenames: `<doc>_<type>_<YYYY-MM-DD>.pdf`. Rate limit: 30 per 10 minutes. Every export is logged and audited.
- UI: an **Export** dropdown in the notes card header, the Questions tab, quiz results, and the document header ("Export all"), with toasts while generating and double clicks blocked.

### Added: email (Gmail SMTP)
- `mailService` (nodemailer), configured with `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`, `APP_URL`. Gmail App Password steps are in `.env.example` and the README. Without SMTP settings, emails are logged instead of sent, and "Email PDF" returns a clear 503.

### Added: account settings & sessions
- `sessions` table (migration `0008`). Access tokens carry a session id, and every request checks the session is active, so revoking takes effect immediately (30 s cache, last-seen updated at most once a minute). At most `MAX_SESSIONS_PER_USER` (5) active sessions; the oldest is revoked beyond that.
- **Account page** (`/account`, via your name in the navbar): change password (current password required; 8+ chars with a letter and a number; confirm), active sessions (browser/OS, last active, "This device"), log out a device, log out other devices, log out everywhere.
- Changing the password signs out all other devices and emails a "your password was changed" notice. Logging out now ends the session on the server.
- **Everyone must log in again once**: tokens issued before sessions existed are rejected.

### Tests
- API: 27/27 (sessions, limit, revoke, change password, 7 export types verified by PDF text, Markdown, filenames, ownership, email delivery with attachment through a local SMTP server). Browser: callouts (incl. the reported text) in both themes, PDF download, Account page. Unit tests 25/25.

## 2026-11-20 — Re-index is admin-only

- The **Re-index** button is hidden from normal users and shown only to admins, on the document page.
- `GET /api/documents/:id/reindex/estimate` and `POST /api/documents/:id/reindex` now require an admin (403 otherwise).
- The duplicate-upload toast no longer mentions re-indexing.

## 2026-11-20 — Round 3, phase 1: empty-output fix + no cost in the user UI

### Fixed: "AI returned empty" errors
- **Cause:** gpt-5-mini/nano are reasoning models, and reasoning tokens count toward the output cap. Tight caps (600–1200) could be consumed entirely by reasoning, leaving no visible text (finish_reason "length").
- **Reasoning effort per tier:** `OPENAI_REASONING_EFFORT=low` for gpt-5-mini and the new `OPENAI_REASONING_EFFORT_CHEAP=minimal` for gpt-5-nano, on every call.
- **Higher caps** (env): chat 2000, questions 4000, quiz 4000, Detailed Notes 12000, Brief/Bullets/Exam Revision 4000 (Exam moved to the summary cap), map step 1500, missing-topic fill 4000, outline 2000, classifier 200.
- **Post-call checks in `llmService`:** finish_reason length (incomplete), `refusal`, empty text and JSON parse failures are each logged with model, tokens, reasoning tokens and reason.
- **Recovery:**
  - Incomplete with no text (or truncated JSON): one retry with effort `minimal` and 1.5× the cap.
  - Refusal or still empty: `GenerationError` → "Couldn't generate this right now, please try again." Raw "empty" messages are gone.
  - Long notes cut off mid-way: up to 2 "continue where you stopped" calls, stitched with seam de-duplication.
  - Streams get the same retry rule.
- The summary service's own rescue retry was removed; it now relies on llmService.
- `test/llmRecovery.test.js`: 10 cases with a stubbed OpenAI API (no network or spend). **25/25 tests passing.**

### Changed: cost is admin-only
- Removed from the user UI: estimates under Generate; "(uses credits)" labels on Regenerate, "more questions", "always generate new quiz" and the duplicate-upload toast; the cost line in the Re-index confirmation.
- Regenerate confirmation: "This will replace the current version. Continue?" Re-index: pages and chunk counts plus "This will replace the current index… Continue?"
- `GET /api/summarize/estimate` is admin-only. The re-index estimate strips `estimatedUsd`/model/budget fields for non-admins, and `GET /api/budget/status` returns only `{ level: ok|exhausted }` to non-admins.
- At the cap, users see **"Generation is temporarily unavailable"** (402, also used for the provider's insufficient_quota). The banner appears for users only when generation is unavailable. Admins also get a warning past `BUDGET_WARN_PCT`, with amounts. Costs remain in admin Logs → Usage & Budget. The budget guard is unchanged server-side.

### Config
- New `OPENAI_REASONING_EFFORT_CHEAP`; `OPENAI_REASONING_EFFORT` now defaults to `low`. The new cap values were written to `server/.env` and `.env.example`.

## 2026-11-20 — Phase 2: Detailed study notes + coverage check

### Added
- **Four modes:** Brief, **Detailed Notes** (now the default), Bullets, and **Exam Revision** (new column `summary_exam`). Detailed and Exam use a new output cap `MAX_OUTPUT_TOKENS_NOTES` (5000); Brief and Bullets keep `MAX_OUTPUT_TOKENS_SUMMARY_REDUCE` (1200).
- **Topic outline** (`outlineService.js`): gpt-5-nano extracts every topic in document order with page ranges, up to 5 subtopics and the document type (programming/general), as strict JSON. It's cached on `documents.outline` and reused by every notes mode. Regenerating Detailed Notes refreshes it.
- **Detailed Notes prompt:** one `##` section per outline topic, in order, using the exact titles, with page citations; **Definition**, **In simple terms**, at least one example per concept (code examples for programming notes), comparison tables where the notes compare things, `> ⚠️ Common mistakes` and `> ⭐ Important for exams` callouts, and a final **Key takeaways**. Examples the model writes itself must be labelled **Example (added)**; examples taken from the notes are labelled **Example (from notes, p. N)**.
- **Exam Revision:** must-know checklist, a key-definitions table, a per-topic "⭐ Likely exam question" with model answers, common mistakes, and a last-minute recap.
- **Coverage check** (`coverage.js`, no LLM): every outline topic must have its own heading (a bold label in Bullets; the exam checklist does not count). Missing topics are written in **one extra call** from their own pages (`MAX_OUTPUT_TOKENS_NOTES_FILL` 2000) and inserted before Key takeaways. The result is stored per mode in `documents.summary_coverage` and shown as **"Coverage: 12/12 topics (n auto-filled)"**.
- **Cost estimates:** `GET /api/summarize/estimate?documentId&mode&refresh` (no LLM call) gives the typical and worst-case cost, broken down by step. It's shown under Generate and in the Regenerate confirmation.
- UI: styled ⚠️/⭐ callouts, "Example (added)" vs "Example (from notes)" badges, and task-list checkboxes; the progress text names the pipeline (outline → notes → coverage check).
- Tests: `test/coverage.test.js` (6 cases). 15/15 tests passing.

### Changed
- The Detailed-notes and other-modes rows in the admin cost table now include the outline, notes cap and fill. Estimates: Detailed Notes on a 20-page PDF ≈ $0.009 typical (≤ $0.033 worst); a dense 32-page PDF ≈ $0.011 typical (≤ ~$0.036 worst).

### Migrations
- `0007_notes_outline_coverage`: `documents.summary_exam`, `documents.outline`, `documents.summary_coverage` (additive).

### New env vars
`MAX_OUTPUT_TOKENS_NOTES`, `MAX_OUTPUT_TOKENS_NOTES_FILL`, `MAX_OUTPUT_TOKENS_OUTLINE`.

## 2026-11-20 — Phase 1 of the study-workspace plan: bug fixes A1–A4 + re-index

### Fixed
- **A1 Chunking** (`server/src/services/chunker.js`, rewritten): chunks are page-aware. Breaks fall at page boundaries (one chunk per normal page or slide), long pages split at 800 tokens on paragraph/sentence boundaries, and a chunk never contains text from more than 2 pages (overlap included). Pages under 20 tokens (title slides) merge into a neighbour, and a trailing scrap under 8 tokens ("Thank you") that can't merge is dropped. Overlap is ≤100 tokens and ≤20% of the previous chunk, falling back to trailing sentences when paragraphs are larger than the allowance (overlap used to silently vanish in that case). Cause of the bug: your 32-page "lecture 13.pdf" has only ~1,600 tokens of text (~50/page), and the old chunker packed purely by tokens, giving 2 chunks spanning pp. 1–18 and 18–32. A 32-slide test deck of the same shape now gives 24 chunks with per-slide citations.
- **A2 Chat intent routing** (`intentService.js`, `prompts/intent.js`, `ragService.js`): keyword heuristics classify each message as *lookup* (vector top-k, as before) or *document-wide* ("explain my notes in detail", "teach me everything", "what is this lecture about"). Only topic-less messages ("explain it", "more") go to gpt-5-nano (strict JSON, 60-token cap; failures default to lookup). Document-wide answers send the whole document when it fits `CHAT_FULLDOC_TOKENS` (30k); larger documents get the saved detailed summary as an overview plus top-k and an even sample. Output cap `MAX_OUTPUT_TOKENS_CHAT_LONG` (1500). The chat response now includes `meta: { intent, intentMethod, mode, sources }`.
- **A3 Summaries:** documents up to `SUMMARY_SINGLE_CALL_TOKENS` (60k) go to OPENAI_CHAT_MODEL in **one call**; map-reduce (nano map + mini reduce) is used only above that.
- **A4 Markdown everywhere:** `react-markdown` + `remark-gfm` + `rehype-highlight` with a language label and copy button on code blocks, theme-aware highlighting colours (AA contrast in light and dark), and Markdown in quiz questions/options/explanations and practice questions.

### Added
- **Stored PDFs** (`fileStorage.js`): uploads are saved under `server/storage/pdfs/<userId>/<documentId>.pdf` (git-ignored, `STORAGE_DIR`) and deleted with their document. Documents uploaded before this (like "lecture 13.pdf") get their file attached when the same PDF is uploaded again.
- **Re-index:** `GET /api/documents/:id/reindex/estimate` (re-chunks locally, prices the embeddings; logged) and `POST /api/documents/:id/reindex` (logs the estimate, then re-chunks + re-embeds from the stored PDF). The old index stays in use until the new one is committed. A failed or interrupted re-index keeps the previous index (restart-safe). Audited. A **Re-index** button in the document header shows pages, new vs current chunk count and the embedding cost before running.
- `npm test` (`node --test`): chunker tests (32-page dense notes and 32-page slide deck → 25–60 chunks, ≤2 pages per chunk, page numbers kept, overlap, scraps) and intent-heuristic tests. 9/9 passing.
- `API_PORT` env override in `client/vite.config.js` for pointing a second dev client at a test server.

### New env vars
`STORAGE_DIR`, `CHAT_FULLDOC_TOKENS`, `MAX_OUTPUT_TOKENS_CHAT_LONG`, `MAX_OUTPUT_TOKENS_CLASSIFY`, `SUMMARY_SINGLE_CALL_TOKENS` (defaults in `.env.example`).

## 2026-11-20 — Logging, audit trail, admin portal; OpenAI with a hard budget

### Added
- **Central logger** (`server/src/utils/logger.js`, singleton). Levels debug/info/warn/error, `child({ module })` tags, automatic `requestId`/`userId` from an AsyncLocalStorage request context (it also covers background ingestion), redaction of API keys, passwords, JWTs and Authorization headers. Pretty console in dev, JSON lines in prod, batched async inserts into `app_logs` (every 2 s or 50 entries; console-only fallback if the DB write fails). `LOG_LEVEL`, `LOG_RETENTION_DAYS` (startup + daily pruning).
- **Request logging middleware**: `X-Request-Id` on every response; method/path/status/duration per request. Replaces morgan. All server `console.*` calls replaced. Important events logged: uploads, parse/chunk/embed progress, retrieval (k, latency, top score), every LLM call (model, tokens in/cached/out/reasoning, cost, latency), quiz generated/submitted, auth success/failure, rate-limit hits, budget refusals.
- **Change log**: `audit_logs` table and `AuditService` (singleton). Records create/update/delete for users, documents (including status changes and summary generation), question sets, quizzes and quiz attempts, with minimal `{ before, after }` diffs. Never stores password hashes, embeddings or file contents.
- **Admin portal** (`/admin/logs`, admins only) with three tabs: Live Logs (SSE tail with pause/resume and level badges, plus a search mode filtered by level/module/request/user/date/text and one-click request tracing), Change Log (expandable before/after diff), Usage & Budget (spend meter, per-operation cost estimates, spend by feature/model/day, recent calls).
- `users.role` (user|admin) and `npm run make-admin -- <email> [--revoke]`.
- Admin API: `GET /api/admin/logs`, `/api/admin/logs/stream`, `/api/admin/audit`, `/api/admin/usage`; `GET /api/budget/status` for the app-wide banner.
- **Budget guard** (`budgetService`, singleton): each paid call reserves its worst-case cost (counted input + max output tokens at list price) and is refused with **402 "Budget limit reached"** if spent + reserved + estimate > `LLM_BUDGET_USD` (1.20). Actual usage from the API's `usage` field is recorded in `llm_usage`. Reservations stop concurrent requests from overshooting together. Aborted streams are billed as an estimate. Unpriced models are refused. Warning log and UI banner at `BUDGET_WARN_PCT` (75%).
- `server/src/config/pricing.js`: USD per 1M tokens for gpt-5-mini, gpt-5-nano and text-embedding-3-small. **Verify against https://openai.com/api/pricing.**
- Per-feature output caps: chat 600, questions 1500, quiz 2000, summary map 400, summary reduce 1200 (`MAX_OUTPUT_TOKENS_*`).
- `LLM_MOCK=true`: canned chat/summaries/quizzes plus offline embeddings, so UI flows can be tested for $0.
- Duplicate-upload detection (sha256 per user, `documents.content_hash`): the same PDF is never embedded twice.
- Self-check in structured outputs: every question/quiz item has `verified`, and unverified items are dropped (no extra call). Practice questions now include marking points; quiz questions carry their own difficulty.
- "Uses credits" confirmations on Regenerate, "more questions" and "always generate new quiz".

### Changed
- **LLM provider is now OpenAI** via Chat Completions. `OPENAI_CHAT_MODEL=gpt-5-mini` handles chat, quizzes, questions and final summaries; `OPENAI_CHEAP_MODEL=gpt-5-nano` handles the summary map step. Reasoning models get `max_completion_tokens` + `reasoning_effort=minimal` and no `temperature`. Structured outputs use strict `json_schema`, are zod-validated and retried once. `prompt_cache_key` is set, and stable content comes first so OpenAI prompt caching can apply. The Gemini adapter is kept (provider-agnostic `llmService`).
- **Embeddings: OpenAI `text-embedding-3-small`, 1536 dims.** Migration `0006` changes `chunks.embedding` to `vector(1536)` and **deletes all existing documents and quizzes** (demo data; approved). Users are kept. Re-upload PDFs.
- Cost rules: chat top-k 5, last 4 turns, ≤6k tokens of sources; quiz/questions ≤8k tokens of context; summary groups of 8k tokens; per-request limits short/conceptual 15, long 6, quiz 12 (sized to the output caps).
- Prompts rewritten for quality (`server/prompts/`): structured study notes with definitions, preserved formulas, page citations and an "Exam focus" section; MCQs that test understanding, with a difficulty mix and page-citing explanations; questions with model answers and marking points.

### Fixed / learned
- With `reasoning_effort=minimal`, gpt-5-mini still spent **all 1200** output tokens reasoning on a detailed summary and returned nothing. An instruction at the end of the user message ("write the final answer immediately, without planning") brought that to 0 in the measured retry. It's now in every summary prompt, plus a one-time rescue retry if it happens anyway.
- Redaction no longer hides token-count fields (`inputTokens`, `maxOutputTokens`, …).

### Migrations
- `0005_observability_budget`: `user_role`, `log_level`, `audit_action` enums; `users.role`; `documents.content_hash` (unique per user); `quiz_questions.difficulty`; `app_logs`, `audit_logs`, `llm_usage`.
- `0006_openai_embeddings_1536`: wipes documents/quizzes, then `vector(1536)`.

## 2026-11-19 — Phases 1–6 (initial build)
- Phase 1: Express 5 + React (Vite) scaffold, JWT auth, PostgreSQL + pgvector via Drizzle, light/dark/system theme.
- Phase 2: PDF upload, ingestion (pdf-parse v2, cleaning, token-aware chunking with page ranges), embeddings with pacing/backoff, retrieval and test scripts.
- Phase 3: streamed RAG chat with citations; provider-agnostic `llmService`.
- Phase 4: map-reduce summaries (brief/detailed/bullet), cached per document.
- Phase 5: practice questions and MCQ quizzes with structured output, server-side option shuffling, grading and history.
- Phase 6: code splitting, error boundary, offline/session notices, accessibility (axe-clean), production serving with CSP.
