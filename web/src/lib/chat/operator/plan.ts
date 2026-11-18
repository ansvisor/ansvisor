import type { ActionCategory } from '@/lib/action-center/registry';
import type { PriorityLevel } from '@/lib/action-center/priority';
import type { KpiKey } from '@/lib/kpis/registry';
import type { KpiStatus } from '@/lib/kpis/status';
import type { SignalCategory } from '@/lib/signals/registry';
import { dayIn, nextDay } from '@/lib/time-zone';
import { operatorSettingsOf, type OperatorSettings } from './defaults';
import { agentFit, type AgentFit } from './fit';

/**
 * The AEO Operator's daily plan (AEO Operator plan §4.2 step 2): which of
 * the workspace's agents to start today on one brand, from the facts
 * facts.ts reads, its settings and the clock. Code picks, from the
 * workspace's own numbers; no model, no I/O, nothing random.
 *
 *   1. Pacing: today's budget is the smaller of the daily budget and
 *      (90% − the month's AI used) ÷ the working days left in the period,
 *      in whole percents. No plan once 90% of the month is used, or when
 *      less than 1% is left for today. Self-hosted (no AI limit): no
 *      budget, the plan is by count only.
 *   2. Hard filters, each with its reason ("not today").
 *   3. Value: 3 × today's focus actions in its categories, + its weighted
 *      open actions (at most 5), + its new signals (at most 3), + 2 × its
 *      off-track KPIs, + how overdue it is against its schedule (at most
 *      2), + its 30-day improved minus declined (−2 to +2), + 0.5 when it
 *      never ran. An agent with none of that work to do (the first five
 *      terms 0), or a value of 0 or less, has nothing to do.
 *   4. Cost: the 75th percentile of its last 10 finished runs' usage_share;
 *      with none, the smaller of its own cap and half the daily budget.
 *   5. Pick: greedily by value ÷ cost (ties: the higher value, then the
 *      agent id), within today's budget and the most runs a day.
 *   6. Split: each pick's run cap is its part of today's budget, by its
 *      cost, in whole percents: at least 1%, at most its own cap, and
 *      together at most the budget.
 *
 * What it gives is codes and counts only, never text from outside (an
 * agent's name, an action's title): the plan card words them. Pure.
 */

// ─── The rules' numbers ──────────────────────────────────────────────────────

/** No plan once this much of the month's AI limit is used; pacing spreads what is left to it. */
export const MONTH_STOP = 0.9;
/** An agent that started a run on the brand within this many hours waits. */
export const RAN_RECENTLY_HOURS = 20;
/** An agent whose own schedule fires within this many hours waits for it. */
export const SCHEDULE_SOON_HOURS = 18;
/** An agent with this many failures in a row (fail_count) waits. */
export const FAILING_AT = 2;
/** The finished runs a cost is estimated from, and the percentile it takes. */
export const COST_RUNS = 10;
export const COST_PERCENTILE = 0.75;
/** The smallest run cap: chat_agent_runs.max_share is in whole percents. */
export const MIN_SHARE = 0.01;

/** The value formula's weights and caps. */
export const VALUE = Object.freeze({
  focus: 3,
  openMax: 5,
  signalsMax: 3,
  kpi: 2,
  overdueMax: 2,
  outcomeMax: 2,
  neverRan: 0.5,
});

/** How much one open action of a level weighs (unscored: no Priority Score yet). */
export const LEVEL_WEIGHT: Readonly<Record<PriorityLevel | 'unscored', number>> = Object.freeze({
  critical: 1,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
  unscored: 0.25,
});

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ─── The facts ───────────────────────────────────────────────────────────────

/** A category's open actions by priority level. */
export type LevelCounts = Partial<Record<PriorityLevel | 'unscored', number>>;

