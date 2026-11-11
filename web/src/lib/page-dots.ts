import type { DraftStatus } from '@/lib/content/drafts';
import type { ActionStatus } from '@/lib/action-center/registry';
import {
  DOT_PRIORITY,
  needsYouShown,
  redShown,
  type DotColour,
  type DotViewer,
} from '@/lib/menu-dots';

/**
 * The menu's dots on the pages' own rows (#2340's language): Actions' rows
 * and drawer, Content's Plan and Library, and the Audit page's Auto-audit
 * line and Opportunities tab. Red, "Needs attention": something broke, until
 * it is fixed. Yellow, "Needs you". Green, "New results": something came in
 * since the person last looked. Grey, pulsing, "Working on it".
 *
 * The pure half: from what each page already read, the reasons a row has a
 * dot; pickDot keeps the one that shows. The pages show it with PageDot
 * (components/layout/page-dot.tsx), beside the title, never in place of the
 * row's status pill.
 */

/** Why a page's dot is lit: its words are pageDots.reasons.<reason> in en.json. */
export type PageDotReason =
  | 'taskFailed'
  | 'agentFailed'
  | 'publishFailed'
  | 'waitingApproval'
  | 'inReview'
  | 'dueToday'
  | 'overdue'
  | 'outcomeMeasured'
  | 'agentRunning'
  | 'writingTasks'
  | 'writing'
  | 'plannedThisWeek'
  | 'auditRunning'
  | 'auditFinished'
  | 'newCritical'
  | 'auditUnreachable'
  | 'autoAuditOff'
  | 'autoAuditPaused'
  | 'newOpportunities'
  | 'fixesConfirmed';

/** A lit dot: its colour, why, and the values its words name. */
export interface PageDotFact {
  colour: DotColour;
  reason: PageDotReason;
  values?: Record<string, string | number>;
}

type Candidate = PageDotFact | null | false | undefined;

/**
 * The dot that shows, if any: yellow only for those who can act (admins and
 * managers, not on the demo brand or after the plan ended), red only for
 * admins and managers off the demo brand, green and grey for everyone; then
 * red over yellow, yellow over green, green over grey, and of one colour the
 * first.
 */
export function pickDot(candidates: readonly Candidate[], viewer: DotViewer): PageDotFact | null {
  const shown = candidates.filter(
    (dot): dot is PageDotFact =>
      !!dot &&
      (dot.colour === 'red'
        ? redShown(viewer)
        : dot.colour === 'yellow'
          ? needsYouShown(viewer)
          : true),
  );
  for (const colour of DOT_PRIORITY) {
    const dot = shown.find((each) => each.colour === colour);
    if (dot) return dot;
  }
  return null;
}

/** `at` happened after `seen` (never seen counts as before); not when the visit wasn't read. */
export function newSince(at: string | null | undefined, seen: string | null | undefined): boolean {
  if (!at || seen === undefined) return false;
  const time = Date.parse(at);
  if (Number.isNaN(time)) return false;
  return seen === null || time > Date.parse(seen);
}

/** A date as YYYY-MM-DD in the person's own time zone. */
export function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The last day of the person's week (Sunday), as YYYY-MM-DD. */
export function weekEnd(now: Date): string {
  const end = new Date(now);
  end.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  return localDay(end);
}

/** What lights an action's dot, read with the Actions list (getActions). */
export interface ActionDotFacts {
  /** One of its tasks waits for approval, or failed. */
  taskWaiting: boolean;
  taskFailed: boolean;
  /** The latest agent run on it: running now, or failed; null otherwise. */
  agentRun: 'running' | 'failed' | null;
  /** The task writer is writing its tasks now. */
  writingTasks: boolean;
  /** One of its drafts is being written, is in review, or its latest send to the CMS failed. */
  draftWriting: boolean;
  draftInReview: boolean;
  publishFailed: boolean;
  /** When its outcome was last measured Improved or No change; null when it hasn't been. */
  measuredAt: string | null;
  /** When the person last opened it: null never; absent when that couldn't be read. */
  seenAt?: string | null;
}

/** The statuses an action is open in: the only ones red and yellow ask anything of. */
const OPEN_ACTION: readonly ActionStatus[] = ['new', 'in_progress', 'on_hold'];

/**
 * An action's dots (its row and its drawer):
 *
 *   red     a task failed, its agent's last run failed, or its page didn't
 *           reach the CMS (open actions)
 *   yellow  a task waits for approval, a draft is in review, or it is due
 *           today or overdue (open actions)
 *   green   its outcome was measured since the person last opened it
 *   grey    an agent runs on it, its tasks are being written, or its draft is
 */
export function actionDots(
  action: { status: ActionStatus; dueDate: string | null },
  facts: ActionDotFacts | undefined,
  today: string,
): PageDotFact[] {
  const open = OPEN_ACTION.includes(action.status);
  const dots: Candidate[] = [];
  if (open && facts) {
    dots.push(
      facts.taskFailed && { colour: 'red', reason: 'taskFailed' },
      facts.agentRun === 'failed' && { colour: 'red', reason: 'agentFailed' },
      facts.publishFailed && { colour: 'red', reason: 'publishFailed' },
      facts.taskWaiting && { colour: 'yellow', reason: 'waitingApproval' },
      facts.draftInReview && { colour: 'yellow', reason: 'inReview' },
    );
  }
  if (open && action.dueDate) {
    if (action.dueDate < today) dots.push({ colour: 'yellow', reason: 'overdue' });
    else if (action.dueDate === today) dots.push({ colour: 'yellow', reason: 'dueToday' });
  }
  if (facts) {
    dots.push(
      newSince(facts.measuredAt, facts.seenAt) && { colour: 'green', reason: 'outcomeMeasured' },
      facts.agentRun === 'running' && { colour: 'grey', reason: 'agentRunning' },
      facts.writingTasks && { colour: 'grey', reason: 'writingTasks' },
      facts.draftWriting && { colour: 'grey', reason: 'writing' },
    );
  }
  return dots.filter((dot): dot is PageDotFact => !!dot);
}

