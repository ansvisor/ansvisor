import supabaseAdmin from '../../config/supabase.js';
import { chatAgenticEnabled } from '../chat-flag.js';
import logger from '../logger.js';
import { appUrl } from '../pulse/engine.js';
import { dropMessage } from './blocks/drop.js';
import { brandSlack } from './connection.js';
import { deliverToSlack } from './deliver.js';

/**
 * Drop alerts in a brand's Slack channel (#2139, N4): when the brand's
 * visibility or citation rate fell beyond normal swing, as Why did it move
 * (W2-18, web lib/chat/why/explain.ts) counts it, over the last 7 complete
 * days against the 7 before (explain_change's default periods).
 *
 * Owner, 2026-11-10: on the prompts tracked in both weeks only (the stable
 * cells: tracked in both periods with at least MIN_RUNS runs in each, on the
 * engines tracked in both), so a prompt or an engine added or dropped is no
 * drop; at most one alert per metric per brand per 7 days.
 *
 * The rule is explain.ts's, ported (keep the two in step): a rate's change is
 * beyond normal swing when it is more than 2 × its standard error, the SE
 * from the pooled rate of the two periods, √(p(1−p)(1/Na + 1/Nb)), in points.
 * Visibility counts a prompt (its engines together) as visible when it was
 * named or cited at all in the period; the citation rate is answers citing
 * the brand's pages over answers, per prompt × engine × location.
 *
 * Runs after a brand's full daily tracking run (job-runner.js), beside the
 * Pulse. Reads chat_why_cells (00423) only for a brand that posts drop
 * alerts to a channel; the post goes through deliver.js, which checks the
 * rest. Never throws.
 */

export const DROP_METRICS = Object.freeze(['visibility', 'citations']);
/** Days each period has: the last 7 complete days against the 7 before. */
export const PERIOD_DAYS = 7;
/** Runs a cell needs in each period to count (explain.ts MIN_RUNS). */
export const MIN_RUNS = 3;
/** One alert per metric per brand in this many days. */
export const COOLDOWN_DAYS = 7;
/** ChatGPT Shopping isn't comparable to an answer (#155), as Why leaves it out. */
const LEFT_OUT_PLATFORMS = new Set(['chatgpt-shopping']);

const DAY_MS = 86_400_000;
const isoDay = (at) => new Date(at).toISOString().slice(0, 10);

/** The last 7 complete UTC days (b) and the 7 before (a). */
export function dropPeriods(now = Date.now()) {
  const yesterday = Date.parse(`${isoDay(now)}T00:00:00Z`) - DAY_MS;
  return {
    a: {
      from: isoDay(yesterday - (2 * PERIOD_DAYS - 1) * DAY_MS),
      to: isoDay(yesterday - PERIOD_DAYS * DAY_MS),
    },
    b: { from: isoDay(yesterday - (PERIOD_DAYS - 1) * DAY_MS), to: isoDay(yesterday) },
  };
}

const n = (value) => Number(value) || 0;
const engineOf = (row) => row.model_used ?? row.platform ?? 'unknown';

/** A metric's count over what it counts in, for one cell's period (explain.ts ratioOf). */
function ratioOf(metric, c) {
  return metric === 'visibility'
    ? { num: c.visibleRuns > 0 ? 1 : 0, den: c.runs > 0 ? 1 : 0 }
    : { num: c.citationAnswers, den: c.answers };
}

/**
 * The change's standard error, in points (explain.ts changeSe for a rate):
 * null when either period counts nothing.
 */
export function changeSe(a, b) {
  const denA = a.reduce((s, p) => s + p.den, 0);
  const denB = b.reduce((s, p) => s + p.den, 0);
  if (denA <= 0 || denB <= 0) return null;
  const p = (a.reduce((s, x) => s + x.num, 0) + b.reduce((s, x) => s + x.num, 0)) / (denA + denB);
  const rate = Math.min(1, Math.max(0, p));
  return Math.sqrt(rate * (1 - rate) * (1 / denA + 1 / denB)) * 100;
}

const valueOf = (parts) => {
  const den = parts.reduce((s, p) => s + p.den, 0);
  return den > 0 ? (parts.reduce((s, p) => s + p.num, 0) / den) * 100 : null;
};

/**
 * The metric's drop over the stable cells, or null when it didn't fall
 * beyond normal swing (or can't be measured).
 * @param {'visibility'|'citations'} metric
 * @param {object[]} rows chat_why_cells' cells
 * @returns {{ metric: string, from: number, to: number, delta: number, se: number,
 *   prompts: number, platforms: string[] } | null}
 */