/** One agent the Operator could start, as facts.ts reads it. */
export interface CandidateFacts {
  agentId: string;
  /** chat_agents.status: only `active` runs. */
  status: string;
  /** Its owner is the Operator's owner. */
  mine: boolean;
  /** Visible to the workspace (one the owner doesn't own is picked only with includeWorkspace). */
  workspace: boolean;
  /** Its skills name the Operator's: never picked (facts.ts gives none). */
  operator: boolean;
  /** The owner sees it and may run it. */
  canRun: boolean;
  /** Its scope has the brand, and the owner may use the brand. */
  onBrand: boolean;
  /** A Required connection the brand lacks. */
  missingConnection: boolean;
  /** Its monthly cap is used. */
  monthCapReached: boolean;
  /** A run of it is queued or held (running, needs you, paused at its cap) on the brand. */
  runOpen: boolean;
  /** Its failures in a row (chat_agents.fail_count). */
  failCount: number;
  /** Its own cap per run, a share of the monthly AI limit. */
  maxRunShare: number;
  /** Its skills' ids, in order. */
  skills: readonly string[];
  /** Its Signal triggers' Action Center categories. */
  signalTriggerCategories: readonly string[];
  /** Its KPI triggers' KPIs. */
  kpiTriggers: readonly string[];
  /** Its enabled schedules' soonest next fire; null without one. */
  nextOwnFireAt: string | null;
  /** The days between its enabled schedules' fires, the shortest; null without a recurring one. */
  cadenceDays: number | null;
  /** Its runs on the brand; null when they couldn't be read (nothing is counted from them). */
  history: {
    /** When its newest run on the brand started; null when none did. */
    lastRanAt: string | null;
    /** Its runs of the last 30 days whose outcome is improved, and declined. */
    improved30: number;
    declined30: number;
    /** Its last finished runs' usage_share, newest first (at most COST_RUNS). */
    recentUsage: readonly number[];
  } | null;
}

/** A read facts.ts couldn't make: its facts are neutral (nothing counted), never a failed plan. */
export type FactsRead =
  | 'brand'
  | 'focus'
  | 'actions'
  | 'signals'
  | 'kpis'
  | 'agents'
  | 'triggers'
  | 'runs'
  | 'owner'
  | 'connections'
  | 'shares'
  | 'ai_usage';

/** Everything the plan is made from: the brand's numbers and the candidates'. */
export interface OperatorFacts {
  /** The categories of the owner's Today focus actions, one per action. */
  focus: readonly ActionCategory[];
  /** Open actions (new, in progress; unassigned or the owner's) by category and level. */
  openActions: Partial<Record<ActionCategory, LevelCounts>>;
  /** Signals found in the last 24 hours and still open, by category (copies counted once). */
  newSignals: Partial<Record<SignalCategory, number>>;
  /** The brand's KPIs and their status. */
  kpis: readonly { key: KpiKey; status: KpiStatus }[];
  /** The month's AI limit: unlimited (self-hosted), the share used and when the period ends. */
  ai: { unlimited: boolean; monthUsed: number | null; periodEnd: string | null };
  candidates: readonly CandidateFacts[];
  failed: readonly FactsRead[];
}

// ─── The plan ────────────────────────────────────────────────────────────────

/** Why an agent isn't in today's plan. */
export type PassReason =
  | 'operator'
  | 'not_allowed'
  | 'not_active'
  | 'cannot_run'
  | 'not_on_brand'
  | 'missing_connection'
  | 'month_cap'
  | 'run_open'
  | 'ran_recently'
  | 'schedule_soon'
  | 'failing'
  | 'over_budget'
  | 'nothing_to_do'
  | 'budget_full'
  | 'max_runs';

/** Why an agent is in it: a code and its counts, which the card words ("3 open Recover actions"). */
export type PlanReason =
  | { code: 'focus'; count: number }
  | { code: 'open_actions'; category: ActionCategory; count: number }
  | { code: 'new_signals'; category: SignalCategory; count: number }
  | { code: 'kpi_off_track'; kpi: KpiKey }
  | { code: 'overdue'; days: number }
  | { code: 'improved'; count: number }
  | { code: 'declined'; count: number }
  | { code: 'last_ran'; days: number }
  | { code: 'never_ran' };

