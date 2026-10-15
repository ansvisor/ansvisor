/**
 * Per-platform positions for one prompt over a date window: what the
 * Positions panel on the Prompts page shows.
 *
 * Pure on purpose: the server action loads the answers and the plan, this
 * turns them into the panel's numbers, and the tests pin the counting rules
 * that are easy to get subtly wrong (a day without an answer is untracked,
 * not "not mentioned"; several answers on one day count that day once).
 */
import { PLANS, PLAN_ORDER, type Plan } from '@/config/plans';
import { extractHostname, normalizeDomain } from '@/lib/citations/classify';
import { dayIn, nextDay, startOfDayIn } from '@/lib/time-zone';
import type { Sentiment } from '@/types';

/** The engines the panel lists, in the order it lists them. */
export const POSITION_PLATFORMS = [
  { id: 'chatgpt-web', label: 'ChatGPT' },
  { id: 'perplexity-web', label: 'Perplexity' },
  { id: 'google-aio', label: 'Google AI Overviews' },
  { id: 'google-aimode', label: 'Google AI Mode' },
  { id: 'gemini-web', label: 'Gemini' },
  { id: 'copilot-web', label: 'Microsoft Copilot' },
  { id: 'grok-web', label: 'Grok' },
  // API-model tracking stores its answers under this platform.
  { id: 'claude', label: 'Claude' },
] as const;

export type PositionPlatformId = (typeof POSITION_PLATFORMS)[number]['id'];

export type PlatformAccess =
  | { state: 'included' }
  | { state: 'locked'; requiredPlan: 'growth' | 'enterprise' };

/**
 * Whether a plan's limits cover an engine. Claude is an API model, gated by
 * `allowedModels`; every other engine is a scraper, gated by
 * `allowedScrapers`. An absent list allows everything (plan-engines.ts).
 */
function limitsAllow(limits: Plan['limits'], platform: PositionPlatformId): boolean {
  if (platform === 'claude') {
    const models = limits.allowedModels;
    return !models || models.some((m) => m.startsWith('claude'));
  }
  const scrapers = limits.allowedScrapers;
  return !scrapers || scrapers.includes(platform);
}

/**
 * Engines the panel offers only through sales on every cloud plan, whatever
 * the plan's scraper list says. Grok is paused for everyone (Cloro fails
 * every Grok task; see UNAVAILABLE_PLATFORMS in the tracking worker), so an
 * included-but-empty card would only look broken. It stays in the plan lists
 * because removing it there would strip it from stored prompts. Self-hosted
 * keeps it: there is no sales team behind that plan.
 */
const SALES_ONLY_PLATFORMS: readonly PositionPlatformId[] = ['grok-web'];

/**
 * Whether the org's plan includes an engine, and if not, what unlocks it:
 * the next subscribable plan that covers it, or a conversation with sales.
 * `plan` must be the org's effective plan (getOrgPlan), so Enterprise
 * per-customer overrides are already merged in.
 */
export function platformAccess(plan: Plan, platform: PositionPlatformId): PlatformAccess {
  if (SALES_ONLY_PLATFORMS.includes(platform) && PLAN_ORDER.includes(plan.id)) {
    return { state: 'locked', requiredPlan: 'enterprise' };
  }
  if (limitsAllow(plan.limits, platform)) return { state: 'included' };
  const above = PLAN_ORDER.slice(PLAN_ORDER.indexOf(plan.id) + 1);
  const upgrade = above.find(
    (id) => id !== 'enterprise' && limitsAllow(PLANS[id].limits, platform),
  );
  return { state: 'locked', requiredPlan: upgrade === 'growth' ? 'growth' : 'enterprise' };
}

/**
 * The brand's first citation in an answer's source list, as a 1-based rank
 * among the sources that carry a URL. A source counts as the brand's on the
 * same rule as `citation_count`: its host is one of the brand's domains or a
 * subdomain of one. Null when none of the sources is the brand's.
 */
