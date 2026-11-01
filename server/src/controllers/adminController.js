import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { appLogs, auditLogs, llmUsage, users } from '../db/schema.js';
import { env } from '../config/env.js';
import { PRICING, costUsd, priceFor } from '../config/pricing.js';
import { openSSE } from '../utils/sse.js';
import logger, { LEVELS } from '../utils/logger.js';
import budgetService from '../services/budgetService.js';
import { OUTPUT_CAPS } from '../services/llmService.js';

const atLeast = (level) => Object.keys(LEVELS).filter((l) => LEVELS[l] >= LEVELS[level]);
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** GET /api/admin/logs */
export async function listLogs(req, res) {
  const { level, module, requestId, userId, from, to, q, page, pageSize } = req.valid.query;
  const where = and(
    level ? inArray(appLogs.level, atLeast(level)) : undefined,
    module ? eq(appLogs.module, module) : undefined,
    requestId ? ilike(appLogs.requestId, `${escapeLike(requestId)}%`) : undefined,
    userId ? eq(appLogs.userId, userId) : undefined,
    from ? gte(appLogs.timestamp, from) : undefined,
    to ? lte(appLogs.timestamp, to) : undefined,
    q ? or(ilike(appLogs.message, `%${escapeLike(q)}%`), sql`${appLogs.meta}::text ilike ${`%${escapeLike(q)}%`}`) : undefined,
  );
  const [items, [{ total }], modules] = await Promise.all([
    db.select().from(appLogs).where(where).orderBy(desc(appLogs.timestamp), desc(appLogs.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql`count(*)::int` }).from(appLogs).where(where),
    db.selectDistinct({ module: appLogs.module }).from(appLogs).orderBy(appLogs.module),
  ]);
  res.json({ items, total, page, pageSize, modules: modules.map((m) => m.module) });
}

/** GET /api/admin/logs/stream (SSE): replays recent entries, then streams new ones live. */
export function streamLogs(req, res) {
  const allowed = new Set(atLeast(req.valid.query.level));
  const sse = openSSE(res);
  const send = (e) => allowed.has(e.level) && sse.send('log', { ...e, timestamp: e.timestamp.toISOString() });
  for (const e of logger.recent()) send(e);
  sse.send('ready', { live: true });
  const unsubscribe = logger.subscribe(send);
  res.on('close', () => {
    unsubscribe();
    sse.close();
  });
}

/** GET /api/admin/audit */
export async function listAudit(req, res) {
  const { entity, action, userId, page, pageSize } = req.valid.query;
  const where = and(
    entity ? eq(auditLogs.entity, entity) : undefined,
    action ? eq(auditLogs.action, action) : undefined,
    userId ? eq(auditLogs.userId, userId) : undefined,
  );
  const [items, [{ total }], entities] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        action: auditLogs.action,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        changes: auditLogs.changes,
        requestId: auditLogs.requestId,
        userId: auditLogs.userId,
        userEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql`count(*)::int` }).from(auditLogs).where(where),
    db.selectDistinct({ entity: auditLogs.entity }).from(auditLogs).orderBy(auditLogs.entity),
  ]);
  res.json({ items, total, page, pageSize, entities: entities.map((e) => e.entity) });
}

// ---------------------------------------------------------------- usage & cost estimates

/**
 * Worst-case and typical cost per operation from the pricing table, the output caps and the context
 * limits. Assumptions are listed so the numbers can be checked.
 */
