/**
 * Did the action help? (Action Center, validation layer — #818 phase 2.)
 *
 * An action closes when someone finishes the work. Whether the work moved
 * anything is a separate question, and until this module existed nothing
 * asked it: `outcome` read `pending_measurement` forever and History's Result
 * column had nothing to show.
 *
 * The answer comes from measuring the action's own success metrics twice —
 * over a window ending before it was raised, and a window after it closed —
 * and comparing. Both reads go through the same daily rollup functions the
 * KPI page uses, so an action's result and the dashboard that summarises the
 * same days cannot disagree.
 *
 * What it deliberately does not do:
 *  - claim causality. The metrics moved; whether this action moved them is
 *    not knowable from a before/after pair, and the UI says "measured after
 *    this action closed" rather than "because of it";
 *  - infer an outcome from task completion. Ticking six boxes is evidence of
 *    effort, not of effect;
 *  - measure what it cannot read. A metric with no data in either window is
 *    reported as unmeasured rather than as zero, because zero is a number
 *    someone will believe.
 */

import supabaseAdmin from '../../config/supabase.js';
import { computeAiVisibilityScore } from '../../config/visibility-score.js';
import { logger } from '../logger.js';
import { resolve } from '../../config/action-engine.js';

const DAY_MS = 86_400_000;

// Windows and the noise floor live in config/action-engine.js (#818 phase
// 2.5), with every other number the engine judges by.
const { validation } = resolve();

/** Length of each measurement window. Equal on both sides so the comparison
 *  is between like periods. */
export const MEASUREMENT_WINDOW_DAYS = validation.windowDays;

/**
 * How long after closing before an action can be measured.
 *
 * The "after" window runs for MEASUREMENT_WINDOW_DAYS from the day following
 * the close, and it has to be *over* before it means anything: a window still
 * in progress reads low simply because its later days have not happened, and
 * reporting that as a decline would turn every recent action into a failure.
 * The sweep uses this to filter cheaply; validateAction checks the window
 * itself, which is the condition that actually matters.
 */
export const VALIDATION_WAIT_DAYS = MEASUREMENT_WINDOW_DAYS + 1;

/**
 * How much a metric must move to count as movement, as a fraction of its
 * before value. Below this, a difference is indistinguishable from the
 * week-to-week noise every one of these metrics carries.
 */
export const MEANINGFUL_CHANGE_RATIO = validation.meaningfulChangeRatio;

/** Every metric here reads higher-is-better; a drop is a decline. */
const MEASURABLE_KPIS = {
  ai_visibility: 'percent',
  citations: 'count',
  mentions: 'count',
  share_of_voice: 'percent',
  ai_referral_traffic: 'sessions',
};

const utcDay = (date) => date.toISOString().slice(0, 10);

/** Inclusive whole-day window of `days` ending the day before `endExclusive`. */
function windowEndingBefore(endExclusive, days) {
  const to = new Date(endExclusive.getTime() - DAY_MS);
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  return { from: utcDay(from), to: utcDay(to) };
}

/** Inclusive whole-day window of `days` starting the day after `startExclusive`. */
function windowStartingAfter(startExclusive, days) {
  const from = new Date(startExclusive.getTime() + DAY_MS);
  const to = new Date(from.getTime() + (days - 1) * DAY_MS);
  return { from: utcDay(from), to: utcDay(to) };
}

