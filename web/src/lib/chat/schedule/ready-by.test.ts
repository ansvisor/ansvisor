import { describe, expect, it } from 'vitest';
import {
  READY_BY_RETRIES,
  READY_BY_RETRY_GAP_MS,
  isReadyBy,
  readyByAnswer,
  readyByNext,
} from './ready-by';

/**
 * A job with a due time's rule (W4-30, Teknik T5): a miss is tried again
 * at most 3 times, at least 30 minutes apart, never at or after the due
 * time; what is ready is delivered when all is ready, when the tries are
 * used up, or at the due time, with the rest listed.
 */

const NOW = new Date('2026-11-02T06:00:00.000Z');
const DUE = '2026-11-04T06:00:00.000Z';
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();
const facts = (over: Partial<Parameters<typeof readyByNext>[0]> = {}) => ({
  dueAt: DUE,
  now: NOW,
  complete: false,
  progressed: false,
  retries: 0,
  gapFrom: NOW,
  ...over,
});

describe('readyByNext', () => {
  it('tries a miss again 30 minutes on, at most 3 times, then delivers what is ready', () => {
    expect(READY_BY_RETRIES).toBe(3);
    expect(READY_BY_RETRY_GAP_MS).toBe(30 * 60_000);
    for (const retries of [0, 1, 2]) {
      expect(readyByNext(facts({ retries }))).toEqual({ kind: 'retry', at: minutes(30) });
    }
    expect(readyByNext(facts({ retries: 3 }))).toEqual({ kind: 'deliver', why: 'tries' });
  });

  it('keeps 30 minutes from the last run, or tries at once when they have passed', () => {
    const started = new Date(NOW.getTime() - 10 * 60_000);
    expect(readyByNext(facts({ gapFrom: started }))).toEqual({ kind: 'retry', at: minutes(20) });
    const longAgo = new Date(NOW.getTime() - 3 * 60 * 60_000);
    expect(readyByNext(facts({ gapFrom: longAgo }))).toEqual({ kind: 'retry', at: minutes(0) });
    expect(readyByNext(facts({ gapFrom: null }))).toEqual({ kind: 'retry', at: minutes(0) });
  });

  it('never tries at or after the due time: what is ready waits for it', () => {
    const due = minutes(30);
    expect(readyByNext(facts({ dueAt: due }))).toEqual({ kind: 'wait' });
    expect(readyByNext(facts({ dueAt: minutes(31) }))).toEqual({ kind: 'retry', at: minutes(30) });
  });

  it('delivers at the due time, whatever is left', () => {
    for (const over of [{}, { progressed: true }, { complete: true }, { retries: 3 }]) {
      expect(readyByNext(facts({ ...over, now: new Date(DUE) }))).toEqual({
        kind: 'deliver',
        why: 'due',
      });
    }
  });

  it('delivers once every part is ready, and goes on at once after a run that got further', () => {
    expect(readyByNext(facts({ complete: true }))).toEqual({ kind: 'deliver', why: 'ready' });
    expect(readyByNext(facts({ progressed: true, retries: 3 }))).toEqual({
      kind: 'run',
      at: NOW.toISOString(),
    });
  });
});

describe('isReadyBy', () => {
  it('is a one-time job ready by a date', () => {
    expect(isReadyBy({ kind: 'once', run_mode: 'ready_by', due_at: DUE })).toBe(true);
    expect(isReadyBy({ kind: 'once', run_mode: 'run_at', due_at: DUE })).toBe(false);
    expect(isReadyBy({ kind: 'recurring', run_mode: 'ready_by', due_at: null })).toBe(false);
  });
});

describe('readyByAnswer', () => {
  it('lists what is ready and what isn’t yet at the due time', () => {
    expect(
      readyByAnswer({
        why: 'due',
        title: 'Pricing tasks',
        due: 'Mon 19 Oct, 09:00',
        ready: ['Add FAQ block + schema to /pricing'],
        rest: ['Fix *title*', 'Rewrite intro'],
      }),
    ).toBe(
      [
        '**Pricing tasks**\nIt was due Mon 19 Oct, 09:00. 1 of 3 ready.',
        'Ready:\n- Add FAQ block + schema to /pricing',
        'Not ready yet:\n- Fix \\*title\\*\n- Rewrite intro',
        "What's ready is in this chat and in Files. Ask me to finish the rest.",
      ].join('\n\n'),
    );
  });

  it('says why it came early: all ready, or its tries used up', () => {
    expect(
      readyByAnswer({
        why: 'ready',
        title: 'Job',
        due: 'Mon 19 Oct, 09:00',
        ready: ['A'],
        rest: [],
      }),
    ).toBe(
      '**Job**\nEverything is ready, ahead of its due time (Mon 19 Oct, 09:00).\n\nReady:\n- A',
    );
    expect(
      readyByAnswer({ why: 'tries', title: 'Job', due: 'x', ready: [], rest: ['Job'] }),
    ).toContain('I tried 3 more times and stopped. 0 of 1 ready.\n\nNothing was ready.');
  });
});
