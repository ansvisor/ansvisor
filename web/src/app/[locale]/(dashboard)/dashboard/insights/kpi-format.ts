/**
 * How the Insights KPI cards (VIS-003) write their values and changes, and
 * whether a change is good news. Kept apart from the cards so the rules are
 * tested on their own.
 */

/** Whether a change is good news, bad news, or neither (counts like tracked prompts). */
export type Tone = 'good' | 'bad' | 'neutral';

/** Text colour for each tone, in both themes. */
export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-red-600 dark:text-red-400',
  neutral: 'text-muted-foreground',
};

export interface Change {
  text: string;
  tone: Tone;
}

const MINUS = '−';

/** A change: "+1.5", "−3.2", "±0". */
export function signedChange(n: number): string {
  if (n === 0) return '±0';
  return `${n > 0 ? '+' : MINUS}${Math.abs(n).toLocaleString('en-US')}`;
}

/** A value that can be negative, like Net sentiment: "+34", "−6", "0". */
export function signedValue(n: number): string {
  return n === 0 ? '0' : signedChange(n);
}

/** A change where up is good (most cards). */
export function upIsGood(change: number | null, suffix = ''): Change | null {
  if (change === null) return null;
  return {
    text: `${signedChange(change)}${change === 0 ? '' : suffix}`,
    tone: change > 0 ? 'good' : change < 0 ? 'bad' : 'neutral',
  };
}

/** Avg. position: a lower number is better, shown as an arrow up when it improves. */
export function lowerIsGood(change: number | null): Change | null {
  if (change === null) return null;
  if (change === 0) return { text: '±0', tone: 'neutral' };
  return {
    text: `${change < 0 ? '↑' : '↓'}${Math.abs(change)}`,
    tone: change < 0 ? 'good' : 'bad',
  };
}

/** A score change on the leaderboard, as in the v2 mockup: "↑ 4.1", "↓ 1.1", "±0". */
export function arrowChange(change: number | null): Change | null {
  if (change === null) return null;
  if (change === 0) return { text: '±0', tone: 'neutral' };
  return {
    text: `${change > 0 ? '↑' : '↓'} ${Math.abs(change).toLocaleString('en-US', { maximumFractionDigits: 1 })}`,
    tone: change > 0 ? 'good' : 'bad',
  };
}

/**
 * A comparison-window bound for the "vs <range>" label. Whole-day windows
 * come as 'YYYY-MM-DD' UTC days and are shown as those days; the 24h and
 * topic views come as timestamps and are shown in local time.
 */
export function formatWindowBound(value: string): string {
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(dayOnly ? `${value}T00:00:00Z` : value).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    ...(dayOnly ? { timeZone: 'UTC' } : {}),
  });
}