export function brandCitationPosition(
  citations: unknown,
  brandDomains: string[],
): { rank: number; total: number } | null {
  if (!Array.isArray(citations)) return null;
  const domains = brandDomains.map(normalizeDomain).filter(Boolean);
  if (domains.length === 0) return null;

  let total = 0;
  let rank: number | null = null;
  for (const cite of citations) {
    const url = typeof cite?.url === 'string' ? cite.url.trim() : '';
    if (!url) continue;
    total += 1;
    if (rank !== null) continue;
    const host = extractHostname(url);
    if (host && domains.some((d) => host === d || host.endsWith(`.${d}`))) rank = total;
  }
  return rank === null ? null : { rank, total };
}

/** One stored answer, reduced to what the panel needs. */
export interface PositionAnswer {
  platform: string;
  createdAt: string;
  region: string | null;
  mentioned: boolean;
  /** 1-based rank among the tracked brands the answer names; null when not stored. */
  mentionPosition: number | null;
  /** How many tracked brands the answer names. */
  mentionTotal: number | null;
  sentiment: Sentiment | null;
  cited: boolean;
  /** The brand's first source; null when not cited or the source can't be found. */
  citation: { rank: number; total: number } | null;
}

export interface PositionStats {
  best: number;
  worst: number;
  avg: number;
  count: number;
}

export interface AnswerView {
  at: string;
  region: string | null;
  mentioned: boolean;
  /** Null when not mentioned, or mentioned with no stored position. */
  mention: { position: number; total: number | null } | null;
  sentiment: Sentiment | null;
  cited: boolean;
  /** Null when not cited, or cited with no locatable source. */
  citation: { rank: number; total: number } | null;
}

export interface PlatformDay {
  /** Date in the viewer's time zone, YYYY-MM-DD. */
  day: string;
  /** Newest first. */
  answers: AnswerView[];
}

export interface PlatformPositions {
  id: PositionPlatformId;
  label: string;
  access: PlatformAccess;
  /** Answers collected on this engine in the window: one per completed run. */
  runs: number;
  trackedDays: number;
  mentionedDays: number;
  citedDays: number;
  /** Over the answers that mention the brand. */
  sentiment: { positive: number; neutral: number; negative: number; unavailable: number };
  mentionPosition: PositionStats | null;
  citationPosition: PositionStats | null;
  /** The engine's most recent answer in the window. */
  latest: AnswerView | null;
  /** The latest answer misses the brand, but an earlier one in the window had it. */
  mentionedEarlier: boolean;
  citedEarlier: boolean;
  /** Days with at least one answer, newest first. */
  days: PlatformDay[];
}

export interface PositionsSummary {
  /** Every date the window covers in the viewer's time zone, oldest first. */
  days: string[];
  /** Tracking runs that produced an answer for this prompt, across engines. */
  runs: number;
  trackedDays: number;
  mentionedDays: number;
  citedDays: number;
  untrackedDays: number;
  lastAnswerAt: string | null;
  mentionPosition: PositionStats | null;
  citationPosition: PositionStats | null;
}

/**
 * Answers from one run of a prompt land within a couple of hours of each
 * other, and runs are a day apart. A gap longer than this between two
 * consecutive answers starts a new run; answers carry no run id to group by.
 */
export const RUN_GAP_MS = 6 * 60 * 60 * 1000;

/**
 * The dates a window covers in `timeZone`, oldest first. A rolling window
 * starts part way through its first date; that date is left out unless an
 * answer landed in the part the window covers, so "last 7 days" reads as 7
 * days rather than 8 with an empty one in front.
 */
export function windowDays(
  from: string,
  to: string,
  answeredDays: Set<string>,
  timeZone = 'UTC',
): string[] {
  const last = dayIn(to, timeZone);
  const days: string[] = [];
  for (let day = dayIn(from, timeZone); day <= last; day = nextDay(day)) days.push(day);
  if (days.length === 0) return days;

  const partialStart = Date.parse(from) > Date.parse(startOfDayIn(days[0], timeZone));
  if (partialStart && days.length > 1 && !answeredDays.has(days[0])) days.shift();
  return days;
}

/** Distinct runs among answer timestamps, split on RUN_GAP_MS. */
export function countRuns(timestamps: string[]): number {
  const times = timestamps.map((t) => Date.parse(t)).sort((a, b) => a - b);
  let runs = 0;
  let last = -Infinity;
  for (const t of times) {
    if (t - last > RUN_GAP_MS) runs += 1;
    last = t;
  }
  return runs;
}

