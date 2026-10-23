import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Content Agent's runs, step by step (CE-027/035, 00249): written as they
 * go, shown in the editor, and stopped from it — a run stopped keeps nothing.
 */

let rows;
let writes;
let failInsert;

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, filters: [] };
      const chain = {
        insert: (value) => {
          writes.push({ table, op: 'insert', value });
          return {
            select: () => ({
              single: async () =>
                failInsert
                  ? { data: null, error: new Error('down') }
                  : { data: { id: 'run-1' }, error: null },
            }),
          };
        },
        update: (value) => (writes.push({ table, op: 'update', value, call }), chain),
        select: () => chain,
        eq: (col, v) => (call.filters.push(['eq', col, v]), chain),
        is: (col, v) => (call.filters.push(['is', col, v]), chain),
        gt: (col, v) => (call.filters.push(['gt', col, v]), chain),
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (resolve) => resolve({ data: rows.updated ?? [], error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const {
  RunStoppedError,
  advanceRun,
  callSignal,
  finishRun,
  isStop,
  runSteps,
  startRun,
  stopDraftRun,
  stopIfStopped,
  wasStopped,
} = await import('./content-runs.js');

beforeEach(() => {
  rows = {};
  writes = [];
  failInsert = false;
});

describe('runSteps', () => {
  it('names each kind’s steps by the data it reads', () => {
    expect(runSteps('fix', { pages: 20, fanouts: 21, queries: 10 })).toEqual([
      { key: 'read_pages', count: 20 },
      { key: 'match_fanouts', count: 21 },
      { key: 'check_queries', count: 10 },
      { key: 'write_changes', count: null },
    ]);
    expect(runSteps('rewrite', { sources: 52, rules: 14 }).map((s) => s.key)).toEqual([
      'read_sources',
      'rewrite_page',
      'check_rules',
    ]);
    expect(runSteps('brief', { sources: 52 })[0]).toEqual({ key: 'read_sources', count: 52 });
    expect(runSteps('write', {}).map((s) => s.count)).toEqual([null, null, null]);
  });
});

describe('a run', () => {
  it('is written with its steps, moves on, and ends done with what it learned', async () => {
    const run = await startRun({
      draftId: 'd1',
      kind: 'fix',
      counts: { pages: 2, fanouts: 3, queries: 1 },
    });
    expect(run.id).toBe('run-1');
    // Runs a stopped server left on the draft are closed first.
    expect(writes[0]).toMatchObject({
      table: 'content_agent_runs',
      op: 'update',
      value: { outcome: 'failed', finished_at: expect.any(String) },
    });
    expect(writes[0].call.filters).toEqual([
      ['eq', 'draft_id', 'd1'],
      ['is', 'finished_at', null],
    ]);
    expect(writes[1]).toMatchObject({
      table: 'content_agent_runs',
      op: 'insert',
      value: { draft_id: 'd1', kind: 'fix' },
    });
    await advanceRun(run, 3);
    expect(writes[2].value).toMatchObject({ step: 3 });
    expect(writes[2].call.filters).toContainEqual(['is', 'finished_at', null]);
    await finishRun(run, 'done', { 3: 4 });
    expect(writes[3].value).toMatchObject({
      outcome: 'done',
      step: 4,
      steps: expect.arrayContaining([{ key: 'write_changes', count: 4 }]),
    });
  });

  it('still runs when it can’t be written: no steps, and its timeout', async () => {
    failInsert = true;
    const run = await startRun({ draftId: 'd1', kind: 'brief', counts: {} });
    expect(run.id).toBeNull();
    await advanceRun(run, 1);
    await finishRun(run, 'done');
    // The earlier runs' close and the insert: no step, no end.
    expect(writes).toHaveLength(2);
    expect(await wasStopped(run)).toBe(false);
  });

  it('is stopped by a request: marked, its model call aborted, and nothing kept', async () => {
    const run = await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    rows.updated = [{ id: 'run-1' }];
    await expect(stopDraftRun('d1')).resolves.toBe(true);
    const mark = writes.find((w) => w.op === 'update' && 'stopped_at' in w.value);
    expect(mark.value).toEqual({ stopped_at: expect.any(String) });
    // Only a run under way: one a stopped server left long ago isn't.
    expect(mark.call.filters).toEqual([
      ['eq', 'draft_id', 'd1'],
      ['is', 'finished_at', null],
      ['is', 'stopped_at', null],
      ['gt', 'started_at', expect.any(String)],
    ]);
    expect(run.signal.aborted).toBe(true);
    expect(isStop(new Error('This operation was aborted'), run)).toBe(true);
    await expect(stopIfStopped(run)).rejects.toBeInstanceOf(RunStoppedError);
    await finishRun(run, 'stopped');
  });

  it('reads a stop made on another server, and answers no run under way', async () => {
    const run = await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    rows.content_agent_runs = { stopped_at: '2026-10-23T10:00:00Z' };
    expect(await wasStopped(run)).toBe(true);
    expect(isStop(new RunStoppedError(), run)).toBe(true);
    expect(isStop(new Error('model down'), run)).toBe(false);
    await finishRun(run, 'failed');
    rows.updated = [];
    await expect(stopDraftRun('d1')).resolves.toBe(false);
  });

  it('tells its own Stop from a call that timed out', async () => {
    const run = await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    const signal = callSignal(run, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The call's timeout fired, not the run's Stop: a failure, not a stop.
    expect(signal.aborted).toBe(true);
    expect(run.signal.aborted).toBe(false);
    expect(isStop(Object.assign(new Error('timed out'), { name: 'TimeoutError' }), run)).toBe(
      false,
    );
    await finishRun(run, 'failed');
  });
});
