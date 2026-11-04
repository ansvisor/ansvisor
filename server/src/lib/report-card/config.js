/**
 * The free AI visibility report card's limits (Customer priorities §5;
 * owner decisions 2026-11-02), each from the environment so they change
 * without a deploy of code: 200 cards a day, $200 a month, one card per
 * company every 30 days, a few requests an hour from one address.
 *
 * The cost of an engine's answer and of the keyword call are estimates, kept
 * here too, until the provider contract confirms them; a card's real model
 * cost is counted from each call's tokens.
 */

/**
 * Questions on a card (owner decisions 2026-11-04): the question writer
 * drafts CANDIDATE_QUESTIONS; those that match the site weakly are never
 * asked; QUESTION_MAX are kept, the core ones first and related ones to
 * fill. A card left with fewer than CHECK_BELOW questions is still made and
 * sent, flagged for staff to check by hand.
 */
export const QUESTION_MAX = 25;
export const CANDIDATE_QUESTIONS = 40;
export const CHECK_BELOW = 10;
/** Engines a card asks each question in (lib/report-card/engines.js). */
export const ENGINE_COUNT = 5;
/** What the caps fall back to with nothing set. */
export const DEFAULTS = Object.freeze({
  dailyCap: 200,
  monthlyBudgetUsd: 200,
  repeatDays: 30,
  ipHourly: 5,
  concurrency: 2,
  answerUsd: 0.002,
  volumeUsd: 0.075,
});
/** Where the form may post from, with nothing set. */
export const DEFAULT_ORIGINS = ['https://www.ansvisor.com', 'https://ansvisor.com'];

/** A non-negative number from the environment, or the fallback. */
function envNumber(name, fallback, env) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * The limits in force: REPORT_CARD_DAILY_CAP, REPORT_CARD_MONTHLY_BUDGET_USD,
 * REPORT_CARD_REPEAT_DAYS, REPORT_CARD_IP_HOURLY, REPORT_CARD_CONCURRENCY,
 * REPORT_CARD_ANSWER_USD and REPORT_CARD_VOLUME_USD.
 */
export function reportCardLimits(env = process.env) {
  return {
    dailyCap: Math.floor(envNumber('REPORT_CARD_DAILY_CAP', DEFAULTS.dailyCap, env)),
    monthlyBudgetUsd: envNumber('REPORT_CARD_MONTHLY_BUDGET_USD', DEFAULTS.monthlyBudgetUsd, env),
    repeatDays: envNumber('REPORT_CARD_REPEAT_DAYS', DEFAULTS.repeatDays, env),
    ipHourly: Math.floor(envNumber('REPORT_CARD_IP_HOURLY', DEFAULTS.ipHourly, env)),
    concurrency: Math.max(
      1,
      Math.floor(envNumber('REPORT_CARD_CONCURRENCY', DEFAULTS.concurrency, env)),
    ),
    answerUsd: envNumber('REPORT_CARD_ANSWER_USD', DEFAULTS.answerUsd, env),
    volumeUsd: envNumber('REPORT_CARD_VOLUME_USD', DEFAULTS.volumeUsd, env),
  };
}

/**
 * What one card is expected to cost before it runs: the most questions in
 * every engine, the keyword call, and a margin for the model calls. The
 * monthly budget keeps room for the cards queued.
 */
export function estimatedCardUsd(limits = reportCardLimits()) {
  return QUESTION_MAX * ENGINE_COUNT * limits.answerUsd + limits.volumeUsd + 0.05;
}

/**
 * What one US dollar is worth in the currencies a card shows (owner
 * decision 2026-11-04): the cost per click and Ansvisor's prices are in
 * USD, so a card in another currency shows them as approximate, with the
 * rate's date. A rate set by hand, not a live feed:
 * REPORT_CARD_FX_RATES ("TRY=41.9,GBP=0.76,EUR=0.87,CAD=1.39,AUD=1.52")
 * and REPORT_CARD_FX_DATE (YYYY-MM-DD), else these.
 */
export const DEFAULT_FX = Object.freeze({
  date: '2026-11-01',
  rates: Object.freeze({ TRY: 41.9, GBP: 0.76, EUR: 0.87, CAD: 1.39, AUD: 1.52 }),
});

/** The rates in force, and their date. */
export function reportCardFx(env = process.env) {
  const rates = { ...DEFAULT_FX.rates };
  for (const pair of String(env.REPORT_CARD_FX_RATES ?? '').split(',')) {
    const [code, raw] = pair.split('=').map((part) => part?.trim());
    const value = Number(raw);
    if (/^[A-Z]{3}$/.test(code ?? '') && Number.isFinite(value) && value > 0) rates[code] = value;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(env.REPORT_CARD_FX_DATE ?? '').trim())
    ? String(env.REPORT_CARD_FX_DATE).trim()
    : DEFAULT_FX.date;
  return { rates, date };
}

/**
 * A card's currency, with what a US dollar is worth in it and when the
 * rate was set; null for US dollars, or a currency without a rate.
 */
export function cardCurrency(code, fx = reportCardFx()) {
  if (!code || code === 'USD' || !fx.rates[code]) return null;
  return { code, perUsd: fx.rates[code], asOf: fx.date };
}

/** The origins the form may post from: REPORT_CARD_ORIGINS, comma-separated. */
export function reportCardOrigins(env = process.env) {
  const listed = String(env.REPORT_CARD_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return listed.length ? listed : DEFAULT_ORIGINS;
}
