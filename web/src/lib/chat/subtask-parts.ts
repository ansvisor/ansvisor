import type { ChatPartStatus, ChatPartStep, ChatStep, ChatStepPart } from './events';

/**
 * The parts of a "Working on N parts" step (CHAT-27 item 7), from their runs
 * alone: what the live step and a reload show alike. Pure, for the server
 * (subtasks.ts, thread.ts) and the browser.
 */

/** A part as its run is stored: its title, its run's status and its steps. */
export interface PartRun {
  title: string;
  /** chat_runs.status */
  status: string;
  steps: ChatPartStep[];
}

/** A part's status from its run's: a stopped run is stopped, a run at its cap paused. */
export function partStatusOf(runStatus: string): ChatPartStatus {
  switch (runStatus) {
    case 'done':
      return 'done';
    case 'error':
      return 'failed';
    case 'stopped':
      return 'stopped';
    case 'waiting':
      return 'waiting';
    case 'paused':
    case 'paused_cap':
      return 'paused';
    default:
      return 'running';
  }
}

export const partOf = (run: PartRun): ChatStepPart => ({
  title: run.title,
  status: partStatusOf(run.status),
  steps: [...run.steps].sort((a, b) => a.n - b.n),
});

/** A step that splits the run into parts: its rowCount counts them. */
export const isPartsStep = (step: Pick<ChatStep, 'scope'>) => step.scope?.unit === 'parts';

/** The parts that have ended, whichever way (done, failed, stopped, paused). */
export const partsEnded = (parts: readonly ChatStepPart[]) =>
  parts.filter((part) => part.status !== 'running' && part.status !== 'waiting').length;

/**
 * A run's steps with their parts, for a reload (thread.ts): its parts steps,
 * in order, take its parts in the order they were made, each as many as
 * its rowCount (a run splits at most twice).
 */
export function withParts(steps: readonly ChatStep[], parts: readonly PartRun[]): ChatStep[] {
  const ordered = [...steps].sort((a, b) => a.n - b.n);
  if (parts.length === 0) return ordered;
  let next = 0;
  return ordered.map((step) => {
    if (!isPartsStep(step)) return step;
    const mine = parts.slice(next, next + (step.rowCount ?? 0)).map(partOf);
    next += mine.length;
    return mine.length > 0 ? { ...step, parts: mine } : step;
  });
}
