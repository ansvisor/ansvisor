import type { ChatConfirm, ChatDenialCard, ChatEvent, ChatRunSummary, ChatStep } from './events';
import { isChatEventType } from './events';

/**
 * A run as the browser draws it, built from its events only (CHAT-00: the
 * client renders from the events). The same events, live or replayed from
 * the start after a reload (`GET …/events?after=0`), build the same run
 * (CHAT-03 item 21). An event already applied (its seq) or of a type this
 * build doesn't know is skipped.
 */

export type ClientRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'done'
  | 'stopped'
  | 'error'
  | 'paused_cap';

export interface ClientRun {
  status: ClientRunStatus;
  /** In step order. */
  steps: ChatStep[];
  /** The answer so far. */
  text: string;
  /** The card the run waits on; null when none. */
  confirm: ChatConfirm | null;
  /** Out-of-permission answers, in order. */
  denials: ChatDenialCard[];
  summary: ChatRunSummary | null;
  generatedAt: string | null;
  dataAsOf: string | null;
  /** Why it ended in error, in words, when the server gave them. */
  errorReason: string | null;
  /** The last event applied: a reconnect asks for the ones after it. */
  lastSeq: number;
}

export function emptyRun(status: ClientRunStatus = 'running'): ClientRun {
  return {
    status,
    steps: [],
    text: '',
    confirm: null,
    denials: [],
    summary: null,
    generatedAt: null,
    dataAsOf: null,
    errorReason: null,
    lastSeq: 0,
  };
}

function withStep(steps: ChatStep[], step: ChatStep): ChatStep[] {
  const rest = steps.filter((s) => s.n !== step.n);
  return [...rest, step].sort((a, b) => a.n - b.n);
}

/** The run after one more event. Pure: the run given isn't changed. */
export function applyChatEvent(run: ClientRun, event: ChatEvent): ClientRun {
  if (!isChatEventType(event.type) || event.seq <= run.lastSeq) return run;
  const next: ClientRun = { ...run, lastSeq: event.seq };
  switch (event.type) {
    case 'step.started':
    case 'step.updated':
    case 'step.finished': {
      next.steps = withStep(run.steps, event.data.step);
      // A step that runs again after its card (approved) isn't waiting any more.
      if (
        run.confirm &&
        event.data.step.n === run.confirm.n &&
        event.data.step.status !== 'waiting'
      ) {
        next.confirm = null;
      }
      if (next.status === 'waiting' && !next.confirm) next.status = 'running';
      return next;
    }
    case 'text.delta':
      next.text = run.text + event.data.text;
      return next;
    case 'confirm.required':
      next.confirm = event.data;
      next.status = 'waiting';
      return next;
    case 'access.denied':
      next.denials = [...run.denials, event.data];
      return next;
    case 'run.finished': {
      const { generatedAt, dataAsOf, ...summary } = event.data;
      return { ...next, status: 'done', confirm: null, summary, generatedAt, dataAsOf };
    }
    case 'run.stopped': {
      const { reason: _reason, ...summary } = event.data;
      void _reason;
      return { ...next, status: 'stopped', confirm: null, summary };
    }
    case 'run.error': {
      const { code: _code, reason, ...summary } = event.data;
      void _code;
      return { ...next, status: 'error', confirm: null, summary, errorReason: reason ?? null };
    }
    case 'run.paused_cap':
      return { ...next, status: 'paused_cap', confirm: null, summary: event.data };
    default:
      return next;
  }
}

/** A run from its events, in any order and with repeats. */
export function runFromEvents(
  events: readonly ChatEvent[],
  start: ClientRun = emptyRun(),
): ClientRun {
  return [...events].sort((a, b) => a.seq - b.seq).reduce(applyChatEvent, start);
}
