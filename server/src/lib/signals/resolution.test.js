import { describe, expect, it, vi } from 'vitest';

// record.js and detect.js reach the admin client at import time, whose config
// hard-exits without SUPABASE_* env (as in CI). Nothing here reads it.
vi.mock('../../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../pulse/metrics.js', () => ({
  computePulseMetrics: vi.fn(),
  isTransientDbError: () => false,
}));

import { overflowRefreshes, signalsToResolve } from './record.js';
import { cap } from './library/detect.js';
import { ENGINE_THRESHOLDS } from '../../config/action-engine.js';

const max = ENGINE_THRESHOLDS.library.maxSignalsPerKind;
const KIND = 'competitor_cited_source';

const finding = (i) => ({ kind: KIND, dedupKey: `${KIND}:d${i}`, currentValue: 100 - i });
const row = (i, status = 'new') => ({
  id: `s${i}`,
  kind: KIND,
  dedup_key: `${KIND}:d${i}`,
  status,
});

describe('the per-kind cap', () => {
  const found = Array.from({ length: max + 2 }, (_, i) => finding(i));
  const capped = cap(found, (x) => x.currentValue);

  it('keeps the strongest findings as signals', () => {
    expect(capped.filter((x) => !x.overflow).map((x) => x.dedupKey)).toEqual(
      found.slice(0, max).map((x) => x.dedupKey),
    );
  });

  /** Dropping them would make "not in the top five" read as "not there". */
  it('marks the rest instead of dropping them', () => {
    expect(capped.filter((x) => x.overflow).map((x) => x.dedupKey)).toEqual(
      found.slice(max).map((x) => x.dedupKey),
    );
  });
});

describe('which signals a night closes', () => {
  /**
   * The failure this guards: a second pass the same night reranked sources,
   * and every signal that slipped from fifth to sixth was closed as solved
   * while the problem it described was still there.
   */
  it('does not close a signal whose finding only moved down the ranking', () => {
    const existing = [row(0), row(5)];
    const kept = [finding(0)];
    const overflow = [finding(5)];
    expect(signalsToResolve(existing, [...kept, ...overflow], new Set())).toEqual([]);
  });

  it('closes one whose finding is gone', () => {
    const existing = [row(0), row(9)];
    expect(signalsToResolve(existing, [finding(0)], new Set()).map((r) => r.id)).toEqual(['s9']);
  });

  it('does not close a kind whose detector failed tonight', () => {
    expect(signalsToResolve([row(9)], [], new Set([KIND]))).toEqual([]);
  });

  it('leaves signals someone already closed alone', () => {
    expect(signalsToResolve([row(9, 'dismissed'), row(8, 'resolved')], [], new Set())).toEqual([]);
  });
});

describe('what an over-cap finding writes', () => {
  const existing = (rows) => new Map(rows.map((r) => [r.dedup_key, r]));

  it('refreshes the open signal it keeps open', () => {
    const refreshes = overflowRefreshes([finding(5)], existing([row(5, 'acknowledged')]));
    expect(refreshes.map((r) => r.current.id)).toEqual(['s5']);
  });

  /** The cap bounds what a night writes; the overflow must not get around it. */
  it('raises nothing new', () => {
    expect(overflowRefreshes([finding(5)], existing([]))).toEqual([]);
  });

  /** It comes back when it ranks again, as a new observation. */
  it('does not reopen a closed one', () => {
    expect(overflowRefreshes([finding(5)], existing([row(5, 'resolved')]))).toEqual([]);
    expect(overflowRefreshes([finding(5)], existing([row(5, 'dismissed')]))).toEqual([]);
  });
});
