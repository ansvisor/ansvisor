import { NOT_FOR_AGENT, NO_HELD, notCheckedHere, type ActiveRule, type RuleStatus } from './rules';

/**
 * The rules the Content Agent tried and couldn't close (editor test
 * 2026-11-03): the rules a Fix run was sent, once its suggestions are
 * decided (or it found nothing), still open. Rules shows them amber, the
 * person's to decide, not red as the agent's still to fix. Kept per draft
 * in this browser, as the Next step basket's runs are.
 */
export interface TriedRules {
  /**
   * A Fix under way or waiting for its suggestions to be decided: the rules
   * it was sent, the agent's latest batch on the page when it began, and
   * whether it found nothing to change.
   */
  pending: { keys: string[]; batch: string | null; ended?: boolean } | null;
  /** The rules a decided run was sent that were still open when last read. */
  tried: string[];
}

export const NO_TRIED: TriedRules = { pending: null, tried: [] };

const triedKey = (draftId: string) => `aeo:agent-tried-rules:${draftId}`;

/**
 * The tried rules kept for the draft. A run under way when the editor
 * closed isn't kept: whether it ran isn't known here, so it marks nothing.
 */
export function readTried(draftId: string): TriedRules {
  try {
    const read = JSON.parse(localStorage.getItem(triedKey(draftId)) ?? 'null') as {
      tried?: unknown;
    } | null;
    if (read && Array.isArray(read.tried)) {
      return {
        pending: null,
        tried: read.tried.filter((key): key is string => typeof key === 'string'),
      };
    }
  } catch {
    // Storage unavailable (private mode) or unreadable: none tried.
  }
  return NO_TRIED;
}

export function writeTried(draftId: string, store: TriedRules) {
  try {
    if (store.tried.length) {
      localStorage.setItem(triedKey(draftId), JSON.stringify({ tried: store.tried }));
    } else {
      localStorage.removeItem(triedKey(draftId));
    }
  } catch {
    // Kept for this visit only.
  }
}

/**
 * Whether an agent run is behind the page: it found nothing to change, or
 * left a batch since `run.batch` and every change in it is decided, with
 * no run at work.
 */
export function runDecided(
  run: { batch: string | null; ended?: boolean } | null,
  now: { batch: string | null; open: number; busy: boolean },
): boolean {
  if (!run || now.busy || now.open > 0) return false;
  return run.ended === true || (now.batch !== null && now.batch !== run.batch);
}

/** The run's rules joined to those tried before, once it is decided. */
export function triedAfter(store: TriedRules, keys: string[]): TriedRules {
  return { pending: null, tried: [...new Set([...store.tried, ...keys])].sort() };
}

const isOpen = ({ rule, status }: { rule: ActiveRule; status: RuleStatus }) =>
  rule.on && status.state === 'bad';

/**
 * The tried rules still open. One met since (or turned off) leaves the list
 * (triedStill), so if the person's edits open it again, it's the agent's.
 */
export function triedOpen<T extends { rule: ActiveRule; status: RuleStatus }>(
  tried: readonly string[],
  rules: T[],
): Set<string> {
  const keys = new Set(tried);
  return new Set(rules.filter((r) => keys.has(r.rule.key) && isOpen(r)).map((r) => r.rule.key));
}

/** The tried list with the rules met or turned off since dropped; the same list when none are. */
export function triedStill<T extends { rule: ActiveRule; status: RuleStatus }>(
  tried: string[],
  rules: T[],
): string[] {
  const open = triedOpen(tried, rules);
  return open.size === tried.length ? tried : tried.filter((key) => open.has(key));
}

/**
 * One state per rule (editor test 2026-11-12): the open rules the Content
 * Agent can still close, less those it never fixes, a setting only the
 * person fills (Who it's for), those held by what the page keeps, those it
 * tried and couldn't close, and those this page can't meet. The Fix
 * buttons, a Fix run, Next's step and its steps window all read it, so
 * none offers the agent a rule another calls the person's. `yours`: the
 * other open rules, the person's to decide.
 */
export function agentFixable<T extends { rule: ActiveRule; status: RuleStatus }>(
  rules: T[],
  {
    held = NO_HELD,
    tried = NO_HELD,
    only,
  }: { held?: ReadonlySet<string>; tried?: ReadonlySet<string>; only?: readonly string[] } = {},
): { fixable: T[]; yours: T[] } {
  const open = rules.filter(
    (r) => isOpen(r) && !notCheckedHere(r.status) && (!only || only.includes(r.rule.key)),
  );
  const fixable = open.filter(
    ({ rule, status }) =>
      !NOT_FOR_AGENT.has(rule.key) &&
      !held.has(rule.key) &&
      !tried.has(rule.key) &&
      !(status.state === 'bad' && status.code === 'notSet'),
  );
  return { fixable, yours: open.filter((r) => !fixable.includes(r)) };
}