export interface PlanItem {
  agentId: string;
  value: number;
  /** Its estimated cost, a share of the monthly AI limit; null when nothing is metered. */
  cost: number | null;
  /** Its run's cap (max_share): its part of today's budget, or its own cap when nothing is metered. */
  share: number;
  reasons: PlanReason[];
}

export interface PassedAgent {
  agentId: string;
  reason: PassReason;
}

/** Why no agent was weighed today. */
export type PlanStop = 'month_used' | 'no_budget';

export interface DayPlan {
  /** The picks, best first. */
  items: PlanItem[];
  /** Every other candidate, by agent id, with why. */
  passed: PassedAgent[];
  /** Today's budget after pacing; null when nothing is metered (count only). */
  budgetToday: number | null;
  /** The picks' estimated costs together; null when nothing is metered. */
  plannedShare: number | null;
  /** Set when the day has no plan whatever the agents: the month is used up, or no budget is left. */
  stop: PlanStop | null;
}

// ─── Pieces, exported for their tests ────────────────────────────────────────

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};
/** A share in whole percents, rounded down (0.0428 → 0.04). */
const floorPercent = (share: number) => Math.floor(share * 100 + 1e-9) / 100;
/** Whole percents, as integers (0.05 → 5). */
const points = (share: number) => Math.floor(share * 100 + 1e-9);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isWeekday = (day: string) => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
};

/**
 * The working days left in the period, today included whatever day it is,
 * then every Monday to Friday through the period's last day, on `timeZone`'s
 * calendar. Null without a readable period end.
 */
export function workingDaysLeft(
  now: Date,
  periodEnd: string | null,
  timeZone: string,
): number | null {
  const end = periodEnd ? Date.parse(periodEnd) : NaN;
  if (!Number.isFinite(end)) return null;
  const lastDay = dayIn(end - 1, timeZone);
  let day = dayIn(now.getTime(), timeZone);
  let count = 1;
  // A period is a month; the bound only guards a far-off end.
  for (let i = 0; i < 400; i += 1) {
    day = nextDay(day);
    if (day > lastDay) break;
    if (isWeekday(day)) count += 1;
  }
  return count;
}

/**
 * Today's budget (pacing): null when nothing is metered; else the smaller
 * of the daily budget and (90% − used) ÷ working days left, in whole
 * percents. When the month's use couldn't be read, the daily budget (each
 * step is held on the AI budget anyway).
 */
export function todaysBudget(
  ai: OperatorFacts['ai'],
  dailyBudget: number,
  now: Date,
  timeZone: string,
): { budget: number | null; stop: PlanStop | null } {
  if (ai.unlimited) return { budget: null, stop: null };
  if (ai.monthUsed === null) return { budget: floorPercent(dailyBudget), stop: null };
  if (ai.monthUsed >= MONTH_STOP - 1e-9) return { budget: 0, stop: 'month_used' };
  const days = workingDaysLeft(now, ai.periodEnd, timeZone);
  const paced = days === null ? Infinity : (MONTH_STOP - ai.monthUsed) / days;
  const budget = floorPercent(Math.min(dailyBudget, paced));
  return budget < MIN_SHARE ? { budget: 0, stop: 'no_budget' } : { budget, stop: null };
}