async function rpc(name, brandId, from, to) {
  const { data, error } = await supabaseAdmin.rpc(name, {
    p_brand_id: brandId,
    p_platform: null,
    p_models: null,
    p_region: null,
    p_day_from: from,
    p_day_to: to,
  });
  if (error) throw new Error(`${name}: ${error.message}`);
  // These functions return a single row; supabase-js hands back the object or
  // a one-element array depending on the declared return type.
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

/**
 * Read the requested metrics over one window.
 *
 * Returns null for a metric the window cannot answer — no tracking ran, or
 * the brand has no analytics connected — which the caller reports as
 * unmeasured rather than as a value.
 */
export async function measureKpis(brandId, kpiKeys, from, to) {
  const wanted = kpiKeys.filter((key) => key in MEASURABLE_KPIS);
  if (wanted.length === 0) return {};

  const needsInsights = wanted.some((k) => k === 'citations' || k === 'mentions');
  const needsVisibility = wanted.includes('ai_visibility');
  const needsSov = wanted.includes('share_of_voice');
  const needsTraffic = wanted.includes('ai_referral_traffic');

  const [insights, visibility, sov, traffic] = await Promise.all([
    needsInsights ? rpc('insights_aggregates_daily', brandId, from, to) : null,
    needsVisibility ? rpc('ai_visibility_aggregates_daily', brandId, from, to) : null,
    needsSov ? rpc('share_of_voice_aggregates_daily', brandId, from, to) : null,
    needsTraffic ? measureTraffic(brandId, from, to) : null,
  ]);

  const values = {};
  for (const key of wanted) {
    switch (key) {
      case 'citations':
        values[key] = insights?.total_citations ?? null;
        break;
      case 'mentions':
        values[key] = insights?.total_mentions ?? null;
        break;
      case 'ai_visibility':
        values[key] = visibility?.answers
          ? computeAiVisibilityScore({
              answers: Number(visibility.answers),
              mentionAnswers: Number(visibility.mention_answers ?? 0),
              citationAnswers: Number(visibility.citation_answers ?? 0),
              positionFactor: visibility.position_factor ?? 0,
            })
          : null;
        break;
      case 'share_of_voice': {
        // The function returns the two mention totals; the percentage is
        // computed the same way the Insights page computes it, so the two
        // agree for the same days.
        const brand = Number(sov?.total_brand_mentions ?? 0);
        const competitors = Number(sov?.total_competitor_mentions ?? 0);
        const all = brand + competitors;
        values[key] = all > 0 ? Math.round((brand / all) * 1000) / 10 : null;
        break;
      }
      case 'ai_referral_traffic':
        values[key] = traffic;
        break;
    }
  }
  return values;
}

/**
 * AI-referred visits over a window.
 *
 * Two sources exist and they measure different things: the tracking snippet
 * logs each referred visit, while the analytics integration reports sessions.
 * Whichever the brand actually has is used — and when it has neither, the
 * metric is unmeasured, not zero.
 */
async function measureTraffic(brandId, from, to) {
  const { count, error } = await supabaseAdmin
    .from('ai_traffic_logs')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .gte('created_at', `${from}T00:00:00Z`)
    .lte('created_at', `${to}T23:59:59Z`);
  if (error) throw new Error(`ai_traffic_logs: ${error.message}`);
  if (count) return count;

  const { data, error: gaErr } = await supabaseAdmin
    .from('ga_ai_traffic_stats')
    .select('sessions')
    .eq('brand_id', brandId)
    .gte('date', from)
    .lte('date', to);
  if (gaErr) throw new Error(`ga_ai_traffic_stats: ${gaErr.message}`);
  if (!data?.length) return null;
  return data.reduce((sum, row) => sum + Number(row.sessions ?? 0), 0);
}

/**
 * The verdict, from the measured pairs alone.
 *
 * A metric counts as moved only past MEANINGFUL_CHANGE_RATIO — these numbers
 * drift week to week on their own, and calling a 1% wobble an improvement
 * would make every outcome meaningless. Mixed movement reads as improved:
 * something the action aimed at did move, and reporting that as "no change"
 * would hide it.
 */
export function deriveOutcome(metrics) {
  const measured = metrics.filter((m) => m.before != null && m.after != null);
  if (measured.length === 0) return 'not_measurable';

  let improved = 0;
  let declined = 0;
  for (const { before, after } of measured) {
    const floor = Math.abs(before) * MEANINGFUL_CHANGE_RATIO;
    // A metric that was zero before has no ratio to scale by; any real
    // arrival counts as movement.
    const threshold = before === 0 ? Number.EPSILON : floor;
    if (after - before > threshold) improved += 1;
    else if (before - after > threshold) declined += 1;
  }

  if (improved > 0) return 'improved';
  if (declined > 0) return 'declined';
  return 'no_meaningful_change';
}

/**
 * Measure one closed action and record the result.
 *
 * Returns the outcome written, or null when the action is not ready — it
 * closed too recently, or its "after" window has not finished yet.
 */
export async function validateAction(action, { now = new Date() } = {}) {
  const closedAt = Date.parse(action.completed_at ?? '') || 0;
  if (!closedAt) return null;

  const beforeWindow = windowEndingBefore(new Date(action.created_at), MEASUREMENT_WINDOW_DAYS);
  const afterWindow = windowStartingAfter(new Date(closedAt), MEASUREMENT_WINDOW_DAYS);

  // The window has to be complete. Measuring a window whose last days have
  // not happened yet reads low for a reason that has nothing to do with the
  // action, and would file most recent work as a decline.
  if (afterWindow.to >= utcDay(now)) return null;

  const kpiKeys = (action.kpi_keys ?? []).filter((key) => key in MEASURABLE_KPIS);

  // An action with no success metrics has nothing to measure. That is a gap
  // in the rule that produced it, not a failure here — say so plainly rather
  // than inventing a metric it never claimed.
  if (kpiKeys.length === 0) {
    await write(action.id, null, 'not_measurable', now);
    return 'not_measurable';
  }

  const [before, after] = await Promise.all([
    measureKpis(action.brand_id, kpiKeys, beforeWindow.from, beforeWindow.to),
    measureKpis(action.brand_id, kpiKeys, afterWindow.from, afterWindow.to),
  ]);

  const metrics = kpiKeys.map((metric) => ({
    metric,
    unit: MEASURABLE_KPIS[metric],
    before: before[metric] ?? null,
    after: after[metric] ?? null,
  }));

  const outcome = deriveOutcome(metrics);
  await write(
    action.id,
    { measuredAt: now.toISOString(), beforeWindow, afterWindow, metrics },
    outcome,
    now,
  );
  return outcome;
}

async function write(actionId, validation, outcome, now) {
  const { error } = await supabaseAdmin
    .from('actions')
    .update({ validation, outcome, validated_at: now.toISOString() })
    .eq('id', actionId);
  if (error) throw new Error(error.message);

  // The trail carries the verdict, so the drawer's History tab shows when the
  // measurement happened alongside the work that preceded it.
  await supabaseAdmin
    .from('action_events')
    .insert({ action_id: actionId, event: 'outcome_measured', data: { outcome } });
}

/**
 * Nightly sweep: measure every closed action whose settling period has passed.
 *
 * Best-effort per action — one brand's missing rollup must not stop the rest
 * from being measured.
 */
export async function sweepActionValidation({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - VALIDATION_WAIT_DAYS * DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select('id, brand_id, kpi_keys, created_at, completed_at')
    .eq('status', 'completed')
    .eq('outcome', 'pending_measurement')
    .not('completed_at', 'is', null)
    .lte('completed_at', cutoff)
    .limit(500);
  if (error) {
    logger.error({ err: error }, '[action-validation] could not list pending actions');
    return { measured: 0, failed: 0 };
  }

  let measured = 0;
  let failed = 0;
  for (const action of data ?? []) {
    try {
      if (await validateAction(action, { now })) measured += 1;
    } catch (err) {
      failed += 1;
      logger.error({ err, actionId: action.id }, '[action-validation] measurement failed');
    }
  }

  logger.info({ measured, failed }, '[action-validation] sweep complete');
  return { measured, failed };
}
