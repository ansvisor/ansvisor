import { describe, expect, it } from 'vitest';
import type { Signal } from '@/lib/signals/map';
import { asSentence, changeDirection, largestRivalMove, pickChanges, sinceStart } from './since';

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
      signal('m-big', { impact: 'medium', changeValue: 9 }),
      signal('h-small', { changeValue: -2 }),
      signal('low', { impact: 'low', changeValue: -40 }),
      signal('h-big', { changeValue: -12 }),
      signal('m-1', { impact: 'medium', changeValue: 1 }),
      signal('m-2', { impact: 'medium', changeValue: 2 }),
      signal('m-3', { impact: 'medium', changeValue: 3 }),
    ];
    const { items, total, small } = pickChanges(signals, new Set());
    expect(items.map((s) => s.id)).toEqual(['h-big', 'h-small', 'm-big', 'm-3', 'm-2']);
    expect(total).toBe(6);
    expect(small).toBe(1);
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