function positionStats(values: number[]): PositionStats | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    best: Math.min(...values),
    worst: Math.max(...values),
    avg: Math.round((sum / values.length) * 10) / 10,
    count: values.length,
  };
}

function toView(a: PositionAnswer): AnswerView {
  return {
    at: a.createdAt,
    region: a.region,
    mentioned: a.mentioned,
    mention:
      a.mentioned && a.mentionPosition !== null && a.mentionPosition > 0
        ? { position: a.mentionPosition, total: a.mentionTotal }
        : null,
    sentiment: a.mentioned ? a.sentiment : null,
    cited: a.cited,
    citation: a.cited ? a.citation : null,
  };
}

function summarizePlatform(
  platform: { id: PositionPlatformId; label: string; access: PlatformAccess },
  answers: PositionAnswer[],
  timeZone: string,
): PlatformPositions {
  const views = answers.map(toView).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const byDay = new Map<string, AnswerView[]>();
  for (const v of views) {
    const day = dayIn(v.at, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), v]);
  }
  const days = [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayAnswers]) => ({ day, answers: dayAnswers }));

  const sentiment = { positive: 0, neutral: 0, negative: 0, unavailable: 0 };
  for (const v of views) {
    if (!v.mentioned) continue;
    if (v.sentiment) sentiment[v.sentiment] += 1;
    else sentiment.unavailable += 1;
  }

  const latest = views[0] ?? null;
  const earlier = views.slice(1);

  return {
    ...platform,
    runs: views.length,
    trackedDays: days.length,
    mentionedDays: days.filter((d) => d.answers.some((a) => a.mentioned)).length,
    citedDays: days.filter((d) => d.answers.some((a) => a.cited)).length,
    sentiment,
    mentionPosition: positionStats(views.flatMap((v) => (v.mention ? [v.mention.position] : []))),
    citationPosition: positionStats(views.flatMap((v) => (v.citation ? [v.citation.rank] : []))),
    latest,
    mentionedEarlier: !!latest && !latest.mentioned && earlier.some((v) => v.mentioned),
    citedEarlier: !!latest && !latest.cited && earlier.some((v) => v.cited),
    days,
  };
}

/**
 * Fold a window's answers into the panel's summary and per-engine rows.
 * `answers` must already be limited to the engines the plan includes; a
 * locked engine gets its row with empty numbers, which the panel replaces
 * with the upgrade prompt. Days are the viewer's (`timeZone`), so they match
 * the answer times the viewer reads.
 */
export function summarizePositions(
  answers: PositionAnswer[],
  platforms: { id: PositionPlatformId; label: string; access: PlatformAccess }[],
  window: { from: string; to: string },
  timeZone = 'UTC',
): { summary: PositionsSummary; platforms: PlatformPositions[] } {
  const rows = platforms.map((p) =>
    summarizePlatform(
      p,
      p.access.state === 'included' ? answers.filter((a) => a.platform === p.id) : [],
      timeZone,
    ),
  );
  // Each answer's day, as its platform row already worked it out.
  const dayOf = new Map<AnswerView, string>();
  for (const r of rows) for (const d of r.days) for (const a of d.answers) dayOf.set(a, d.day);
  const counted = [...dayOf.keys()];

  const tracked = new Set(dayOf.values());
  const mentioned = new Set(counted.filter((a) => a.mentioned).map((a) => dayOf.get(a)!));
  const cited = new Set(counted.filter((a) => a.cited).map((a) => dayOf.get(a)!));
  const days = windowDays(window.from, window.to, tracked, timeZone);
  const lastAnswerAt = counted.reduce<string | null>(
    (latest, a) => (latest === null || Date.parse(a.at) > Date.parse(latest) ? a.at : latest),
    null,
  );

  return {
    summary: {
      days,
      runs: countRuns(counted.map((a) => a.at)),
      trackedDays: tracked.size,
      mentionedDays: mentioned.size,
      citedDays: cited.size,
      untrackedDays: days.filter((d) => !tracked.has(d)).length,
      lastAnswerAt,
      mentionPosition: positionStats(
        counted.flatMap((a) => (a.mention ? [a.mention.position] : [])),
      ),
      citationPosition: positionStats(
        counted.flatMap((a) => (a.citation ? [a.citation.rank] : [])),
      ),
    },
    platforms: rows,
  };
}