/** The `percentile` (0–1) of the values, interpolated between the two nearest (0.75: the 75th). */
function percentile(values: readonly number[], at: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * at;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

/**
 * What a run of the agent is expected to use: the 75th percentile of its
 * last 10 finished runs' usage_share; with none (or none readable), the
 * smaller of its own cap and half the daily budget. Within 1% and its own
 * cap, to the 4 places usage_share keeps.
 */
export function costEstimate(candidate: CandidateFacts, dailyBudget: number): number {
  const usage = (candidate.history?.recentUsage ?? [])
    .slice(0, COST_RUNS)
    .filter((share) => Number.isFinite(share) && share >= 0);
  const estimate =
    usage.length > 0
      ? percentile(usage, COST_PERCENTILE)
      : Math.min(candidate.maxRunShare, dailyBudget / 2);
  return round(clamp(estimate, MIN_SHARE, Math.max(MIN_SHARE, candidate.maxRunShare)), 4);
}

/** The value of starting an agent today, and the reasons that make it up. */
export interface Score {
  value: number;
  /** The work it has (focus, open actions, signals, KPIs, overdue): 0 is nothing to do. */
  work: number;
  reasons: PlanReason[];
}

const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0);

/** An agent's value today from the facts and what it fits (fit.ts). */
export function scoreCandidate(
  candidate: CandidateFacts,
  facts: Pick<OperatorFacts, 'focus' | 'openActions' | 'newSignals' | 'kpis'>,
  now: Date,
  fit: AgentFit = agentFit(candidate),
): Score {
  const reasons: PlanReason[] = [];

  const focus = fit.focus
    ? facts.focus.length
    : facts.focus.filter((category) => fit.actions.includes(category)).length;
  if (focus > 0) reasons.push({ code: 'focus', count: focus });

  const open = fit.actions
    .map((category) => {
      const levels = facts.openActions[category] ?? {};
      const entries = Object.entries(levels) as [keyof typeof LEVEL_WEIGHT, number][];
      return {
        category,
        count: sum(entries.map(([, n]) => n)),
        weighted: sum(entries.map(([level, n]) => (LEVEL_WEIGHT[level] ?? 0) * n)),
      };
    })
    .filter((entry) => entry.count > 0);
  // The most first; a tie in the categories' order.
  for (const entry of [...open].sort((a, b) => b.count - a.count)) {
    reasons.push({ code: 'open_actions', category: entry.category, count: entry.count });
  }
  const openTerm = Math.min(VALUE.openMax, sum(open.map((entry) => entry.weighted)));

  const signals = fit.signals
    .map((category) => ({ category, count: facts.newSignals[category] ?? 0 }))
    .filter((entry) => entry.count > 0);
  for (const entry of [...signals].sort((a, b) => b.count - a.count)) {
    reasons.push({ code: 'new_signals', category: entry.category, count: entry.count });
  }
  const signalTerm = Math.min(VALUE.signalsMax, sum(signals.map((entry) => entry.count)));

  const offTrack = fit.kpis.filter((kpi) =>
    facts.kpis.some((k) => k.key === kpi && k.status === 'off_track'),
  );
  for (const kpi of offTrack) reasons.push({ code: 'kpi_off_track', kpi });

  const history = candidate.history;
  const lastRan = history?.lastRanAt ? Date.parse(history.lastRanAt) : NaN;
  const daysSince = Number.isFinite(lastRan) ? (now.getTime() - lastRan) / DAY_MS : null;
  let overdue = 0;
  if (daysSince !== null && candidate.cadenceDays && candidate.cadenceDays > 0) {
    const late = daysSince - candidate.cadenceDays;
    overdue = clamp(late / candidate.cadenceDays, 0, VALUE.overdueMax);
    if (overdue > 0) reasons.push({ code: 'overdue', days: Math.max(1, Math.round(late)) });
  }

  const work = VALUE.focus * focus + openTerm + signalTerm + VALUE.kpi * offTrack.length + overdue;

  const improved = history?.improved30 ?? 0;
  const declined = history?.declined30 ?? 0;
  if (improved > 0) reasons.push({ code: 'improved', count: improved });
  if (declined > 0) reasons.push({ code: 'declined', count: declined });
  const outcome = clamp(improved - declined, -VALUE.outcomeMax, VALUE.outcomeMax);

  let neverRan = 0;
  if (history && daysSince !== null) {
    reasons.push({ code: 'last_ran', days: Math.max(1, Math.round(daysSince)) });
  } else if (history && !history.lastRanAt) {
    reasons.push({ code: 'never_ran' });
    neverRan = VALUE.neverRan;
  }

  return { value: round(work + outcome + neverRan, 2), work: round(work, 2), reasons };
}