/** What lights a draft's dot, on the Library's rows and the Plan's. */
export interface DraftDotFacts {
  status: DraftStatus;
  /** The Content Agent is writing it now. */
  writing: boolean;
  /** Its latest send to the CMS failed. */
  sendFailed: boolean;
  /** The Plan's: its task is due by the end of this week, or overdue. */
  dueThisWeek?: boolean;
}

/**
 * A draft's dots:
 *
 *   red     its latest send to the CMS failed
 *   yellow  it is in review; or, on the Plan, it is due this week and not
 *           started (still a draft, nothing being written)
 *   grey    the Content Agent is writing it
 */
export function draftDots(facts: DraftDotFacts): PageDotFact[] {
  const dots: Candidate[] = [
    facts.sendFailed && { colour: 'red', reason: 'publishFailed' },
    facts.status === 'in_review' && { colour: 'yellow', reason: 'inReview' },
    facts.dueThisWeek &&
      facts.status === 'draft' &&
      !facts.writing && { colour: 'yellow', reason: 'plannedThisWeek' },
    facts.writing && { colour: 'grey', reason: 'writing' },
  ];
  return dots.filter((dot): dot is PageDotFact => !!dot);
}

/** The latest auto-audit run against the one before (GET /api/audits/auto-runs/latest). */
export interface AutoRunCompare {
  /** A run before it audited the brand's pages. */
  previous: boolean;
  /** The average score of each run's completed audits; null without one. */
  scoreBefore: number | null;
  scoreAfter: number | null;
  /** Issues the run before found on a page that this run found fixed. */
  fixed: number;
  /** Critical checks failing now that didn't in the run before (or with none before). */
  newCritical: string[];
  /** No audit of the run could be done: the site didn't answer, or blocks the crawler. */
  unreachable: boolean;
}

/** "72 → 78", "78" with no run before, or "none" without a score. */
export function scoresText(compare: AutoRunCompare | null): string {
  const after = compare?.scoreAfter ?? null;
  if (after === null) return 'none';
  const before = compare?.scoreBefore ?? null;
  return before === null ? String(after) : `${before} → ${after}`;
}

/** What the Auto-audit line's dot reads. */
export interface AutoAuditFacts {
  run: {
    status: 'running' | 'completed';
    finishedAt: string | null;
    compare?: AutoRunCompare | null;
  } | null;
  /** Auto-audit this period; null when not read. */
  auto: { enabled: boolean; setting: boolean | null } | null;
  /** The person's last visit to the Audit page: null never; absent when it couldn't be read. */
  seenAt?: string | null;
}

/**
 * The Auto-audit line's dots:
 *
 *   red     the latest run found a critical check failing that the run
 *           before didn't, or couldn't audit any page
 *   yellow  auto-audit is off, or paused by the plan
 *   green   a run finished since the last visit, with its summary
 *   grey    a run is auditing now
 */
export function autoAuditDots({ run, auto, seenAt }: AutoAuditFacts): PageDotFact[] {
  const dots: Candidate[] = [];
  const compare = run?.compare ?? null;
  if (run?.status === 'running') dots.push({ colour: 'grey', reason: 'auditRunning' });
  if (run?.status === 'completed' && compare) {
    if (compare.unreachable) dots.push({ colour: 'red', reason: 'auditUnreachable' });
    else if (compare.newCritical.length > 0) {
      dots.push({
        colour: 'red',
        reason: 'newCritical',
        values: { count: compare.newCritical.length, issues: compare.newCritical.join(',') },
      });
    }
  }
  if (auto && !auto.enabled) {
    dots.push({
      colour: 'yellow',
      reason: auto.setting === false ? 'autoAuditOff' : 'autoAuditPaused',
    });
  }
  if (run?.status === 'completed' && newSince(run.finishedAt, seenAt)) {
    dots.push({
      colour: 'green',
      reason: 'auditFinished',
      values: { scores: scoresText(compare), fixed: compare?.fixed ?? 0 },
    });
  }
  return dots.filter((dot): dot is PageDotFact => !!dot);
}

/** What the Opportunities tab's dot reads. */
export interface OpportunityDotFacts {
  /** Each fix opportunity's latest audit, when it was. */
  audits: readonly (string | null)[];
  /** The latest auto-audit run, finished, and what it found fixed. */
  run: { finishedAt: string | null; fixed: number } | null;
  /** The person's last look at the tab: null never; absent when it couldn't be read. */
  seenAt?: string | null;
}

/**
 * The Opportunities tab's dots:
 *
 *   yellow  pages to fix whose audit came in since the tab was last opened
 *   green   fixes a later audit confirmed, since then
 */
export function opportunityDots({ audits, run, seenAt }: OpportunityDotFacts): PageDotFact[] {
  const fresh = audits.filter((at) => newSince(at, seenAt)).length;
  const dots: Candidate[] = [
    fresh > 0 && { colour: 'yellow', reason: 'newOpportunities', values: { count: fresh } },
    run &&
      run.fixed > 0 &&
      newSince(run.finishedAt, seenAt) && {
        colour: 'green',
        reason: 'fixesConfirmed',
        values: { count: run.fixed },
      },
  ];
  return dots.filter((dot): dot is PageDotFact => !!dot);
}
