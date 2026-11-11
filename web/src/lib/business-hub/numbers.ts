import { getPlatformName } from '@/lib/traffic-platforms';

/**
 * ChatGPT Business Hub numbers (00526) as Visibility's card reads and
 * enters them: the entries a brand's members copied from Business Hub, the
 * window each covers, its change against the entry before of the same
 * length, and what the entry dialog accepts. Business Hub has no export or
 * API: every number here was typed in, and every topic is the person's own
 * words.
 */

export const PERIOD_DAYS = [7, 28] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];
export const MAX_TOPICS = 5;
export const TOPIC_CHARS = 120;
/** The int column's top. */
export const MAX_COUNT = 2_147_483_647;

/** One entry, as the card reads it. A null number: Business Hub doesn't show it. */
export interface BusinessHubEntry {
  id: string;
  periodDays: PeriodDays;
  /** The last day it covers, YYYY-MM-DD. */
  periodEnd: string;
  mentions: number | null;
  websiteClicks: number | null;
  profileViews: number | null;
  topics: string[];
  source: 'manual' | 'csv';
  updatedAt: string | null;
}

/** Ansvisor's own ChatGPT numbers over an entry's days. */
export interface OursNumbers {
  /** The AI Visibility Score over ChatGPT's tracked answers; null with none. */
  visibility: number | null;
  answers: number;
  /** Answers naming the brand. */
  named: number;
  /** Answers citing the brand's own site: the nearest to Business Hub's Mentions. */
  cited: number;
  /** Visits from ChatGPT (the snippet and Analytics); null when they couldn't be read. */
  visits: number | null;
}

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD day's UTC midnight in ms, or null for a day that doesn't exist. */
export function dayMs(text: string): number | null {
  if (!DATE.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== text ? null : ms;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Yesterday, in UTC: the default last day of an entry. */
export function yesterday(now: Date = new Date()): string {
  return dayOf(Date.parse(dayOf(now.getTime())) - DAY_MS);
}

/**
 * The whole UTC days an entry covers, as the timestamps Ansvisor's reads
 * take: from its first day's start to its last day's end.
 */
export function entryWindow(entry: Pick<BusinessHubEntry, 'periodDays' | 'periodEnd'>): {
  from: string;
  to: string;
  firstDay: string;
} {
  const end = dayMs(entry.periodEnd) ?? Date.parse(dayOf(Date.now()));
  const first = end - (entry.periodDays - 1) * DAY_MS;
  return {
    from: new Date(first).toISOString(),
    to: new Date(end + DAY_MS - 1).toISOString(),
    firstDay: dayOf(first),
  };
}

/** The newest entry before `latest` of the same length, or null. */
export function previousOf(
  entries: BusinessHubEntry[],
  latest: BusinessHubEntry | null,
): BusinessHubEntry | null {
  if (!latest) return null;
  return (
    entries
      .filter((e) => e.periodDays === latest.periodDays && e.periodEnd < latest.periodEnd)
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0] ?? null
  );
}

/** A number's change against the one before; null when either isn't there. */
export function changeOf(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

/** ChatGPT's visits among a window's AI platforms: its hosts only (traffic-platforms.ts). */
export function chatgptVisits(platforms: { platform: string; visits: number }[]): number {
  return platforms
    .filter((p) => getPlatformName(p.platform) === 'ChatGPT')
    .reduce((sum, p) => sum + (Number(p.visits) || 0), 0);
}

/** The topics as kept: trimmed, spaces collapsed, blanks dropped, each once whatever its case. */
export function cleanTopics(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    // eslint-disable-next-line no-control-regex
    const topic = item
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!topic) continue;
    const key = topic.toLocaleLowerCase('en').replace(/̇/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
  }
  return out;
}

/**
 * A whole number of 0 or more as typed: digits, with thousands marked by a
 * dot, a comma, a space or an apostrophe in groups of three ("1.240",
 * "1,240"). Empty is null (not shown); anything else is refused.
 */
export function readCount(text: string): number | null | 'invalid' {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value) && !/^\d{1,3}([.,'   ]\d{3})+$/.test(value)) return 'invalid';
  const n = Number(value.replace(/\D/g, ''));
  return Number.isSafeInteger(n) && n <= MAX_COUNT ? n : 'invalid';
}

/** What the entry dialog holds while it is typed. */
export interface EntryDraft {
  periodDays: PeriodDays;
  periodEnd: string;
  mentions: string;
  websiteClicks: string;
  profileViews: string;
  topics: string[];
}

export type DraftField = 'periodEnd' | 'mentions' | 'websiteClicks' | 'profileViews' | 'topics';
export type DraftProblem = 'invalid' | 'future' | 'too_old' | 'too_long' | 'empty';

/** An entry as the API takes it. */
export interface EntryInput {
  periodDays: PeriodDays;
  periodEnd: string;
  mentions: number | null;
  websiteClicks: number | null;
  profileViews: number | null;
  topics: string[];
}

/**
 * The dialog's draft checked as the API checks it (server
 * business-hub/snapshots.js): a real last day, not in the future and not
 * more than two years back; whole numbers or empty; topics of 120
 * characters at most; and not empty altogether. Problems by field, or the
 * entry to send.
 */
export function checkDraft(
  draft: EntryDraft,
  now: Date = new Date(),
):
  | { ok: true; entry: EntryInput }
  | { ok: false; problems: Partial<Record<DraftField | 'entry', DraftProblem>> } {
  const problems: Partial<Record<DraftField | 'entry', DraftProblem>> = {};
  const end = dayMs(draft.periodEnd);
  // Up to tomorrow: it is already tomorrow east of UTC.
  const latest = Date.parse(dayOf(now.getTime() + 14 * 3_600_000));
  const today = Date.parse(dayOf(now.getTime()));
  if (end === null) problems.periodEnd = 'invalid';
  else if (end > latest) problems.periodEnd = 'future';
  else if (end < today - 730 * DAY_MS) problems.periodEnd = 'too_old';

  const counts = {
    mentions: readCount(draft.mentions),
    websiteClicks: readCount(draft.websiteClicks),
    profileViews: readCount(draft.profileViews),
  };
  for (const [field, value] of Object.entries(counts)) {
    if (value === 'invalid') problems[field as DraftField] = 'invalid';
  }
  const topics = cleanTopics(draft.topics);
  if (topics.some((t) => t.length > TOPIC_CHARS)) problems.topics = 'too_long';
  else if (topics.length > MAX_TOPICS) problems.topics = 'invalid';
  if (Object.keys(problems).length) return { ok: false, problems };

  const entry: EntryInput = {
    periodDays: draft.periodDays,
    periodEnd: draft.periodEnd,
    mentions: counts.mentions as number | null,
    websiteClicks: counts.websiteClicks as number | null,
    profileViews: counts.profileViews as number | null,
    topics,
  };
  if (
    entry.mentions === null &&
    entry.websiteClicks === null &&
    entry.profileViews === null &&
    !topics.length
  ) {
    return { ok: false, problems: { entry: 'empty' } };
  }
  return { ok: true, entry };
}

/** A blank draft, or one filled from an entry to edit it. */
export function draftOf(entry: BusinessHubEntry | null, now: Date = new Date()): EntryDraft {
  const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
  const topics = [...(entry?.topics ?? [])];
  while (topics.length < MAX_TOPICS) topics.push('');
  return {
    periodDays: entry?.periodDays ?? 7,
    periodEnd: entry?.periodEnd ?? yesterday(now),
    mentions: text(entry?.mentions),
    websiteClicks: text(entry?.websiteClicks),
    profileViews: text(entry?.profileViews),
    topics: topics.slice(0, MAX_TOPICS),
  };
}

/** Whether a topic is one of the brand's tracked topics, whatever its case. */
export function isTrackedTopic(topic: string, trackedTopics: string[]): boolean {
  const key = (t: string) => t.trim().toLocaleLowerCase('en').replace(/̇/g, '');
  return trackedTopics.some((t) => key(t) === key(topic));
}