/** The first hard filter an agent fails, or null when it may be weighed. */
export function hardFilter(
  candidate: CandidateFacts,
  settings: Pick<OperatorSettings, 'allowed' | 'includeWorkspace'>,
  now: Date,
): PassReason | null {
  if (candidate.operator) return 'operator';
  const yours = candidate.mine || (candidate.workspace && settings.includeWorkspace);
  if (!yours || (settings.allowed !== null && !settings.allowed.includes(candidate.agentId))) {
    return 'not_allowed';
  }
  if (candidate.status !== 'active') return 'not_active';
  if (!candidate.canRun) return 'cannot_run';
  if (!candidate.onBrand) return 'not_on_brand';
  if (candidate.missingConnection) return 'missing_connection';
  if (candidate.monthCapReached) return 'month_cap';
  if (candidate.runOpen) return 'run_open';
  const lastRan = candidate.history?.lastRanAt ? Date.parse(candidate.history.lastRanAt) : NaN;
  if (Number.isFinite(lastRan) && now.getTime() - lastRan < RAN_RECENTLY_HOURS * HOUR_MS) {
    return 'ran_recently';
  }
  const nextFire = candidate.nextOwnFireAt ? Date.parse(candidate.nextOwnFireAt) : NaN;
  if (Number.isFinite(nextFire) && nextFire - now.getTime() <= SCHEDULE_SOON_HOURS * HOUR_MS) {
    return 'schedule_soon';
  }
  if (candidate.failCount >= FAILING_AT) return 'failing';
  return null;
}

/**
 * Today's budget split between the picks, in whole percents (`budget` and
 * `caps` as integers: 5 for 5%): each gets its part by its cost, at most
 * its own cap and at least 1, and together at most the budget (all of it,
 * unless the caps leave some over). The parts left by rounding down go to
 * the largest remainders (ties: the higher cost, then the earlier pick).
 * Needs at least 1 per pick: the selection keeps to that.
 */
export function splitBudget(
  budget: number,
  picks: readonly { cost: number; cap: number }[],
): number[] {
  if (picks.length === 0) return [];
  const caps = picks.map((pick) => Math.max(1, Math.floor(pick.cap)));
  const weights = picks.map((pick) => Math.max(pick.cost, 1e-6));
  const total = Math.min(budget, sum(caps));
  // Water-filling: each takes total × its weight's share, the capped ones their cap and the rest shared again.
  const target = new Array<number>(picks.length).fill(0);
  const order = picks.map((_, i) => i).sort((a, b) => caps[a] / weights[a] - caps[b] / weights[b]);
  let left = total;
  let weightLeft = sum(weights);
  for (const [at, i] of order.entries()) {
    const fair = (left * weights[i]) / weightLeft;
    if (caps[i] <= fair) {
      target[i] = caps[i];
      left -= caps[i];
      weightLeft -= weights[i];
      continue;
    }
    for (const j of order.slice(at)) target[j] = (left * weights[j]) / weightLeft;
    break;
  }
  const parts = target.map((t, i) => Math.min(caps[i], Math.max(1, Math.floor(t + 1e-9))));
  let spare = total - sum(parts);
  // Raised to 1 past the budget (a cost far over the others'): taken back from the largest parts.
  while (spare < 0) {
    const largest = parts.reduce((best, part, i) => (part > parts[best] ? i : best), 0);
    if (parts[largest] <= 1) break;
    parts[largest] -= 1;
    spare += 1;
  }
  const byRemainder = picks
    .map((_, i) => i)
    .sort(
      (a, b) =>
        target[b] - Math.floor(target[b]) - (target[a] - Math.floor(target[a])) ||
        weights[b] - weights[a] ||
        a - b,
    );
  while (spare > 0) {
    const i = byRemainder.find((j) => parts[j] < caps[j]);
    if (i === undefined) break;
    parts[i] += 1;
    spare -= 1;
    // Each pick takes at most one of the remainders before any takes a second.
    byRemainder.push(byRemainder.splice(byRemainder.indexOf(i), 1)[0]);
  }
  return parts;
}

