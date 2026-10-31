import type { TeamRole } from '@/components/providers/role-provider';
import { storedPriorityLevel, type PriorityLevel } from '@/lib/action-center/priority';
import { CLOSED_ACTION_STATUSES, type ActionStatus } from '@/lib/action-center/registry';
import { formatMonthDay } from '@/lib/format';

/**
 * Daily suggestions in Chat's Inbox (CHAT-26 §2.2, §2.4, §5, §6; mockup
 * #d-inbox, #d-paused): what a row shows of a chat_suggestions row (00422),
 * read from the summary the nightly job kept as it sent it (W2-24's version
 * 1: structured fields, which the Inbox words with the Action Center's own
 * helpers), the row's dot, and the person's feeds as one state. Pure: the
 * server actions in lib/actions/chat-suggestions.ts read and write.
 */

/** The Inbox shows the suggestions sent in the last this many days (§2.2, §4). */
export const SHOWN_DAYS = 7;

const DAY_MS = 86_400_000;

/** The oldest sent_at the Inbox shows, as of `now`: older suggestions don't show. */
export function shownSince(now: Date): string {
  return new Date(now.getTime() - SHOWN_DAYS * DAY_MS).toISOString();
}

/**
 * Who gets daily suggestions (§6, DECISIONS V), as the nightly job's
 * ROLE_FEEDS: Admins and Managers by default (the job makes their feeds),
 * Agency partners once they open the Inbox, Analysts never.
 */
export type RoleFeed = 'default_on' | 'opt_in' | 'never';

const ROLE_FEEDS: Record<TeamRole, RoleFeed> = {
  admin: 'default_on',
  manager: 'default_on',
  agency_partner: 'opt_in',
  analyst: 'never',
};

export function roleFeed(role: TeamRole | null): RoleFeed {
  return role ? ROLE_FEEDS[role] : 'never';
}

/**
 * The person's feeds (one per brand) as one: paused while any brand's is
 * (by the job, after 30 days unused: the banner shows, and Turn back on
 * turns every brand's on, §2.4, §5); else on while any is; else off (by the
 * person's Pause); none before any is made.
 */
export type FeedsState = 'on' | 'paused' | 'off' | 'none';

export function feedsState(statuses: readonly string[]): FeedsState {
  if (statuses.includes('paused')) return 'paused';
  if (statuses.includes('on')) return 'on';
  if (statuses.includes('off')) return 'off';
  return 'none';
}

/** An action whose cycle is over in the Action Center: done or dismissed. */
export type ClosedStatus = Extract<ActionStatus, 'completed' | 'dismissed'>;

/** The action's status as closed, when it is; null while it is open (or unknown). */
export function closedStatus(status: unknown): ClosedStatus | null {
  return (CLOSED_ACTION_STATUSES as readonly unknown[]).includes(status)
    ? (status as ClosedStatus)
    : null;
}

/** "Start now" as the job kept it: the draft it opens, its pages, and about how long. */
export interface SuggestionStartNow {
  method: 'create' | 'optimize';
  pages: number;
  minutes: number;
}

