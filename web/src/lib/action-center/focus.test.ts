import { describe, expect, it } from 'vitest';
import {
  pickFocus,
  rankedIds,
  skippedActions,
  standingFrom,
  type FocusCandidate,
  type StandingSummary,
} from './focus';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const now = new Date('2026-11-11T09:00:00Z');
const me = 'user-1';

function actions(...list: Partial<FocusCandidate>[]): Map<string, FocusCandidate> {
  return new Map(
    list.map((a, i) => {
      const action = {
        id: a.id ?? id(i + 1),
        kind: 'visibility_drop',
        status: 'new',
        assigneeId: null,
        ...a,
      };
      return [action.id, action];
    }),
  );
}

const pick = (input: Partial<Parameters<typeof pickFocus>[0]>) =>
  pickFocus({
    pins: [],
    ranking: [],
    actions: new Map(),
    skipped: new Set(),
    userId: me,
    now,
    seenAt: null,
    ...input,
  });

describe("Today's focus", () => {
  it('fills the empty slots from the ranking, best first, three at most', () => {
    const all = actions({ id: id(1) }, { id: id(2) }, { id: id(3) }, { id: id(4) });
    const { slots, changed } = pick({ ranking: [id(2), id(1), id(4), id(3)], actions: all });
    expect(slots.map((s) => s.id)).toEqual([id(2), id(1), id(4)]);
    expect(slots.every((s) => s.addedAt === now.toISOString())).toBe(true);
    expect(changed).toBe(true);
  });

  it('keeps the actions the person has while they are open, ahead of a better-ranked one', () => {
    const pins = [
      { id: id(3), addedAt: '2026-11-09T08:00:00.000Z' },
      { id: id(1), addedAt: '2026-11-10T08:00:00.000Z' },
      { id: id(2), addedAt: '2026-11-10T08:00:00.000Z' },
    ];
    const all = actions(
      { id: id(1) },
      { id: id(2), status: 'in_progress' },
      { id: id(3) },
      { id: id(4) },
    );
    const { slots, changed } = pick({ pins, ranking: [id(4), id(1), id(2)], actions: all });
    expect(slots.map((s) => s.id)).toEqual([id(3), id(1), id(2)]);
    expect(changed).toBe(false);
  });

  it('frees the slot of one completed, dismissed, on hold, deleted or now someone else’s', () => {
    const pins = [1, 2, 3, 4, 5].map((n) => ({ id: id(n), addedAt: '2026-11-09T08:00:00.000Z' }));
    const all = actions(
      { id: id(1), status: 'completed' },
      { id: id(2), status: 'dismissed' },
      { id: id(3), status: 'on_hold' },
      // 4 can't be read any more (deleted).
      { id: id(5), assigneeId: 'someone-else' },
      { id: id(6) },
      { id: id(7), assigneeId: me },
    );
    const { slots, changed } = pick({ pins, ranking: [id(6), id(7)], actions: all });
    expect(slots.map((s) => s.id)).toEqual([id(6), id(7)]);
    expect(changed).toBe(true);
  });

  it('leaves out what the person skipped and reminders, pinned or ranked', () => {
    const pins = [{ id: id(1), addedAt: '2026-11-09T08:00:00.000Z' }];
    const all = actions(
      { id: id(1) },
      { id: id(2), kind: 'business_hub_numbers' },
      { id: id(3) },
      { id: id(4) },
    );
    const { slots } = pick({
      pins,
      ranking: [id(2), id(3), id(1), id(4)],
      actions: all,
      skipped: new Set([id(1)]),
    });
    expect(slots.map((s) => s.id)).toEqual([id(3), id(4)]);
  });

  it('marks New only a slot filled since the last visit, and none on a first visit', () => {
    const pins = [
      { id: id(1), addedAt: '2026-11-09T08:00:00.000Z' },
      { id: id(2), addedAt: '2026-11-10T20:00:00.000Z' },
    ];
    const all = actions({ id: id(1) }, { id: id(2) }, { id: id(3) });
    const seen = pick({
      pins,
      ranking: [id(3)],
      actions: all,
      seenAt: '2026-11-10T09:00:00.000Z',
    });
    expect(seen.slots.map((s) => [s.id, s.isNew])).toEqual([
      [id(1), false],
      [id(2), true],
      [id(3), true],
    ]);
    const first = pick({ pins, ranking: [id(3)], actions: all, seenAt: null });
    expect(first.slots.some((s) => s.isNew)).toBe(false);
  });

  it('reads skips from the hidden cards and the ranking from the server’s answer', () => {
    expect(skippedActions({ setup: null, [`skip:${id(1)}`]: '2026-11-18T00:00:00Z' })).toEqual(
      new Set([id(1)]),
    );
    expect(
      rankedIds({
        today: [{ id: 'a' }, { id: 'b' }, { nope: 1 }],
        next: [{ id: 'b' }, { id: 'c' }],
      }),
    ).toEqual(['a', 'b', 'c']);
    expect(rankedIds(null)).toEqual([]);
  });
});

describe('Where you stand', () => {
  const summary = (score: number | null, competitors: [string, number | null][]) =>
    ({
      brand: { name: 'Brewline' },
      totals: { aiVisibilityScore: score },
      topCompetitors: competitors.map(([name, s]) => ({ name, score: s })),
    }) satisfies StandingSummary;

  it('ranks the brand among competitors with a score, with the gap to the one ahead', () => {
    const current = summary(53.94, [
      ['Northbound', 60.1],
      ['Morning Ritual', 41.2],
      ['Kettle', null],
      ['Bean Co', 30],
    ]);
    const previous = summary(53.5, [
      ['Northbound', 60],
      ['Morning Ritual', 37.1],
    ]);
    expect(standingFrom(current, previous)).toEqual({
      score: 53.9,
      change: 0.4,
      rank: 2,
      of: 4,
      neighbour: { name: 'Northbound', gap: 6.2, ahead: false },
      competitors: [
        { name: 'Northbound', score: 60.1, change: 0.1 },
        { name: 'Morning Ritual', score: 41.2, change: 4.1 },
        { name: 'Bean Co', score: 30, change: null },
      ],
    });
  });

  it('names the brand behind when it leads, wins a tie, and has no change without a run before', () => {
    const lead = standingFrom(
      summary(50, [
        ['Rival', 50],
        ['Other', 40],
      ]),
      null,
    );
    expect(lead).toMatchObject({ rank: 1, of: 3, change: null });
    expect(lead?.neighbour).toEqual({ name: 'Rival', gap: 0, ahead: true });
    expect(standingFrom(summary(12, []), null)?.neighbour).toBeNull();
  });

  it('has nothing to say without a score', () => {
    expect(standingFrom(summary(null, [['Rival', 50]]), null)).toBeNull();
  });
});
