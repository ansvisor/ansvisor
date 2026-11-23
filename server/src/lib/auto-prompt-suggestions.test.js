import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshBrandSuggestions = vi.fn();
let db;

vi.mock('./prompt-suggestion-refresh.js', () => ({ refreshBrandSuggestions }));

/** A chain that records its filters and resolves to the table's canned read. */
function query(table) {
  const q = { table, filters: [] };
  const chain = {
    select: (_cols, opts) => ((q.head = !!opts?.head), chain),
    eq: (col, val) => (q.filters.push(['eq', col, val]), chain),
    neq: (col, val) => (q.filters.push(['neq', col, val]), chain),
    gt: (col, val) => (q.filters.push(['gt', col, val]), chain),
    order: () => chain,
    limit: () => chain,
    then: (resolve, reject) => Promise.resolve(db.read(q)).then(resolve, reject),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));

const { AUTO_SUGGEST_EVERY_DAYS, autoSuggestPrompts, everyNeedCovered, suggestionsDue } =
  await import('./auto-prompt-suggestions.js');

const NOW = Date.parse('2026-11-21T03:00:00Z');
const DAY = 86_400_000;
const covered = { generated: 0, merged: 0, scope: { needs: 4, covered: 3, noAnswers: 1 } };
const plan = { limits: { features: ['content_optimization', 'prompt_suggestions'] } };
const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  refreshBrandSuggestions.mockReset().mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
  log.error.mockReset();
  db = {
    topics: [{ id: 't1' }],
    waiting: 0,
    last: new Date(NOW - 8 * DAY).toISOString(),
    error: null,
    read(q) {
      if (this.error) return { data: null, error: this.error };
      if (q.table === 'topics') return { data: this.topics, error: null };
      if (q.head) return { count: this.waiting, error: null };
      return { data: this.last ? [{ generated_at: this.last }] : [], error: null };
    },
  };
});

describe('everyNeedCovered', () => {
  it('holds when no need with answers is left without an opportunity', () => {
    expect(everyNeedCovered(covered)).toBe(true);
  });

  it("doesn't when the run wrote some, hit the limit, had needs left or none at all", () => {
    expect(everyNeedCovered({ ...covered, generated: 1 })).toBe(false);
    expect(everyNeedCovered({ ...covered, limited: true })).toBe(false);
    expect(everyNeedCovered({ ...covered, scope: { needs: 4, covered: 2, noAnswers: 1 } })).toBe(
      false,
    );
    expect(everyNeedCovered({ generated: 0, merged: 0 })).toBe(false);
    expect(everyNeedCovered({ ...covered, scope: { needs: 0, covered: 0, noAnswers: 0 } })).toBe(
      false,
    );
    expect(everyNeedCovered(null)).toBe(false);
  });
});

describe('suggestionsDue', () => {
  it(`is due with nothing waiting and the last batch ${AUTO_SUGGEST_EVERY_DAYS} days old or more`, () => {
    const at = (days) => new Date(NOW - days * DAY).toISOString();
    expect(suggestionsDue({ waiting: 0, lastGeneratedAt: null, now: NOW })).toBe(true);
    expect(suggestionsDue({ waiting: 0, lastGeneratedAt: at(7), now: NOW })).toBe(true);
    expect(suggestionsDue({ waiting: 0, lastGeneratedAt: at(6), now: NOW })).toBe(false);
    expect(suggestionsDue({ waiting: 2, lastGeneratedAt: at(30), now: NOW })).toBe(false);
  });
});

describe('autoSuggestPrompts', () => {
  const run = (over = {}) =>
    autoSuggestPrompts('b1', { orgId: 'o1', plan, result: covered, log, now: NOW, ...over });

  it('refreshes the suggestions once every need is covered', async () => {
    await expect(run()).resolves.toEqual({ refreshed: true, count: 2 });
    expect(refreshBrandSuggestions).toHaveBeenCalledExactlyOnceWith('b1', { orgId: 'o1', log });
  });

  it('leaves them alone while needs are open, or without the feature', async () => {
    await expect(run({ result: { ...covered, generated: 2 } })).resolves.toEqual({
      refreshed: false,
    });
    await expect(
      run({ plan: { limits: { features: ['content_optimization'] } } }),
    ).resolves.toEqual({ refreshed: false });
    expect(refreshBrandSuggestions).not.toHaveBeenCalled();
  });

  it('never replaces suggestions still waiting, nor refreshes within the week or without a topic', async () => {
    db.waiting = 3;
    await run();
    db.waiting = 0;
    db.last = new Date(NOW - 2 * DAY).toISOString();
    await run();
    db.last = null;
    db.topics = [];
    await run();
    expect(refreshBrandSuggestions).not.toHaveBeenCalled();
  });

  it('logs a failure instead of throwing', async () => {
    refreshBrandSuggestions.mockRejectedValue(new Error('model down'));
    await expect(run()).resolves.toEqual({ refreshed: false });
    db.error = new Error('read failed');
    await expect(run()).resolves.toEqual({ refreshed: false });
    expect(log.error).toHaveBeenCalledTimes(2);
  });
});