export function dropOf(metric, rows) {
  const counted = rows.filter((row) => !LEFT_OUT_PLATFORMS.has(row.platform ?? ''));
  // The periods are compared on the engines tracked in both.
  const enginesIn = { a: new Set(), b: new Set() };
  for (const row of counted) if (n(row.runs) > 0) enginesIn[row.period]?.add(engineOf(row));
  const same = counted.filter(
    (row) => enginesIn.a.has(engineOf(row)) && enginesIn.b.has(engineOf(row)),
  );

  const cells = new Map();
  for (const row of same) {
    const key =
      metric === 'visibility'
        ? row.prompt_id
        : [row.prompt_id, row.platform ?? '', row.model_used ?? '', row.region ?? ''].join('|');
    const cell = cells.get(key) ?? { promptId: row.prompt_id, a: null, b: null };
    const add = {
      runs: n(row.runs),
      visibleRuns: n(row.visible_runs),
      answers: n(row.answers),
      citationAnswers: n(row.citation_answers),
    };
    const was = cell[row.period];
    cell[row.period] = was
      ? {
          runs: was.runs + add.runs,
          visibleRuns: was.visibleRuns + add.visibleRuns,
          answers: was.answers + add.answers,
          citationAnswers: was.citationAnswers + add.citationAnswers,
        }
      : add;
    cells.set(key, cell);
  }
  const stable = [...cells.values()].filter(
    (cell) =>
      cell.a &&
      cell.b &&
      cell.a.runs >= MIN_RUNS &&
      cell.b.runs >= MIN_RUNS &&
      ratioOf(metric, cell.a).den > 0 &&
      ratioOf(metric, cell.b).den > 0,
  );
  if (stable.length === 0) return null;
  const partsA = stable.map((cell) => ratioOf(metric, cell.a));
  const partsB = stable.map((cell) => ratioOf(metric, cell.b));
  const from = valueOf(partsA);
  const to = valueOf(partsB);
  const se = changeSe(partsA, partsB);
  if (from === null || to === null || se === null) return null;
  const delta = to - from;
  // explain.ts noiseOf: no change at all is within swing; more than 2 × SE is beyond it.
  if (Math.round(delta * 1e6) === 0 || delta >= 0 || Math.abs(delta) <= 2 * se) return null;
  return {
    metric,
    from,
    to,
    delta,
    se,
    prompts: new Set(stable.map((cell) => cell.promptId)).size,
    platforms: [...new Set(same.map((row) => row.platform).filter(Boolean))].sort(),
  };
}

/** The metrics alerted on within the cooldown (sent ones only: a failed post doesn't count). */
async function alertedLately(brandId, now) {
  const since = new Date(now - COOLDOWN_DAYS * DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('slack_posts')
    .select('dedupe_key')
    .eq('brand_id', brandId)
    .eq('kind', 'drop')
    .eq('status', 'sent')
    .gte('created_at', since);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => String(row.dedupe_key).split(':')[1]));
}

/**
 * The brand's drop alerts, after its daily run: for each metric that fell
 * beyond normal swing and wasn't alerted on in the last 7 days, one post.
 * What went out: { checked, posted }.
 * @param {string} brandId
 * @param {{ now?: number, deliver?: typeof deliverToSlack }} [options]
 */
export async function runSlackDrops(brandId, { now = Date.now(), deliver = deliverToSlack } = {}) {
  try {
    const { data: brand, error } = await supabaseAdmin
      .from('brands')
      .select('id, name, organization_id, is_active, is_demo')
      .eq('id', brandId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!brand?.is_active || brand.is_demo) return { checked: false, posted: 0 };
    // Only a brand that posts drop alerts to a channel is read for them.
    const slack = await brandSlack(brand.id);
    if (slack?.status !== 'connected' || !slack.settings.channel || !slack.settings.send.drops) {
      return { checked: false, posted: 0 };
    }
    const lately = await alertedLately(brand.id, now);
    const metrics = DROP_METRICS.filter((metric) => !lately.has(metric));
    if (metrics.length === 0) return { checked: false, posted: 0 };

    const periods = dropPeriods(now);
    const { data: read, error: rpcError } = await supabaseAdmin.rpc('chat_why_cells', {
      p_brand_id: brand.id,
      p_a_from: periods.a.from,
      p_a_to: periods.a.to,
      p_b_from: periods.b.from,
      p_b_to: periods.b.to,
      p_series_from: periods.b.to,
      p_models: null,
      p_region: null,
      p_topic_id: null,
    });
    if (rpcError) throw new Error(rpcError.message);
    const rows = read?.cells ?? [];

    let posted = 0;
    for (const metric of metrics) {
      const drop = dropOf(metric, rows);
      if (!drop) continue;
      const outcome = await deliver({
        brand,
        kind: 'drop',
        dedupeKey: `drop:${metric}:${periods.b.to}`,
        message: () =>
          dropMessage({
            brandName: brand.name,
            drop,
            periods,
            appUrl: appUrl(),
            askChat: chatAgenticEnabled(brand.organization_id),
            nextAfter: isoDay(now + COOLDOWN_DAYS * DAY_MS),
          }),
      });
      if (outcome.status === 'sent') posted++;
    }
    return { checked: true, posted };
  } catch (err) {
    logger.error(
      { brandId, err: { name: err?.name, code: err?.code ?? null } },
      '[slack] drop check failed',
    );
    return { checked: false, posted: 0, error: true };
  }
}
