import { LOW_SAMPLE_ANSWERS } from '@/lib/insights-summary';

/**
 * The Mentions & Sentiment Overview's figures (MS-06), as mentions_overview
 * (00157) returns them for a window and the window of the same length before
 * it, and the metrics the page derives from them. Definitions follow the spec
 * (§5): a mention is an answer naming the brand at least once (naming it
 * twice is still one mention; occurrences are counted apart), and sentiment is
 * the tone of those answers toward the brand.
 */

export interface MentionTotals {
  /** Answers tracked in the window. */
  answers: number;
  /** Answers naming the brand at least once. */
  mentions: number;
  /** Times the brand is named, over all answers. */
  occurrences: number;
  /** Mentions with a positive or negative tone; neutral is the rest. */
  positive: number;
  negative: number;
  /** The brand's position among the brands an answer names (1 = first). */
  positionSum: number;
  positionCount: number;
  /** Prompts answered, and prompts with at least one mention. */
  prompts: number;
  promptsWithMentions: number;
  lastAnswerAt: string | null;
}

export interface MentionPlatformRow {
  platform: string;
  answers: number;
  mentions: number;
  positive: number;
  negative: number;
  previous: Pick<MentionTotals, 'answers' | 'mentions' | 'positive' | 'negative'>;
}

export interface MentionDay {
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
  answers: number;
  mentions: number;
  positive: number;
  negative: number;
}

export interface MentionCompetitorRow {
  competitorId: string;
  name: string;
  /** Answers naming the competitor. */
  mentions: number;
  /** Of those, the answers naming your brand too. */
  coMentions: number;
  previousMentions: number;
}

export interface MentionsOverview {
  window: {
    from: string;
    to: string;
    days: number;
    /** Under two days the answers were read directly; longer windows read whole UTC days. */
    source: 'answers' | 'days';
  };
  current: MentionTotals;
  previous: MentionTotals;
  platforms: MentionPlatformRow[];
  daily: MentionDay[];
  competitors: MentionCompetitorRow[];
}

const EMPTY_TOTALS: MentionTotals = {
  answers: 0,
  mentions: 0,
  occurrences: 0,
  positive: 0,
  negative: 0,
  positionSum: 0,
  positionCount: 0,
  prompts: 0,
  promptsWithMentions: 0,
  lastAnswerAt: null,
};

type Raw = Record<string, unknown>;
const num = (r: Raw | undefined, key: string): number => Number(r?.[key] ?? 0) || 0;
const rows = (value: unknown): Raw[] => (Array.isArray(value) ? (value as Raw[]) : []);

function totals(r: Raw | null | undefined): MentionTotals {
  if (!r) return EMPTY_TOTALS;
  return {
    answers: num(r, 'answers'),
    mentions: num(r, 'mentions'),
    occurrences: num(r, 'occurrences'),
    positive: num(r, 'positive'),
    negative: num(r, 'negative'),
    positionSum: num(r, 'position_sum'),
    positionCount: num(r, 'position_count'),
    prompts: num(r, 'prompts'),
    promptsWithMentions: num(r, 'prompts_with_mentions'),
    lastAnswerAt: typeof r.last_answer_at === 'string' ? r.last_answer_at : null,
  };
}

/**
 * The function's jsonb as the page's shape; null when there is nothing to
 * read (the caller isn't in the brand's organization).
 */
export function parseMentionsOverview(raw: unknown): MentionsOverview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const w = (r.window ?? {}) as Raw;
  return {
    window: {
      from: String(w.from ?? ''),
      to: String(w.to ?? ''),
      days: num(w, 'days'),
      source: w.source === 'answers' ? 'answers' : 'days',
    },
    current: totals(r.current as Raw | null),
    previous: totals(r.previous as Raw | null),
    platforms: rows(r.platforms).map((p) => ({
      platform: String(p.platform ?? ''),
      answers: num(p, 'answers'),
      mentions: num(p, 'mentions'),
      positive: num(p, 'positive'),
      negative: num(p, 'negative'),
      previous: {
        answers: num(p, 'prev_answers'),
        mentions: num(p, 'prev_mentions'),
        positive: num(p, 'prev_positive'),
        negative: num(p, 'prev_negative'),
      },
    })),
    daily: rows(r.daily).map((d) => ({
      day: String(d.day ?? ''),
      answers: num(d, 'answers'),
      mentions: num(d, 'mentions'),
      positive: num(d, 'positive'),
      negative: num(d, 'negative'),
    })),
    competitors: rows(r.competitors).map((c) => ({
      competitorId: String(c.competitor_id ?? ''),
      name: String(c.name ?? ''),
      mentions: num(c, 'mentions'),
      coMentions: num(c, 'co_mentions'),
      previousMentions: num(c, 'prev_mentions'),
    })),
  };
}

type Counts = Pick<MentionTotals, 'answers' | 'mentions' | 'positive' | 'negative'>;

/** Fewer mentions than this and sentiment is marked "Low sample" (spec §2). */
export const LOW_SAMPLE_MENTIONS = LOW_SAMPLE_ANSWERS;

/** Answers naming the brand, as a percentage of the answers; null with no answers. */
export function mentionRate(t: Pick<Counts, 'answers' | 'mentions'>): number | null {
  return t.answers > 0 ? (t.mentions * 100) / t.answers : null;
}

/**
 * The tone of the mentions as percentages that add up to 100, neutral
 * included (never folded into the others), with n, the mentions behind them.
 * Null with no mentions.
 */
export function sentimentSplit(
  t: Omit<Counts, 'answers'>,
): { positive: number; neutral: number; negative: number; n: number } | null {
  if (t.mentions <= 0) return null;
  // Multiplied first, so whole percentages stay whole (7/50 → 14, not 14.000…2).
  const share = (count: number) => (count * 100) / t.mentions;
  return {
    positive: share(t.positive),
    neutral: share(t.mentions - t.positive - t.negative),
    negative: share(t.negative),
    n: t.mentions,
  };
}

/** %positive − %negative of the mentions, −100…+100; null with no mentions. */
export function netSentiment(t: Omit<Counts, 'answers'>): number | null {
  const split = sentimentSplit(t);
  return split ? split.positive - split.negative : null;
}

export function isLowSample(t: Pick<Counts, 'mentions'>): boolean {
  return t.mentions < LOW_SAMPLE_MENTIONS;
}

/** The brand's average position when named (1 = first); null when never placed. */
export function averagePosition(t: Pick<MentionTotals, 'positionSum' | 'positionCount'>) {
  return t.positionCount > 0 ? t.positionSum / t.positionCount : null;
}