export function estimateOperations() {
  const main = env.OPENAI_CHAT_MODEL ?? 'gpt-5-mini';
  const cheap = env.OPENAI_CHEAP_MODEL ?? main;
  const embed = env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';
  const p = (m) => priceFor(m) ?? { input: 0, cachedInput: 0, output: 0 };
  const c = (model, inputTokens, outputTokens) => costUsd(p(model), { inputTokens, outputTokens });
  const SYS = 450; // system prompt + framing tokens (approx.)
  const pages = 20;
  const tokensPerPage = 500; // typical dense lecture notes
  const docTokens = pages * tokensPerPage;
  const chunkedTokens = Math.round(docTokens * 1.19); // 150-token overlap on ~800-token chunks
  const single = docTokens <= env.SUMMARY_SINGLE_CALL_TOKENS; // whole document in one call
  const groups = single ? 1 : Math.ceil(docTokens / env.SUMMARY_GROUP_TOKENS);
  const notes = groups * OUTPUT_CAPS.summaryMap;
  const mapCost = (out) => groups * c(cheap, docTokens / groups + SYS, out);
  const reduceIn = (groups > 1 ? notes : docTokens) + SYS;
  const chatIn = env.CHAT_CONTEXT_TOKENS * 0.85 + SYS + 600; // ~5 chunks + system + short history
  const genIn = env.GENERATION_CONTEXT_TOKENS + SYS + 300;

  const ops = [
    {
      operation: `Upload a ${pages}-page PDF (embeddings)`,
      assumptions: `${docTokens.toLocaleString()} text tokens → ${chunkedTokens.toLocaleString()} with chunk overlap; ${embed}`,
      worstUsd: c(embed, chunkedTokens, 0),
      typicalUsd: c(embed, chunkedTokens, 0),
    },
    {
      operation: `Detailed Notes for that PDF (first time)`,
      assumptions: `${single ? 'whole document in one call' : `${groups} map call(s) on ${cheap} + notes`}: topic outline on ${cheap} (≤${OUTPUT_CAPS.outline} out, cached) + notes on ${main} (≤${OUTPUT_CAPS.notes} out) + missing-topic fill only if needed (≤${OUTPUT_CAPS.notesFill} out); worst case adds the fill and the rescue retry`,
      worstUsd:
        (groups > 1 ? mapCost(OUTPUT_CAPS.summaryMap) : 0) +
        c(cheap, reduceIn, OUTPUT_CAPS.outline) +
        2 * c(main, reduceIn + 400, OUTPUT_CAPS.notes) +
        c(main, Math.min(docTokens, 12000) + 600, OUTPUT_CAPS.notesFill),
      typicalUsd: (groups > 1 ? mapCost(300) : 0) + c(cheap, reduceIn, 500) + c(main, reduceIn + 400, Math.round(OUTPUT_CAPS.notes * 0.6)),
    },
    {
      operation: 'Exam Revision / Bullets / Brief (outline already saved)',
      assumptions: `1 call on ${main}: Exam ≤${OUTPUT_CAPS.notes} out, Bullets/Brief ≤${OUTPUT_CAPS.summaryReduce} out (typical shown for Exam)`,
      worstUsd: 2 * c(main, reduceIn + 400, OUTPUT_CAPS.notes),
      typicalUsd: c(main, reduceIn + 400, Math.round(OUTPUT_CAPS.notes * 0.5)),
    },
    {
      operation: 'Quiz of 10 questions',
      assumptions: `≤${env.GENERATION_CONTEXT_TOKENS.toLocaleString()} context tokens, ≤${OUTPUT_CAPS.quiz} out on ${main}; worst case includes the one allowed retry`,
      worstUsd: 2 * c(main, genIn, OUTPUT_CAPS.quiz),
      typicalUsd: c(main, genIn, 1500),
    },
    {
      operation: '10 practice questions',
      assumptions: `≤${env.GENERATION_CONTEXT_TOKENS.toLocaleString()} context tokens, ≤${OUTPUT_CAPS.questions} out on ${main}; worst case includes the retry`,
      worstUsd: 2 * c(main, genIn, OUTPUT_CAPS.questions),
      typicalUsd: c(main, genIn, 1100),
    },
    {
      operation: 'Document-wide chat ("explain my notes")',
      assumptions: `whole ${pages}-page document as sources (≤${env.CHAT_FULLDOC_TOKENS.toLocaleString()} tokens), ≤${OUTPUT_CAPS.chatLong} out on ${main}`,
      worstUsd: c(main, Math.min(chunkedTokens, env.CHAT_FULLDOC_TOKENS) + SYS + 600, OUTPUT_CAPS.chatLong),
      typicalUsd: c(main, Math.min(chunkedTokens, env.CHAT_FULLDOC_TOKENS) + SYS + 600, 900),
    },
    {
      operation: 'Chat message',
      assumptions: `top-${env.CHAT_TOP_K} chunks (≤${env.CHAT_CONTEXT_TOKENS.toLocaleString()} tokens) + last ${env.CHAT_HISTORY_TURNS} turns, ≤${OUTPUT_CAPS.chat} out on ${main}, plus query embedding`,
      worstUsd: c(main, chatIn, OUTPUT_CAPS.chat) + c(embed, 30, 0),
      typicalUsd: c(main, chatIn, 250) + c(embed, 30, 0),
    },
  ];
  const r = (n) => Math.round(n * 1e6) / 1e6;
  return {
    models: { main, cheap, embed },
    pricing: PRICING,
    operations: ops.map((o) => ({
      ...o,
      worstUsd: r(o.worstUsd),
      typicalUsd: r(o.typicalUsd),
      perBudget: o.typicalUsd > 0 ? Math.floor(env.LLM_BUDGET_USD / o.typicalUsd) : null,
    })),
  };
}