// ─── The day ─────────────────────────────────────────────────────────────────

interface Weighed {
  candidate: CandidateFacts;
  score: Score;
  cost: number;
  ratio: number;
}

/** The ratio rounded, so two equal ones compare equal whatever the floating point did. */
const ratioOf = (value: number, cost: number) => Math.round((value / cost) * 1e6) / 1e6;

/**
 * Today's plan for one brand. `settings` are the Operator's (defaults.ts
 * fills and bounds them); `now` is the plan's moment.
 */
export function planDay(
  facts: OperatorFacts,
  settingsIn: Partial<OperatorSettings>,
  now: Date,
): DayPlan {
  const settings = operatorSettingsOf(settingsIn);
  const { budget, stop } = todaysBudget(facts.ai, settings.dailyBudget, now, settings.timeZone);
  if (stop) return { items: [], passed: [], budgetToday: 0, plannedShare: 0, stop };
  const metered = budget !== null;
  // Nothing metered: no budget to keep within.
  const room = budget ?? Infinity;

  const passed: PassedAgent[] = [];
  const weighed: Weighed[] = [];
  for (const candidate of facts.candidates) {
    const filtered = hardFilter(candidate, settings, now);
    if (filtered) {
      passed.push({ agentId: candidate.agentId, reason: filtered });
      continue;
    }
    const cost = costEstimate(candidate, settings.dailyBudget);
    if (cost > room + 1e-9) {
      passed.push({ agentId: candidate.agentId, reason: 'over_budget' });
      continue;
    }
    const score = scoreCandidate(candidate, facts, now);
    if (score.work <= 0 || score.value <= 0) {
      passed.push({ agentId: candidate.agentId, reason: 'nothing_to_do' });
      continue;
    }
    weighed.push({ candidate, score, cost, ratio: metered ? ratioOf(score.value, cost) : 0 });
  }

  // Best first: value ÷ cost (by count only: value), then value, then the agent id.
  weighed.sort(
    (a, b) =>
      b.ratio - a.ratio ||
      b.score.value - a.score.value ||
      (a.candidate.agentId < b.candidate.agentId ? -1 : 1),
  );

  const picks: Weighed[] = [];
  let spent = 0;
  for (const entry of weighed) {
    const agentId = entry.candidate.agentId;
    if (picks.length >= settings.maxRuns) {
      passed.push({ agentId, reason: 'max_runs' });
    } else if (metered && (spent + entry.cost > room + 1e-9 || picks.length + 1 > points(room))) {
      passed.push({ agentId, reason: 'budget_full' });
    } else {
      picks.push(entry);
      spent += entry.cost;
    }
  }

  const parts = metered
    ? splitBudget(
        points(room),
        picks.map((pick) => ({ cost: pick.cost, cap: points(pick.candidate.maxRunShare) })),
      )
    : [];
  const items = picks.map(
    (pick, i): PlanItem => ({
      agentId: pick.candidate.agentId,
      value: pick.score.value,
      cost: metered ? pick.cost : null,
      share: metered
        ? parts[i] / 100
        : floorPercent(Math.max(MIN_SHARE, pick.candidate.maxRunShare)),
      reasons: pick.score.reasons,
    }),
  );
  passed.sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
  return {
    items,
    passed,
    budgetToday: budget,
    plannedShare: metered ? round(sum(picks.map((pick) => pick.cost)), 4) : null,
    stop: null,
  };
}
