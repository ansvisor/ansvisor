import { describe, expect, it } from 'vitest';
import { orderByPriority, scoreCandidate } from './candidates.js';
import { ENGINE_THRESHOLDS } from '../../config/action-engine.js';

const { priority } = ENGINE_THRESHOLDS;
const NOW = new Date('2026-09-25T02:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const candidate = (over = {}) => ({
  definitionId: 'recover_visibility',
  impact: 'medium',
  signalCount: 1,
  firstSeenAt: NOW.toISOString(),
  ...over,
});

describe('scoreCandidate', () => {
  it('ranks by impact before anything else', () => {
    const high = scoreCandidate(candidate({ impact: 'high' }), NOW);
    const medium = scoreCandidate(candidate({ impact: 'medium' }), NOW);
    const low = scoreCandidate(candidate({ impact: 'low' }), NOW);

    expect(high).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(low);
  });

  it('counts evidence, so two findings outrank one of the same grade', () => {
    expect(scoreCandidate(candidate({ signalCount: 4 }), NOW)).toBeGreaterThan(
      scoreCandidate(candidate({ signalCount: 1 }), NOW),
    );
  });

  /**
   * The term a queue needs and a sort does not. Without it a low-impact
   * finding behind a brand with a steady stream of urgent ones is never
   * worked on at all.
   */
  it('lifts a candidate that has been waiting', () => {
    expect(scoreCandidate(candidate({ firstSeenAt: daysAgo(10) }), NOW)).toBeGreaterThan(
      scoreCandidate(candidate({ firstSeenAt: daysAgo(0) }), NOW),
    );
  });

  it('stops paying for patience past the cap', () => {
    const capped = scoreCandidate(candidate({ firstSeenAt: daysAgo(priority.ageCapDays) }), NOW);
    expect(scoreCandidate(candidate({ firstSeenAt: daysAgo(400) }), NOW)).toBe(capped);
  });

  it('stops paying for evidence past the cap', () => {
    const capped = scoreCandidate(candidate({ signalCount: priority.evidenceCap }), NOW);
    expect(scoreCandidate(candidate({ signalCount: 500 }), NOW)).toBe(capped);
  });

  /**
   * The caps exist for this: a queue where forty low-impact pages outrank a
   * visibility collapse is not a priority order, it is a vote. A brand losing
   * ground right now is worked on first, however patient the rest of the
   * queue is.
   */
  it('never lets evidence and patience outrank a high-impact finding', () => {
    const loudest = scoreCandidate(
      candidate({ impact: 'medium', signalCount: 1000, firstSeenAt: daysAgo(400) }),
      NOW,
    );
    expect(scoreCandidate(candidate({ impact: 'high' }), NOW)).toBeGreaterThan(loudest);
  });

  /**
   * The other half of the same rule: patience must be worth *something*, or
   * the low-impact end of the queue is never reached at all. Compared at
   * equal evidence, so it is the wait doing the work and not the count.
   */
  it('lets a candidate that waited out the cap cross the grade above it', () => {
    const patient = scoreCandidate(
      candidate({ impact: 'low', signalCount: 2, firstSeenAt: daysAgo(30) }),
      NOW,
    );
    const fresh = scoreCandidate(candidate({ impact: 'medium', signalCount: 2 }), NOW);

    expect(patient).toBeGreaterThan(fresh);
  });

  it('does not let it cross two grades, however long it waits', () => {
    const patient = scoreCandidate(
      candidate({ impact: 'low', signalCount: 1000, firstSeenAt: daysAgo(400) }),
      NOW,
    );
    expect(patient).toBeLessThan(scoreCandidate(candidate({ impact: 'high' }), NOW));
  });

  it('treats an unknown impact as the lowest grade rather than as nothing', () => {
    expect(scoreCandidate(candidate({ impact: 'catastrophic' }), NOW)).toBe(
      scoreCandidate(candidate({ impact: 'low' }), NOW),
    );
  });

  it('scores a candidate first seen tonight without reading the clock wrong', () => {
    expect(scoreCandidate(candidate({ firstSeenAt: undefined }), NOW)).toBe(
      scoreCandidate(candidate({ firstSeenAt: NOW.toISOString() }), NOW),
    );
  });
});

describe('orderByPriority', () => {
  it('puts the worst problem first', () => {
    const ordered = orderByPriority(
      [
        candidate({ definitionId: 'a', impact: 'low' }),
        candidate({ definitionId: 'b', impact: 'high' }),
        candidate({ definitionId: 'c', impact: 'medium' }),
      ],
      NOW,
    );

    expect(ordered.map((c) => c.definitionId)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie on how long it has waited, oldest first', () => {
    const ordered = orderByPriority(
      [
        candidate({ definitionId: 'new', firstSeenAt: daysAgo(priority.ageCapDays + 1) }),
        candidate({ definitionId: 'older', firstSeenAt: daysAgo(priority.ageCapDays + 9) }),
      ],
      NOW,
    );

    // Both are past the age cap, so they score the same — the tie-break is
    // what decides, and it has to be the one that has waited longer.
    expect(ordered.map((c) => c.definitionId)).toEqual(['older', 'new']);
  });

  /**
   * A scoring bug that degrades to "alphabetical order" is invisible: the
   * engine still promotes something every night, just the wrong thing. This
   * is the shape that bug took once already.
   */
  it('produces a real number for every candidate, never NaN', () => {
    for (const c of [candidate(), candidate({ signalCount: undefined })]) {
      expect(Number.isFinite(scoreCandidate(c, NOW))).toBe(true);
    }
  });

  it('does not modify the list it was given', () => {
    const list = [
      candidate({ definitionId: 'a', impact: 'low' }),
      candidate({ definitionId: 'b', impact: 'high' }),
    ];
    orderByPriority(list, NOW);
    expect(list.map((c) => c.definitionId)).toEqual(['a', 'b']);
  });
});
