// LLM spend guard (singleton). Every paid call goes through reserve() -> provider call -> settle().
//
//  reserve(): worst-case cost = counted input tokens + max output tokens at list price. Refuses with
//             402 ("Generation is temporarily unavailable") if spent + already-reserved + estimate > LLM_BUDGET_USD.
//             Reservations stop concurrent requests from overshooting together.
//  settle():  records the actual usage (from the API's usage field) in llm_usage and frees the reservation.
//  release(): frees a reservation when the call failed before anything was billed.
//
// Spend is the sum of llm_usage.cost_usd (loaded at startup), so the cap survives restarts.
// Single-process: run one server instance, or move reservations into the database.
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { llmUsage } from '../db/schema.js';
import { env } from '../config/env.js';
import { costUsd, priceFor } from '../config/pricing.js';
import { AppError } from '../utils/AppError.js';
import { getContext } from '../utils/requestContext.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'budget' });
const round = (n) => Math.round(n * 1e6) / 1e6;

class BudgetService {
  static #instance;
  #spent = 0;
  #reserved = 0;
  #loaded = false;
  #warned = false;

  static getInstance() {
    BudgetService.#instance ??= new BudgetService();
    return BudgetService.#instance;
  }

  constructor() {
    if (BudgetService.#instance) throw new Error('BudgetService is a singleton: use BudgetService.getInstance()');
  }

  /** Loads spend from llm_usage. Tests may pass { spentUsd } to start without a database. */
  async init({ spentUsd } = {}) {
    if (spentUsd === undefined) {
      const [row] = await db.select({ total: sql`coalesce(sum(${llmUsage.costUsd}), 0)`.mapWith(Number) }).from(llmUsage);
      this.#spent = row.total;
    } else this.#spent = spentUsd;
    this.#loaded = true;
    this.#warned = this.#pct() >= env.BUDGET_WARN_PCT;
    log.info('budget loaded', { spentUsd: round(this.#spent), budgetUsd: env.LLM_BUDGET_USD, pct: Math.round(this.#pct()) });
    if (this.#warned) log.warn('LLM spend is past the warning threshold', this.status());
  }

  #pct() {
    return (this.#spent / env.LLM_BUDGET_USD) * 100;
  }

  /** Price entry or a fail-closed error for unpriced paid models. */
  priceOrThrow(model) {
    const price = priceFor(model);
    if (!price) {
      throw new AppError(500, `No price for model "${model}" in server/src/config/pricing.js; refusing the call so the budget can't be exceeded.`);
    }
    return price;
  }

  /** Worst-case cost of a call in USD. */
  estimate({ model, inputTokens, maxOutputTokens }) {
    return costUsd(this.priceOrThrow(model), { inputTokens, outputTokens: maxOutputTokens });
  }

  /** @returns {{ model, estimate, feature }} reservation to pass to settle/release */
  reserve({ model, inputTokens, maxOutputTokens, feature }) {
    if (!this.#loaded) throw new AppError(503, 'Budget not initialised yet');
    const estimate = this.estimate({ model, inputTokens, maxOutputTokens });
    const remaining = env.LLM_BUDGET_USD - this.#spent - this.#reserved;
    if (estimate > remaining) {
      log.warn('budget limit reached: call refused', {
        feature,
        model,
        estimateUsd: round(estimate),
        spentUsd: round(this.#spent),
        reservedUsd: round(this.#reserved),
        budgetUsd: env.LLM_BUDGET_USD,
      });
      // No money in the user-facing message; amounts are in the log line above and in admin Usage & Budget.
      throw new AppError(402, 'Generation is temporarily unavailable. Please try again later.');
    }
    this.#reserved += estimate;
    return { model, estimate, feature };
  }

  release(reservation) {
    if (!reservation) return;
    this.#reserved = Math.max(0, this.#reserved - reservation.estimate);
  }

  /**
   * @param reservation from reserve()
   * @param usage {{ inputTokens, cachedTokens?, outputTokens }} actual tokens from the API
   * @param opts {{ estimated?: boolean }} true when the provider gave no usage (aborted stream)
   * @returns {Promise<number>} cost in USD
   */
  async settle(reservation, usage, { estimated = false } = {}) {
    this.release(reservation);
    const cost = costUsd(this.priceOrThrow(reservation.model), usage);
    this.#spent += cost;
    const ctx = getContext();
    try {
      await db.insert(llmUsage).values({
        userId: ctx.userId ?? null,
        requestId: ctx.requestId ?? null,
        feature: reservation.feature ?? 'other',
        model: reservation.model,
        inputTokens: usage.inputTokens ?? 0,
        cachedTokens: usage.cachedTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        costUsd: cost,
        estimated: estimated ? 1 : 0,
      });
    } catch (err) {
      log.error('failed to record llm_usage (spend still counted in memory)', { err });
    }
    if (!this.#warned && this.#pct() >= env.BUDGET_WARN_PCT) {
      this.#warned = true;
      log.warn(`LLM spend passed ${env.BUDGET_WARN_PCT}% of the budget`, this.status());
    }
    return cost;
  }

  status() {
    const pct = this.#pct();
    const remaining = env.LLM_BUDGET_USD - this.#spent - this.#reserved;
    return {
      budgetUsd: env.LLM_BUDGET_USD,
      spentUsd: round(this.#spent),
      reservedUsd: round(this.#reserved),
      remainingUsd: round(Math.max(0, env.LLM_BUDGET_USD - this.#spent - this.#reserved)),
      pct: Math.round(pct * 10) / 10,
      warnPct: env.BUDGET_WARN_PCT,
      // "exhausted" once there isn't enough left for a typical call (~half a cent), not only at exactly 100%.
      level: remaining < 0.005 ? 'exhausted' : pct >= env.BUDGET_WARN_PCT ? 'warn' : 'ok',
    };
  }
}

const budgetService = BudgetService.getInstance();
export { BudgetService };
export default budgetService;
