import { describe, expect, it } from 'vitest';
import type { Signal } from '@/lib/signals/map';
import {
  asSentence,
  changeDirection,
  groupChanges,
  largestRivalMove,
  pickChanges,
  sinceStart,
} from './since';

const now = new Date('2026-11-17T09:00:00Z');

function signal(id: string, overrides: Partial<Signal> = {}): Signal {
  return {
    id,
    category: 'visibility',
    kind: 'sharp_drop',
    impact: 'high',
    status: 'new',
    source: ['ai_results'],
    detectedAt: '2026-11-17T04:00:00Z',
    lastDetectedAt: '2026-11-17T04:00:00Z',
    resolvedAt: null,
    previousValue: 40,
    currentValue: 30,
    changeValue: -10,
    payload: {},
    kpiKeys: [],
    actionId: null,
    where: { platforms: [], locations: [] } as unknown as Signal['where'],
    ...overrides,
  };
}

describe('Since yesterday: the window', () => {
  it('starts at the earlier of the last visit and the latest nightly run', () => {
    expect(
      sinceStart({
        seenAt: '2026-11-17T08:00:00Z',
        nightlyStart: '2026-11-17T03:00:00Z',
        now,
      }),
    ).toBe('2026-11-17T03:00:00.000Z');
    // Last seen on Friday: a Monday reads "Since Friday".
    expect(
      sinceStart({ seenAt: '2026-11-14T10:00:00Z', nightlyStart: '2026-11-17T03:00:00Z', now }),
    ).toBe('2026-11-14T10:00:00.000Z');
  });

  it('reaches a week back at most, and a day with neither', () => {
    expect(sinceStart({ seenAt: '2026-10-01T00:00:00Z', nightlyStart: null, now })).toBe(
      '2026-11-10T09:00:00.000Z',
    );
    expect(sinceStart({ seenAt: null, nightlyStart: null, now })).toBe('2026-11-16T09:00:00.000Z');
  });
});

describe('Since yesterday: the changes', () => {
  it('lists high then medium impact, the biggest change first, at most 5', () => {
    const signals = [
      signal('m-big', { impact: 'medium', kind: 'prompt_gain', changeValue: 9 }),
      signal('h-small', { kind: 'visibility_slipping', changeValue: -2 }),
      signal('low', { impact: 'low', changeValue: -40 }),
      signal('h-big', { changeValue: -12 }),
      signal('m-1', { impact: 'medium', kind: 'platform_gap', changeValue: 1 }),
      signal('m-2', { impact: 'medium', kind: 'new_engine', changeValue: 2 }),
      signal('m-3', { impact: 'medium', kind: 'first_citation', changeValue: 3 }),
    ];
    const { items, total, small } = pickChanges(signals, new Set());
    expect(items.map((s) => s.id)).toEqual(['h-big', 'h-small', 'm-big', 'm-3', 'm-2']);
    expect(total).toBe(6);
    expect(small).toBe(1);
  });

  it('counts changes of one kind as one row, and keeps all of them (AC-06)', () => {
    const rival = (id: string, changeValue: number, actionId: string | null) =>
      signal(id, {
        category: 'competitor',
        kind: 'competitor_leads',
        changeValue,
        actionId,
        payload: { name: id },
      });
    const signals = [
      rival('r1', 20, 'a1'),
      rival('r2', 19, 'a1'),
      rival('r3', 18, null),
      rival('r4', 17, 'a1'),
      rival('r5', 16, 'a1'),
      signal('drop', { changeValue: -12 }),
      signal('gain', { kind: 'prompt_gain', changeValue: 9 }),
      signal('slip', { kind: 'visibility_slipping', changeValue: -5 }),
      signal('gap', { kind: 'platform_gap', changeValue: -4 }),
      signal('cite', { kind: 'first_citation', changeValue: 3 }),
    ];
    const { items, total } = pickChanges(signals, new Set());
    // Five rows: the five rivals, then four others; the fifth other is left for All signals.
    expect(items).toHaveLength(9);
    expect(items.map((s) => s.id)).not.toContain('cite');
    expect(total).toBe(10);
    const groups = groupChanges(items);
    expect(groups.map((g) => g.kind)).toEqual([
      'competitor_leads',
      'sharp_drop',
      'prompt_gain',
      'visibility_slipping',
      'platform_gap',
    ]);
    expect(groups[0].signals.map((s) => s.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
    expect(groups[0].actionIds).toEqual(['a1']);
    expect(groups[1].actionIds).toEqual([]);
  });

  it("leaves out signals whose section is off the person's menu", () => {
    const signals = [
      signal('vis'),
      signal('rival', { category: 'competitor', kind: 'competitor_surge' }),
      signal('cite', { category: 'citation', kind: 'lost_citations' }),
      signal('audit', { category: 'technical', kind: 'audit_low_score', impact: 'low' }),
    ];
    const picked = pickChanges(signals, new Set(['competitors', 'citations', 'audit']));
    expect(picked.items.map((s) => s.id)).toEqual(['vis']);
    expect(picked.small).toBe(0);
  });

  it('reads good news as Up, bad as Down and a competitor gaining as Rival', () => {
    expect(changeDirection({ kind: 'prompt_gain', category: 'visibility' })).toBe('up');
    expect(changeDirection({ kind: 'competitor_overtaken', category: 'competitor' })).toBe('up');
    expect(changeDirection({ kind: 'sharp_drop', category: 'visibility' })).toBe('down');
    expect(changeDirection({ kind: 'lost_citations', category: 'citation' })).toBe('down');
    expect(changeDirection({ kind: 'competitor_surge', category: 'competitor' })).toBe('rival');
  });

  it("measures competitors' largest move for a quiet day", () => {
    expect(largestRivalMove([{ change: 0.4 }, { change: -1.6 }, { change: null }])).toBe(1.6);
    expect(largestRivalMove([])).toBe(0);
  });

  it('ends a change’s line as a sentence before “An action was added.”', () => {
    expect(asSentence('Northbound Roasters is mentioned far more than you')).toBe(
      'Northbound Roasters is mentioned far more than you.',
    );
    expect(asSentence('Visibility gained for “cold brew” ')).toBe(
      'Visibility gained for “cold brew”.',
    );
    expect(asSentence('Cited again.')).toBe('Cited again.');
    expect(asSentence('A new rival!')).toBe('A new rival!');
    expect(asSentence('Why the drop?')).toBe('Why the drop?');
  });
});
