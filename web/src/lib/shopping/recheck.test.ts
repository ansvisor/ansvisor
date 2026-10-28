import { describe, expect, it } from 'vitest';
import {
  actionResult,
  resultKey,
  resultTrend,
  shelfPresence,
  type RecheckAction,
  type RecheckCard,
} from './recheck';

/** A done Products action, 7 days on (ECOM-018). */

const DAY = 86_400_000;
const DONE = '2026-10-20T00:00:00.000Z';

const action: RecheckAction = {
  id: 'a1',
  actionNo: 7,
  target: { type: 'product', id: 'ridge' },
  completedAt: DONE,
  promptIds: ['q1', 'q2'],
};

const card = (over: Partial<RecheckCard>): RecheckCard => ({
  promptId: 'q1',
  platform: 'chatgpt-shopping',
  at: '2026-10-15T08:00:00Z',
  own: false,
  productId: null,
  ...over,
});

const cards = [
  // The week before: two shelves, the product on neither (another of the brand's on one).
  card({}),
  card({ platform: 'gemini-web', own: true, productId: 'other' }),
  // The week after: the product on q1's ChatGPT shelf, q2's read without it.
  card({ at: '2026-10-22T08:00:00Z' }),
  card({ at: '2026-10-22T08:00:00Z', own: true, productId: 'ridge' }),
  card({ promptId: 'q2', at: '2026-10-23T08:00:00Z' }),
  // Not its questions, or outside both weeks.
  card({ promptId: 'q9', at: '2026-10-22T08:00:00Z', own: true, productId: 'ridge' }),
  card({ at: '2026-10-28T08:00:00Z', own: true, productId: 'ridge' }),
  card({ at: '2026-10-01T08:00:00Z', own: true, productId: 'ridge' }),
];

describe('shelfPresence', () => {
  it("counts the action's shelves in the window and those the product was on", () => {
    const done = Date.parse(DONE);
    expect(shelfPresence(cards, action, done - 7 * DAY, done)).toEqual({ shelves: 2, on: 0 });
    expect(shelfPresence(cards, action, done, done + 7 * DAY)).toEqual({ shelves: 2, on: 1 });
  });

  it("counts any of the brand's products for a category", () => {
    const done = Date.parse(DONE);
    const category = { ...action, target: { type: 'category' as const, id: 'c1' } };
    expect(shelfPresence(cards, category, done - 7 * DAY, done)).toEqual({ shelves: 2, on: 1 });
  });
});

describe('actionResult', () => {
  it('waits for the 7 days after, then sets them beside the 7 before', () => {
    const pending = actionResult(action, cards, Date.parse('2026-10-25T00:00:00Z'));
    expect(pending).toMatchObject({
      actionId: 'a1',
      actionNo: 7,
      readyAt: '2026-10-27T00:00:00.000Z',
      before: { shelves: 2, on: 0 },
      after: null,
    });
    expect(resultTrend(pending)).toBeNull();
    const ready = actionResult(action, cards, Date.parse('2026-10-27T00:00:00Z'));
    expect(ready.after).toEqual({ shelves: 2, on: 1 });
    expect(resultTrend(ready)).toBe('better');
  });

  it('reads no trend when no answer was read in the week after', () => {
    const quiet = actionResult(action, [card({})], Date.parse('2026-11-01T00:00:00Z'));
    expect(quiet.after).toEqual({ shelves: 0, on: 0 });
    expect(resultTrend(quiet)).toBeNull();
  });
});

describe('resultTrend', () => {
  const result = (before: [number, number], after: [number, number]) =>
    resultTrend({
      actionId: 'a1',
      actionNo: 1,
      completedAt: DONE,
      readyAt: DONE,
      before: { on: before[0], shelves: before[1] },
      after: { on: after[0], shelves: after[1] },
    });

  it('compares the share of shelves, not the counts', () => {
    expect(result([2, 4], [2, 2])).toBe('better');
    expect(result([2, 2], [2, 4])).toBe('worse');
    expect(result([1, 2], [2, 4])).toBe('same');
    expect(result([0, 0], [0, 3])).toBe('same');
  });
});

it('keys a result by its target', () => {
  expect(resultKey({ type: 'category', id: 'c1' })).toBe('category:c1');
});
