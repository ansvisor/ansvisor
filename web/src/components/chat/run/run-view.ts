import type { ChatStep } from '@/lib/chat/events';

/**
 * What a run's answer shows of its steps (CHAT-03 items 12b–12d, 13–14),
 * from the steps alone: the live line's words, the grey steps line ("✓ Read
 * 3 sources") and its list, and the "Data used" chips.
 */

const READ = /^Read\s+/;

/**
 * "Read Citations" → "Citations": what a read step read. A read whose words
 * aren't "Read …" ("Opened a page", "Worked on a step") read no source: null.
 */
export const readSource = (label: string): string | null =>
  READ.test(label) ? label.replace(READ, '') : null;

/** "Opened ansvisor.com/pricing" → "ansvisor.com/pricing": the page a step opened. */
export const openedPage = (label: string) => label.replace(/^Opened\s+/, '');

/**
 * The live line's words, as their i18n key and values (item 12c): the
 * running step's own words in the present ("Reading Citations…"); without
 * one, "Writing the answer…" while text streams, else "Thinking…".
 */
export function statusLine(
  steps: readonly ChatStep[],
  streaming: boolean,
): { key: string; values?: Record<string, string> } {
  const running = [...steps].sort((a, b) => b.n - a.n).find((s) => s.status === 'running');
  if (!running || running.kind === 'thinking') {
    return { key: streaming ? 'writing' : 'thinking' };
  }
  const source = running.kind === 'read' ? readSource(running.label) : null;
  if (source !== null) return { key: 'read', values: { source } };
  if (running.kind === 'open_page') {
    return { key: 'openPage', values: { page: openedPage(running.label) } };
  }
  if (running.kind === 'check') return { key: 'check' };
  return { key: 'other', values: { label: running.label } };
}

/**
 * The steps the steps line lists (item 12d), in order: thinking left out,
 * and questions too: an answered one has its own line (CHAT-07 §A item 10).
 */
export const listedSteps = (steps: readonly ChatStep[]) =>
  [...steps].sort((a, b) => a.n - b.n).filter((s) => s.kind !== 'thinking' && s.kind !== 'ask');

/** The steps done, of those the steps line lists. */
export const doneSteps = (steps: readonly ChatStep[]) =>
  listedSteps(steps).filter((s) => s.status === 'done');

/**
 * What the steps line says of the steps done (item 12d), from their kinds:
 * one step in its own words ("Read Citations"); reads of sources and pages
 * counted ("Read 3 sources", "Read 2 sources and 1 page"), a fact check
 * after them named ("· checked facts"); anything else, how many steps. A
 * source read twice counts once, and a read's rows never show.
 */
export type StepsSummary =
  | { kind: 'one'; step: ChatStep; checked: boolean }
  | { kind: 'reads'; sources: number; pages: number; checked: boolean }
  | { kind: 'steps'; count: number };

export function stepsSummary(steps: readonly ChatStep[]): StepsSummary | null {
  const done = doneSteps(steps);
  if (done.length === 0) return null;
  if (done.length === 1) return { kind: 'one', step: done[0], checked: false };
  const rest = done.filter((s) => s.kind !== 'check');
  const checked = rest.length < done.length;
  if (rest.length === 1) return { kind: 'one', step: rest[0], checked };
  const sources = new Set<string>();
  const pages = new Set<string>();
  for (const step of rest) {
    if (step.kind === 'open_page') {
      pages.add(openedPage(step.label));
      continue;
    }
    const source =
      step.kind !== 'read'
        ? null
        : step.scope?.unit === 'items' && step.scope.subject
          ? step.scope.subject
          : readSource(step.label);
    if (source === null) return { kind: 'steps', count: done.length };
    sources.add(source);
  }
  // The same source read twice: its own words.
  if (sources.size + pages.size === 1) return { kind: 'one', step: rest[0], checked };
  return { kind: 'reads', sources: sources.size, pages: pages.size, checked };
}

export interface DataUsedChip {
  /** "Citations", or a page's address. */
  label: string;
  /** Memory's saved notes ("Memory · 3 items"); a read's rows are never shown. */
  items?: number;
}

/**
 * "Data used" (items 13–14): one chip per source a read step read, and per
 * page a step opened, in the order first read; a source read twice is one
 * chip. Each names its source only, never how many rows it read, 0 or 50.
 * Skills, thinking and checks are no source, nor a read whose words aren't
 * "Read …" (a page of the app it went to); memory is ("Used memory":
 * "Memory · 3 items", CHAT-14 item 17).
 */
export function dataUsed(steps: readonly ChatStep[]): DataUsedChip[] {
  const chips = new Map<string, DataUsedChip>();
  // What a run's parts read is its own (CHAT-27 item 9): each source once.
  const all = [...steps]
    .sort((a, b) => a.n - b.n)
    .flatMap((step) => [step, ...(step.parts ?? []).flatMap((part) => part.steps)]);
  for (const step of all) {
    if (step.status !== 'done') continue;
    if (step.kind === 'open_page') {
      const page = openedPage(step.label);
      if (!chips.has(`page:${page}`)) chips.set(`page:${page}`, { label: page });
      continue;
    }
    if (step.kind !== 'read') continue;
    if (step.scope?.unit === 'items' && step.scope.subject) {
      const key = `items:${step.scope.subject}`;
      chips.set(key, {
        label: step.scope.subject,
        ...(step.rowCount === undefined ? {} : { items: step.rowCount }),
      });
      continue;
    }
    const source = readSource(step.label);
    if (source === null) continue;
    const key = `read:${source}`;
    if (!chips.has(key)) chips.set(key, { label: source });
  }
  return [...chips.values()];
}
