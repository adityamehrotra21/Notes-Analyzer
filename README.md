# NotesAnalyser

A RAG-based notes analyser. Upload PDF notes, then get summaries, ask questions grounded in your notes, and generate practice questions and quizzes.

**Stack:** React (Vite) + Tailwind v4 · Node/Express 5 (ES modules) · PostgreSQL 17 + pgvector via Drizzle ORM · OpenAI (`gpt-5-mini`, `gpt-5-nano`, `text-embedding-3-small`) with a hard spending cap

Features: PDF upload with background ingestion · summaries (brief / detailed / bullets, map-reduce, cached) · chat grounded in your notes with page citations (streamed) · practice questions with model answers · multiple-choice quizzes with explanations, scoring and history · light/dark/system theme.

Providers are swappable through env (OpenAI by default; Gemini or any OpenAI-compatible API such as Groq). `LLM_MOCK=true` gives canned offline responses so the UI can be tested for $0. See [CHANGELOG.md](CHANGELOG.md) for what changed when.

## Prerequisites

- Node.js 20+ (tested on 24)
- PostgreSQL with the `vector` extension. Pick one:
  - **Local:** Docker Desktop. The included `docker-compose.yml` runs `pgvector/pgvector:pg17`.
  - **Hosted (free tier):** [Neon](https://neon.tech) or [Supabase](https://supabase.com). Both ship pgvector; the first migration enables it.
- A Gemini API key (from phase 2 on)

## Setup

```bash
npm run install:all                 # root, server and client deps
cp server/.env.example server/.env  # then fill in JWT_SECRET (and DATABASE_URL if not using Docker)

npm run db:up                       # local Postgres + pgvector on :5432 (skip if using Neon/Supabase)
npm run db:migrate                  # applies server/drizzle/*.sql
npm run dev                         # server on :5001, client on :5173
```

Open http://localhost:5173. Vite proxies `/api` to the server port it reads from `server/.env`.

**Try it without an API key:** set `LLM_PROVIDER=mock` and `EMBED_PROVIDER=hash` in `server/.env`. Answers are extractive stand-ins, so this is only for exercising the UI. Re-upload your documents when you switch `EMBED_PROVIDER` back, because embeddings from different providers can't be mixed.

### Production (single origin, local)

```bash
npm run build                                   # builds client/dist
SERVE_CLIENT=true npm start                     # Express serves the API and the built app on PORT
# or, the same in Docker against the compose database (http://localhost:8080):
npm run build && docker compose --profile app up --build
```

With `SERVE_CLIENT=true`, Express serves `client/dist` with immutable caching for hashed assets, `no-cache` for `index.html`, and an SPA fallback for non-`/api` routes. Helmet's default Content-Security-Policy stays on; the theme script is an external file in `client/public/theme-init.js` for that reason.

## Deploy: Vercel (client) + Render (API) + Supabase (Postgres)

```
browser ──> Vercel  (static client; /api/* is rewritten ──>)  Render: Docker web service (Express)  ──> Supabase Postgres + pgvector
```

The browser only ever talks to the Vercel domain: `client/vercel.json` proxies `/api/*` to Render, so the refresh cookie is first-party and no CORS is involved. Files: [Dockerfile](Dockerfile), [render.yaml](render.yaml), [client/vercel.json](client/vercel.json).

### 1. Supabase (database)

1. Create a project (pick a region close to where Render will run). Save the database password.
2. **Project → Connect → Session pooler**: copy the connection string (port **5432**, user `postgres.<project-ref>`). Put the real password in, URL-encoding special characters. Use this as `DATABASE_URL`. Leave out any `?sslmode=...` part, because `DB_SSL=require` handles SSL.
   - Transaction pooler (port 6543) also works with this app: node-postgres only uses prepared statements for named queries, and the app has none. With a driver that does use them, you'd need `prepare: false`. Prefer the Session pooler anyway.
   - Direct connections (`db.<ref>.supabase.co`) are IPv6-only on the free plan, and Render can't reach them.
3. pgvector: the first migration runs `CREATE EXTENSION IF NOT EXISTS vector`. You can also enable it under **Database → Extensions → vector**.
4. You don't need to run migrations yourself: the container applies them on every start.
5. Don't use Supabase Auth or the Supabase JS client. The app uses Supabase as plain Postgres.

Free-tier notes: 500 MB database. At 1536 dimensions, each chunk embedding takes about 6 KB plus HNSW index overhead. To roughly halve vector storage you can switch to `EMBED_DIMENSIONS=512`, because text-embedding-3-small accepts a `dimensions` parameter and the app passes it. This needs a new migration for `vector(512)` (change `EMBED_DIMENSIONS` in `server/src/db/schema.js`, then `npm run db:generate`) and a re-index of every document. The default stays 1536.

### 2. Email sender (Brevo or Resend)

Render's free plan blocks outbound SMTP, so in production use an HTTPS email API:
- **Brevo** (300 emails/day free): sign up, then **Senders, Domains & Dedicated IPs → Senders → Add a sender**, and verify that address via the email Brevo sends. Then **SMTP & API → API Keys → Generate**. Set `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, and `MAIL_FROM="NotesAnalyser <that-verified-address>"`.
- **Resend**: add and verify your domain (DNS records) under **Domains**, then create an API key. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `MAIL_FROM="NotesAnalyser <noreply@your-domain>"`. Without a domain, Resend only delivers to your own account email.
- `EMAIL_PROVIDER=console` writes emails to the log instead. Password-reset codes then can't be delivered: the forgot-password endpoint answers 503 in production.

### 3. Render (API)

1. Push the repo to GitHub.
2. Render dashboard: **New → Blueprint**, pick the repo. It reads `render.yaml`: a free Docker web service `notesanalyser-api` with health check `/api/health`.
3. Fill in the secrets it asks for:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Supabase Session pooler string |
| `OPENAI_API_KEY` | your key |
| `LLM_BUDGET_USD` | the hard spend cap. It is counted in **this** database, so subtract what local development has already spent from the same OpenAI balance. |
| `CLIENT_ORIGIN` | your Vercel URL, e.g. `https://notesanalyser.vercel.app`. Used for links in emails, and for CORS in fallback mode. |
| `BREVO_API_KEY`, `MAIL_FROM` | from step 2 (or set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`) |

   Preset by the Blueprint: `NODE_ENV=production`, `TRUST_PROXY=2` (Vercel plus Render's proxy, so rate limits see the real IP), `DB_SSL=require`, `DB_POOL_MAX=5`, `COOKIE_SAMESITE=lax`, `JWT_SECRET` (generated), `EMAIL_PROVIDER=brevo`.
4. Deploy. On start, the container runs migrations and then starts the server. `https://<service>.onrender.com/api/health` should return `{"ok":true,"db":"connected"}`.
5. If Render gave the service a different URL than `notesanalyser-api.onrender.com`, update the destination in `client/vercel.json`.

Notes on the free plan:
- 512 MB RAM. PDF export starts Chromium on first use (about 150–250 MB).
- The service sleeps after 15 minutes without traffic. The UptimeRobot ping below keeps it awake.
- The disk is ephemeral, so uploaded PDFs in `STORAGE_DIR` are lost on every deploy and restart. Everything users see (chunks, notes, quizzes, Doubts) lives in Postgres. Only the admin **Re-index** needs the original PDF.

### 4. Vercel (client)

**Add New → Project**, import the same repo, then set:

| Setting | Value |
|---|---|
| Root Directory | `client` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Environment variable | `VITE_API_URL=/api` (or leave unset, since `/api` is the default) |

Deploy, then put the final Vercel URL into Render's `CLIENT_ORIGIN` and redeploy Render. That's the URL in reset and "password changed" emails.

**Fallback if streaming answers don't come through the rewrite** (they arrive all at once or time out): let the browser call Render directly.
- Vercel: `VITE_API_URL=https://<service>.onrender.com/api`, then redeploy.
- Render: `CLIENT_ORIGIN=https://<your-app>.vercel.app` (the CORS allowlist, comma-separated if several), `COOKIE_SAMESITE=none` (the cookie becomes Secure automatically), `TRUST_PROXY=1`.
- The client already sends credentials (`withCredentials` / `credentials: 'include'`). Browsers that block third-party cookies (Safari, and Chrome with it enabled) will then drop the refresh cookie, so users are signed out on reload. That's why the rewrite is the default.

### 5. Keep it awake (UptimeRobot)

Add an **HTTP(s)** monitor for `https://<service>.onrender.com/api/health` with a **10-minute** interval. Each ping runs `SELECT 1` on Supabase, which also stops the free project from pausing after a week of inactivity. One always-on free service uses about 744 of Render's 750 free hours a month.

### 6. Make yourself admin

Register in the deployed app, then in Render open **Shell** for the service:

```bash
node scripts/makeAdmin.js you@example.com          # --revoke to undo
```

### Using Neon instead of Supabase

Same steps: paste Neon's pooled connection string as `DATABASE_URL`, and keep `DB_SSL=require`.

## OpenAI, budget and cost control

All settings live in `server/.env` (see [server/.env.example](server/.env.example)).

- **Models:** `OPENAI_CHAT_MODEL=gpt-5-mini` handles chat answers, quizzes, questions and final summaries. `OPENAI_CHEAP_MODEL=gpt-5-nano` handles the outline, the map step and the classifier. `OPENAI_EMBED_MODEL=text-embedding-3-small` at `EMBED_DIMENSIONS=1536`. These are reasoning models: requests use `reasoning_effort` (`OPENAI_REASONING_EFFORT=low` for mini, `OPENAI_REASONING_EFFORT_CHEAP=minimal` for nano), `max_completion_tokens`, and no temperature. Reasoning tokens are billed as output and count toward the caps.
- **Empty-output recovery** ([llmService.js](server/src/services/llmService.js)): if reasoning uses the whole cap and returns no text, the call is retried once with `minimal` effort and 1.5× the cap. Long notes cut off mid-way are continued up to 2 times and stitched. Refusals and still-empty results show a friendly "Couldn't generate this right now". Every anomaly is logged.
- **Cost is admin-only:** users never see money. At the cap they see "Generation is temporarily unavailable".
- **Hard budget:** `LLM_BUDGET_USD=1.20`. Before every paid call, [budgetService.js](server/src/services/budgetService.js) reserves the worst case (counted input tokens + the feature's max output at [pricing.js](server/src/config/pricing.js) prices). The call is refused with **402 "Budget limit reached"** if spent + reserved + estimate would exceed the cap. Afterwards the API's actual `usage` is recorded in `llm_usage`, and spend is reloaded from there at startup. A warning log and app-wide banner appear at `BUDGET_WARN_PCT` (75%). One server instance only: reservations are in memory.
- **⚠️ Verify the prices** in `server/src/config/pricing.js` against https://openai.com/api/pricing. Unpriced models are refused.
- **Output caps** (`MAX_OUTPUT_TOKENS_*`): chat 2000, questions 4000, quiz 4000, Detailed Notes 12000, other summary modes 4000, map step 1500. Per-request limits are sized to fit them: short/conceptual questions 15, long 6, quiz 12.
- **Cost rules:** a PDF already uploaded (same sha256) is never re-embedded. Summaries, question sets and quizzes are cached in Postgres and reused until you click Regenerate, which is marked "uses credits". Chat uses top-5 chunks, the last 4 turns and ≤6k tokens of sources; quiz/questions use ≤8k tokens of context; summaries use nano for the map step over 8k-token groups. Stable content goes first in every prompt, plus `prompt_cache_key`, so OpenAI prompt caching can apply (it only kicks in for prefixes ≥1024 tokens).
- **Usage & estimates:** the admin page's Usage & Budget tab shows spend by feature/model/day, recent calls, and estimated cost per operation computed from the pricing table.

## Logging, change log and admin portal

- **Logger:** [server/src/utils/logger.js](server/src/utils/logger.js) is a singleton; every module uses `logger.child({ module })`, and nothing logs with `console.*`. Entries carry timestamp, level, module, message, requestId, userId, meta and durationMs. Output is pretty in dev and JSON in production, and entries are batch-inserted into `app_logs` every 2 s or 50 entries, never blocking a request. Secrets are redacted. `LOG_LEVEL` (default `info`); `LOG_RETENTION_DAYS` (default 14) is pruned at startup and daily.
- **Request IDs:** every response has `X-Request-Id`, and every log line and `llm_usage` row from that request (including background ingestion) carries it.
- **Change log:** `audit_logs` records create/update/delete of users, documents, question sets, quizzes and attempts, as minimal `{ before, after }` diffs (never password hashes or file contents).
- **Admin portal:** run `npm run make-admin -- you@example.com`, then reload. A **Logs** link appears with three tabs: Live Logs (live tail with pause, plus a search with filters and one-click request tracing), Change Log, and Usage & Budget. Revoke with `--revoke`.

## Exports

From the notes card, the Questions tab, quiz results, or **Export all** on a document: **PDF** (cover, contents, page numbers, highlighted code, callouts), **Markdown**, or **Email PDF to me**. Quizzes can be exported as questions only, with an answer key, or as your attempt. Exports never call the AI. They're rendered with Puppeteer, which downloads its own Chrome on `npm install`; on Linux servers you may need Chrome's system libraries.

## Email

`EMAIL_PROVIDER` picks the transport: `brevo`, `resend` (HTTPS APIs, used in production, see Deploy), `smtp` (Gmail, local), or `console` (log only). The default is `smtp` when `SMTP_HOST` is set, else `console`.

Gmail SMTP for local use:

1. Turn on 2-Step Verification for the Google account.
2. Create an App Password at https://myaccount.google.com/apppasswords.
3. In `server/.env`, set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<16-character app password>`, optionally `MAIL_FROM="NotesAnalyser <you@gmail.com>"`, then restart.

When email isn't configured, emails are written to the server log instead (outside production, including reset codes), and "Email PDF" explains that email isn't set up.

## Account & sessions

Login uses a short-lived access token (`ACCESS_TOKEN_TTL`, 15 min, kept in memory) and an httpOnly refresh cookie (`na_rt`, path `/api/auth`). The cookie rotates on every refresh, and reusing an old one revokes the session. **Forgot password** (`/forgot-password`) emails a 6-digit code that is valid for 10 minutes, allows 5 attempts and is single-use. A successful reset signs out every device.

Each login creates a session (device). On **Account** (click your name) you can change your password and see active sessions, then log out one device, all other devices, or everywhere. Changing the password signs out other devices and sends a notice email. At most `MAX_SESSIONS_PER_USER` (5) sessions are kept.

## Database

Schema: [server/src/db/schema.js](server/src/db/schema.js). The migrations in [server/drizzle/](server/drizzle/) are committed.

| Table | Purpose |
|---|---|
| `users` | accounts (`email` unique, bcrypt `password_hash`) |
| `documents` | uploaded PDFs: status `processing \| ready \| failed`, cached summaries (`summary_brief/detailed/bullet`) and map-step `summary_notes` |
| `chunks` | text chunks + `embedding vector(768)`, `page`–`page_end` range |
| `quizzes`, `quiz_questions`, `quiz_document` | generated quizzes (`cache_key` = hash(document set, difficulty, count, topic)), their questions with `source_page`/`source_document_id`, and the documents they cover |
| `quiz_attempts` | submitted answers and scores |
| `generated_questions` | cache of practice questions, bucketed by `cache_key` = hash(document set, type, topic) |

Every table has UUID primary keys and `created_at`/`updated_at`. Deleting a user or a document cascades to the rows that depend on it.

**Vector index:** `chunks_embedding_hnsw_idx` is an HNSW index using `vector_cosine_ops`, created by the migration. Retrieval orders by cosine distance (`<=>`), filtered by `user_id` and optionally `document_id`. There's nothing to set up by hand.

**Changing the embedding size:** `EMBED_DIMENSIONS` is baked into the migration when it's generated. To change it, set the new value, run `npm run db:generate && npm run db:migrate`, and re-upload your documents. The server checks at startup that the column size matches `EMBED_DIMENSIONS` and refuses to start if they differ.

Other scripts: `npm run db:down` stops Docker Postgres (data is kept in the `pgdata` volume). `npm run db:studio --prefix server` opens Drizzle Studio.

## Environment variables (`server/.env`)

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no | Default `5001`. Port 5000 is used by macOS AirPlay Receiver. |
| `CLIENT_ORIGIN` | no | The client's URL: CORS allowlist (comma-separated) and the base for links in emails. Default `http://localhost:5173`. |
| `TRUST_PROXY` | no | Number of reverse-proxy hops (`2` for Vercel rewrite + Render, `1` for Render direct). Default `0`. |
| `DATABASE_URL` | yes | Postgres connection string |
| `DB_SSL` / `DB_SSL_CA` / `DB_POOL_MAX` | no | `auto` (default: no SSL for local hosts, SSL elsewhere), `off`, `require` or `verify` (with a CA PEM). Pool size default 5. |
| `SERVE_CLIENT` | no | `true` = Express also serves `client/dist`. Default `false`. |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_DAYS` | no | `15m` / `30` |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | no | `lax` (default) or `none` (fallback mode, forces Secure). Secure defaults to on in production. |
| `OTP_TTL_MINUTES` / `OTP_MAX_ATTEMPTS` / `OTP_RESEND_SECONDS` | no | `10` / `5` / `60` |
| `EMAIL_PROVIDER` | no | `brevo`, `resend`, `smtp` or `console` (see Email) |
| `BREVO_API_KEY` / `RESEND_API_KEY` / `MAIL_FROM` | for email | `MAIL_FROM` must be a verified sender |
| `JWT_SECRET` | yes | 32+ characters. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `EMBED_DIMENSIONS` | no | Default `768`. Must match the migrations (see above). |
| `OPENAI_API_KEY` | yes | OpenAI key (default provider) |
| `OPENAI_CHAT_MODEL` / `OPENAI_CHEAP_MODEL` / `OPENAI_EMBED_MODEL` | yes | `gpt-5-mini` / `gpt-5-nano` / `text-embedding-3-small` |
| `LLM_BUDGET_USD` / `BUDGET_WARN_PCT` | no | Hard spend cap (default 1.20) and warning threshold (75) |
| `MAX_OUTPUT_TOKENS_*` | no | Per-feature output caps (see above) |
| `LLM_MOCK` | no | `true` = canned offline responses + offline embeddings ($0) |
| `LOG_LEVEL` / `LOG_RETENTION_DAYS` | no | `info` / `14` |
| `GEMINI_API_KEY` | if gemini | |
| `GEMINI_CHAT_MODEL` | phase 2+ | Model names are read only from env. |
| `GEMINI_EMBED_MODEL` | phase 2+ | Must support `outputDimensionality = EMBED_DIMENSIONS`. |
| `LLM_MAX_CONTEXT_TOKENS` / `LLM_MAX_OUTPUT_TOKENS` | no | Prompt budgets. A ~15% safety margin is applied. |
| `EMBED_PROVIDER` | no | `openai` (default), `gemini`, or `hash` (an offline lexical embedder for testing). Re-ingest documents after switching. |
| `EMBED_BATCH_SIZE` | no | Texts per `batchEmbedContents` call (max 100). Default 100. |
| `EMBED_RPM` / `EMBED_TPM` | no | Pacing for the embedding queue. Defaults 60 / 25000 are conservative; set them to your tier's limits (AI Studio → Rate limits). |
| `LLM_PROVIDER` | no | `openai` (default; any OpenAI-compatible API via `OPENAI_BASE_URL`), `gemini`, or `mock` (offline). |
| `GEMINI_THINKING_BUDGET` | no | Unset = model default. `0` turns thinking off on models that allow it: faster, uses less quota. |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_CHAT_MODEL` | if `openai` | e.g. Groq: `OPENAI_BASE_URL=https://api.groq.com/openai/v1` |
| `LLM_RPM` / `LLM_TPM` / `LLM_CONCURRENCY` | no | Pacing for chat/generation calls. Defaults 10 / 200000 / 2. |

| `GENERATION_CONTEXT_TOKENS` | no | Source text sent per practice-question or quiz generation call. Default 16000. |
| `SUMMARY_GROUP_TOKENS` | no | Document text per summary map call. Default 50000; capped by the context budget. Bigger means fewer calls. |

Empty values (`KEY=`) count as unset, so defaults apply.

### Switching to Groq (or another OpenAI-compatible API)

Set `LLM_PROVIDER=openai`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1`, `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL`, and lower `LLM_MAX_CONTEXT_TOKENS` to that model's context window. Groq has no embeddings endpoint, so keep `EMBED_PROVIDER=gemini`. No code changes are needed.

The server checks the env at startup and exits with a clear message if something is missing. It also refuses to start if the database hasn't been migrated.

## Ingestion pipeline

`POST /api/documents/upload` saves a `documents` row with `status: processing`, returns `202` straight away, and queues the file. Documents are processed **one at a time** by an in-process queue:

1. **Parse** ([pdfService.js](server/src/services/pdfService.js)): `pdf-parse` v2 (modern pdf.js) reads per-page text, and paragraph breaks are inferred from line lengths.
2. **Clean**: Unicode normalisation, collapsed whitespace, joined line-end hyphens, removal of page numbers and of header/footer lines that repeat on at least half the pages (minimum 3), and unwrapped hard line breaks (list items are kept on their own lines).
3. **Chunk** ([chunker.js](server/src/services/chunker.js)): page-aware. Chunks break at page boundaries (one per page or slide; pages under 20 tokens merge into a neighbour), long pages split at ≤800 tokens on paragraph/sentence boundaries with ≤100 tokens of overlap, and no chunk spans more than 2 pages. Each chunk records its page range. Tested by `npm test --prefix server`.
4. **Embed** ([embeddingService.js](server/src/services/embeddingService.js)): batches of up to `EMBED_BATCH_SIZE` texts, capped by the token budget, with task type `RETRIEVAL_DOCUMENT` and `outputDimensionality = EMBED_DIMENSIONS`. All embedding calls share one queue paced by `EMBED_RPM`/`EMBED_TPM`. A 429 or 5xx is retried with exponential backoff and jitter, honouring Gemini's `retryDelay` hint. Daily-quota errors fail fast.
5. **Store** ([vectorStore.js](server/src/services/vectorStore.js)): the chunks are inserted and the document marked `ready` in one transaction. Any error marks the document `failed` with a readable reason.

Scanned or image-only PDFs fail with "No extractable text found" (there's no OCR). Token counts are `js-tiktoken` (o200k) estimates, since Gemini's tokenizer differs.

Retrieval ([ragService.js](server/src/services/ragService.js)) embeds the query with `RETRIEVAL_QUERY`, using a priority slot that jumps ahead of background ingestion, then runs `ORDER BY embedding <=> query LIMIT k` filtered by `user_id` (and optionally `document_id`). It turns on pgvector's `hnsw.iterative_scan`, so filtering never returns fewer than k rows when more matches exist.

## Chat (RAG)

**Intent routing:** each message is classified as a *lookup* (specific question → top-k retrieval) or *document-wide* ("explain my notes in detail" → the whole document if it fits `CHAT_FULLDOC_TOKENS`, otherwise the saved detailed summary plus representative chunks). Keyword heuristics decide almost every message; only topic-less messages like "explain it" go to gpt-5-nano.

**Re-index (admins only):** uploaded PDFs are stored (`server/storage/`, git-ignored), so admins see a **Re-index** button on a document that re-chunks and re-embeds it after a confirmation; normal users don't see it. Documents uploaded before files were stored need the same PDF uploaded once more; that attaches the file to the existing document.

`POST /api/chat { question, documentIds?, history? }` (an empty `documentIds` means all of your ready documents):

1. **Retrieve** the top 6 chunks. For a follow-up, the query also includes your previous question, so "why?" still finds the right chunks. This avoids a second LLM call to rewrite the query.
2. **Fit to budget** ([ragService.js](server/src/services/ragService.js)): system prompt, sources (in rank order), then as much recent history as fits (up to 4000 tokens). All of it stays within `LLM_MAX_CONTEXT_TOKENS − LLM_MAX_OUTPUT_TOKENS`, minus a 15% margin.
3. **Generate** with [prompts/chat.js](server/prompts/chat.js): answer only from the sources, cite them as `[S1]`, and if the answer isn't there reply "I couldn't find this in your notes." If nothing is retrieved, no LLM call is made.
4. **Citations**: the `[S#]` tags in the answer are mapped back to document and page range.

With `Accept: text/event-stream` the response is SSE:

```
event: sources  data: {"sources":[{"tag":"S1","documentId","filename","page","pageEnd","score","snippet"}]}
event: token    data: {"text":"The Calvin cycle "}        (repeated)
event: done     data: {"answer","citations":[...],"finishReason":"stop|length|safety|other"}
event: error    data: {"message"}                          (instead of done, if generation fails)
```

Without that header you get JSON `{ answer, citations, sources, finishReason }`. Errors before streaming starts (validation, not-ready documents, rate limits) are normal JSON errors. Closing the connection cancels the generation. All AI routes (chat, summarize, questions, quiz generate) are rate-limited to 20 requests/min per user. The LLM queue does the real quota pacing.

**Prompts** live in [server/prompts/](server/prompts/), one file per feature. Edit them freely; `npm run dev` reloads on save.

## Study notes (Summary tab)

Modes: **Brief**, **Detailed Notes** (default), **Exam Revision**. Pipeline ([summaryService.js](server/src/services/summaryService.js), prompts in [prompts/summarize.js](server/prompts/summarize.js)):

1. **Text:** the whole document if it's ≤ `SUMMARY_SINGLE_CALL_TOKENS` (60k), otherwise map-reduce notes (nano map, cached).
2. **Outline:** gpt-5-nano lists every topic in order with pages; cached on the document.
3. **Notes:** gpt-5-mini writes the chosen mode using the outline's exact titles as sections. Detailed and Exam have a 5000-token cap.
4. **Coverage check:** every outline topic must have its own section. Missing ones are written in one extra call from their own pages and inserted before Key takeaways. The UI shows "Coverage: n/n topics".
5. **Cache:** per mode on the document. Generate and Regenerate show the estimated cost first (`GET /api/summarize/estimate`).

Examples the AI writes itself are labelled **Example (added)**; examples from the notes are labelled **Example (from notes, p. N)**.

## Summaries (map-reduce)

`POST /api/summarize { documentIds, mode: "brief" | "detailed" | "bullet", refresh? }` returns `{ summaries: [{ documentId, filename, mode, summary, cached }] }`. Summaries don't use top-k retrieval; they cover the whole document ([summaryService.js](server/src/services/summaryService.js)):

1. The document's chunks are joined in reading order with the chunk overlap removed and `[p. N]` markers kept.
2. **Fits in one call** (≤ `SUMMARY_GROUP_TOKENS`): the summary is written straight from the text, 1 LLM call per mode.
3. **Larger**: the text is split into big groups. Each group gets a **map** call that extracts dense notes with page refs, and the combined notes are **cached** in `documents.summary_notes`. Each mode is then one **reduce** call over the notes, so a second or third mode costs just 1 call. If the notes are still too long, they're **collapsed** (re-condensed) until they fit.
4. The result is cached in the document's `summary_<mode>` column. Repeat requests return `cached: true` with no LLM call. `refresh: true` regenerates, including the map step. Concurrent identical requests share one generation.

The UI loads cached summaries automatically and only generates new ones when you click **Generate**, to protect free-tier quota. Prompts are in [prompts/summarize.js](server/prompts/summarize.js). Every LLM call is logged as `[llm] <provider> <label>: ~N prompt tokens, Xms`, so you can see quota use.

## Practice questions and quizzes

**Choosing context** ([generationContext.js](server/src/services/generationContext.js)): with a `topic`, the 14 most relevant chunks are retrieved. Without one, chunks are **sampled evenly** across each document. Every document gets a share of `GENERATION_CONTEXT_TOKENS` proportional to its length, and its chunks are taken at evenly spaced positions, so a 200-page PDF isn't covered only by its first pages. "More" and new quizzes shift the sample positions, so they see different material.

**Structured output** (`generateJSON` in [llmService.js](server/src/services/llmService.js)): the zod output schemas in [schemas/generation.js](server/src/schemas/generation.js) are converted to JSON Schema and sent as Gemini `responseSchema` with `responseMimeType: "application/json"`, or as OpenAI `json_schema` (strict). For OpenAI-compatible models without `json_schema`, it falls back to `json_object` with the schema in the prompt. The reply is validated with zod (quiz options must be 4 distinct answers). On invalid output it **retries once**, showing the model the validation error. A truncated reply fails fast with "try fewer questions".

**Questions** `POST /api/questions { documentIds, type: short|long|conceptual, count, topic?, more? }` returns `{ questions: [{ id, question, answer, sourcePage, documentId, filename }], generated, cached }`. It returns every saved question for that document set, type and topic. New ones are generated only when fewer than `count` are saved, or when `more: true`. The existing questions are passed to the model to avoid repeats.

**Quizzes**
- `POST /api/quiz/generate { documentIds, difficulty: easy|medium|hard, count (3–20), topic?, fresh? }` returns `{ quiz, cached }`. A saved quiz with identical settings is reused unless `fresh: true`. **Options are shuffled server-side**, because LLMs tend to put the right answer first. The response never includes `correctIndex` or explanations.
- `GET /api/quiz/:id` returns the quiz without answers.
- `POST /api/quiz/:id/submit { answers: (0–3 | null)[] }` returns `{ attempt: { id, score, total, results: [{ question, options, selectedIndex, correctIndex, correct, explanation, sourcePage, sourceFilename }] } }` and saves the attempt.
- `GET /api/quiz/attempts/:attemptId` returns the same results again, for the results page.
- `GET /api/quiz/history` returns `{ attempts: [{ id, quizId, score, total, difficulty, topic, documents, createdAt }], stats: { attempts, avgPercent } }`.

Prompts: [prompts/questions.js](server/prompts/questions.js), [prompts/quiz.js](server/prompts/quiz.js) and [prompts/sources.js](server/prompts/sources.js) (how sources are shown to the model, shared with chat).

## Testing retrieval

```bash
# Check parsing/cleaning/chunking of a PDF. No DB or API calls.
npm run inspect:pdf --prefix server -- path/to/notes.pdf --show 3 --page 2

# After uploading in the app: list your documents, then query them
npm run test:retrieval --prefix server -- --email you@example.com
npm run test:retrieval --prefix server -- --email you@example.com "what is the calvin cycle?"
npm run test:retrieval --prefix server -- --email you@example.com --doc <documentId> --k 3 --full "question"
```

The output shows score (cosine similarity), filename, page range and a snippet of each top-k chunk.

## API

| Method | Route | Body | Auth |
|---|---|---|---|
| GET | `/api/health` | – | – |
| POST | `/api/auth/register` | `{ name, email, password }` | – |
| POST | `/api/auth/login` | `{ email, password }` | – |
| GET | `/api/auth/me` | – | Bearer |
| POST | `/api/documents/upload` | multipart, field `files` (1–10 PDFs, 20 MB each) → `202 { documents }` | Bearer |
| GET | `/api/documents` | → `{ documents: [{ id, filename, status, pageCount, chunkCount, error, progress, summaries: { brief, detailed, bullet } }] }` (`summaries` = which modes are cached) | Bearer |
| GET | `/api/documents/:id` | → `{ document }` | Bearer |
| DELETE | `/api/documents/:id` | → `204` (its chunks are deleted too) | Bearer |
| POST | `/api/summarize` | `{ documentIds, mode, refresh? }` → `{ summaries }` | Bearer |
| POST | `/api/questions` | see above | Bearer |
| POST | `/api/quiz/generate` · GET `/api/quiz/:id` · POST `/api/quiz/:id/submit` · GET `/api/quiz/attempts/:attemptId` · GET `/api/quiz/history` | see above | Bearer |
| GET | `/api/admin/logs` · `/api/admin/logs/stream` (SSE) · `/api/admin/audit` · `/api/admin/usage` | filters: level, module, requestId, userId, from, to, q / entity, action, userId | Admin |
| GET | `/api/budget/status` | → `{ level: ok\|warn\|exhausted, pct }` (plus amounts for admins) | Bearer |
| POST | `/api/chat` | `{ question, documentIds?, history?: [{ role, content }] }` → SSE or JSON (see above) | Bearer |

`progress` is `{ stage: queued|parsing|chunking|embedding|saving, done?, total? }` while a document is processing. It's kept in memory only: if the server restarts, unfinished documents are marked `failed` and need re-uploading.

Errors always look like `{ "error": { "message": "...", "details"?: [{ "path", "message" }] } }`.

## Frontend notes

- **Code splitting:** Study, Quiz, Results and History are lazy-loaded, so the Markdown renderer and quiz UI download only when needed (first load ≈125 kB gzipped JS).
- **Resilience:** each page renders inside an error boundary, so one failing page doesn't blank the app. A missing chunk after a redeploy shows "A new version is available → Reload". Expired sessions get a toast and a redirect to login, and going offline shows a persistent notice.
- **Accessibility:** a skip-to-content link; focus moves to the page on navigation; page titles per route; tabs, segmented controls and the theme switcher are WAI-ARIA tablist/radiogroup with arrow/Home/End keys and a roving tabindex; quiz options can also be answered with the 1–4 / A–D keys; text contrast meets WCAG AA in both themes. The pages were checked with axe-core (WCAG 2.1 A/AA + best practices) in light and dark mode.
- **State that survives reloads:** chat history per document set, and in-progress quiz answers and position, live in `sessionStorage` (best-effort).

## Theming

Light, Dark and System themes; System is the default and follows the OS setting. The choice is saved in `localStorage` under `na_theme`. A blocking script, `client/public/theme-init.js`, applies the `dark` class before React loads, so there's no white flash on reload. Design tokens (`card`, `input`, `btn-*`, `chip`, `option-*`, `progress-*`, `dropzone`, `skeleton`) are defined as Tailwind utilities in [client/src/index.css](client/src/index.css).

## Project layout

```
docker-compose.yml   local Postgres + pgvector
client/              React app: pages/, components/ (chat/, quiz/), api/, context/, hooks/
  public/            favicon, theme-init.js (pre-paint theme)
server/
  drizzle/           committed SQL migrations
  src/config         env validation, DB startup checks
  src/db             Drizzle schema + client
  src/middleware     auth, zod validation, rate limits, error handler
  src/routes         Express routers
  src/controllers    request handlers
  src/schemas        zod schemas
  src/services       RAG pipeline, llmService + providers/ (gemini, openaiCompatible, mock)
  prompts/           one file per LLM prompt; edit these to tune behaviour
  scripts/           migrate.js, inspectPdf.js, testRetrieval.js
  src/utils          tokens (estimates), retry/backoff, RateQueue (pacing), SSE, JSON-schema converters
```