/** GET /api/admin/usage */
export async function usage(req, res) {
  const cost = sql`coalesce(sum(${llmUsage.costUsd}), 0)`.mapWith(Number);
  const calls = sql`count(*)::int`;
  const tokensIn = sql`coalesce(sum(${llmUsage.inputTokens}), 0)::int`;
  const tokensOut = sql`coalesce(sum(${llmUsage.outputTokens}), 0)::int`;
  const cached = sql`coalesce(sum(${llmUsage.cachedTokens}), 0)::int`;
  const day = sql`date_trunc('day', ${llmUsage.createdAt})`;
  const [byFeature, byModel, daily, recent] = await Promise.all([
    db.select({ feature: llmUsage.feature, costUsd: cost, calls, inputTokens: tokensIn, cachedTokens: cached, outputTokens: tokensOut }).from(llmUsage).groupBy(llmUsage.feature).orderBy(desc(cost)),
    db.select({ model: llmUsage.model, costUsd: cost, calls, inputTokens: tokensIn, cachedTokens: cached, outputTokens: tokensOut }).from(llmUsage).groupBy(llmUsage.model).orderBy(desc(cost)),
    db
      .select({ day: sql`to_char(${day}, 'YYYY-MM-DD')`, costUsd: cost, calls })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, sql`now() - interval '14 days'`))
      .groupBy(day)
      .orderBy(day),
    db
      .select({
        id: llmUsage.id,
        createdAt: llmUsage.createdAt,
        feature: llmUsage.feature,
        model: llmUsage.model,
        inputTokens: llmUsage.inputTokens,
        cachedTokens: llmUsage.cachedTokens,
        outputTokens: llmUsage.outputTokens,
        costUsd: llmUsage.costUsd,
        estimated: llmUsage.estimated,
        requestId: llmUsage.requestId,
        userEmail: users.email,
      })
      .from(llmUsage)
      .leftJoin(users, eq(users.id, llmUsage.userId))
      .orderBy(desc(llmUsage.createdAt))
      .limit(50),
  ]);
  res.json({ budget: budgetService.status(), byFeature, byModel, daily, recent, estimates: estimateOperations(), mock: env.LLM_PROVIDER === 'mock' });
}

/** GET /api/budget/status: for every signed-in user (drives the banner); amounts only for admins. */
export async function budgetStatus(req, res) {
  const s = budgetService.status();
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.user.id));
  // Users only learn whether generation is available; percentages and amounts are admin-only.
  res.json(u?.role === 'admin' ? { ...s, admin: true } : { level: s.level === 'exhausted' ? 'exhausted' : 'ok', admin: false });
}