/** What a row reads of the summary. */
export interface SuggestionSummary {
  /** The action's number, shown as AC-2841; null when it has none. */
  actionNo: number | null;
  kind: string;
  /** What actionTexts reads for the title. */
  payload: Record<string, unknown>;
  priorityLevel: PriorityLevel | null;
  startNow: SuggestionStartNow | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const positive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

/**
 * A summary read defensively: a part that is missing, or of another shape,
 * reads as none, so a row still shows from what is there.
 */
export function parseSuggestionSummary(value: unknown): SuggestionSummary {
  const summary = isRecord(value) ? value : {};
  const action = isRecord(summary.action) ? summary.action : {};
  const priority = isRecord(summary.priority) ? summary.priority : {};
  const start = isRecord(summary.startNow) ? summary.startNow : null;
  const minutes = positive(start?.minutes);
  const method = start?.method;
  const score = typeof priority.score === 'number' ? priority.score : null;
  return {
    actionNo: positive(action.no),
    kind: typeof action.kind === 'string' ? action.kind : '',
    payload: isRecord(action.payload) ? action.payload : {},
    priorityLevel: storedPriorityLevel(priority.level, score),
    startNow:
      (method === 'create' || method === 'optimize') && minutes !== null
        ? { method, pages: positive(start?.pages) ?? 1, minutes }
        : null,
  };
}

/** One suggestion as the Inbox lists it. */
export interface DailySuggestion {
  id: string;
  brandId: string;
  actionId: string;
  /** The day it was sent, YYYY-MM-DD, in the person's time zone. */
  sentOn: string;
  sentAt: string;
  seenAt: string | null;
  openedAt: string | null;
  startedAt: string | null;
  startedVia: 'chat' | 'editor' | null;
  /** The action was done or dismissed since: the row stays, faded, with that status. */
  closed: ClosedStatus | null;
  summary: SuggestionSummary;
}

/** What the Inbox reads of the person's daily suggestions. */
export interface DailySuggestionsRead {
  roleFeed: RoleFeed;
  state: FeedsState;
  /**
   * The last SHOWN_DAYS days' suggestions, not removed, not put off, whose
   * action wasn't deleted: newest first, at most the read's cap.
   */
  suggestions: DailySuggestion[];
  /** How many there are, past the cap included. */
  total: number;
  /** The person's today (YYYY-MM-DD) as the job dates sent_on; null when it couldn't be read. */
  today: string | null;
}

/** The row's dot (§2.2): new (blue), seen, started (green). Opening one sees it. */
export type SuggestionDot = 'new' | 'seen' | 'started';

export function suggestionDot(
  suggestion: Pick<DailySuggestion, 'seenAt' | 'openedAt' | 'startedAt'>,
): SuggestionDot {
  if (suggestion.startedAt) return 'started';
  return suggestion.seenAt || suggestion.openedAt ? 'seen' : 'new';
}

/**
 * The Chat answers the job reads time zones from (W2-24's ZONE_DAYS and
 * ZONE_ANSWERS): the workspace's of the last 30 days, the latest 300.
 */
export const ZONE_DAYS = 30;
export const ZONE_ANSWERS = 300;

/**
 * The time zone the nightly job dates a person's suggestions in (W2-24's
 * resolveZones): their latest Chat answer's (chat_messages.timezone, the
 * browser's zone it was shown in); else the one most of the workspace's
 * latest answers were read in, the newest on a tie; else UTC.
 *
 * @param answers the workspace's latest answers, newest first
 */
export function sendingZone(
  answers: readonly { userId: string | null; timezone: string | null }[],
  userId: string,
): string {
  const counts = new Map<string, number>();
  for (const answer of answers) {
    if (!isTimeZone(answer.timezone)) continue;
    if (answer.userId === userId) return answer.timezone;
    counts.set(answer.timezone, (counts.get(answer.timezone) ?? 0) + 1);
  }
  let zone = 'UTC';
  let most = 0;
  // Map order is first-seen order, newest first: a strict > keeps the newest on a tie.
  for (const [name, count] of counts) {
    if (count > most) {
      zone = name;
      most = count;
    }
  }
  return zone;
}

function isTimeZone(zone: string | null): zone is string {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day, YYYY-MM-DD, `now` reads in `zone`. */
export function dayIn(now: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The day a suggestion was sent, as "Oct 29", and whether that is the
 * person's today ("Today · Oct 29"), as the read dated it: not today when
 * it couldn't.
 */
export function sentDay(sentOn: string, today: string | null): { date: string; today: boolean } {
  return {
    date: formatMonthDay(`${sentOn}T00:00:00Z`, 'UTC'),
    today: today === sentOn,
  };
}
