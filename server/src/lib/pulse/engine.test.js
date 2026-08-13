import { describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { pulseWindowKey } from './engine.js';

/**
 * Pulse window dedupe (#701).
 *
 * Two mails an hour apart carried identical figures because the daily KPI
 * window anchors to the tracking-run ledger while the dedupe slot is keyed on
 * the calendar date. The window key is what lets the second one recognise
 * itself as a repeat.
 */
describe('pulseWindowKey', () => {
  const anchored = (to) => ({ window: { from: '2026-08-10T05:15:56Z', to, runAnchored: true } });

  it('keys a run-anchored digest on the end of its window', () => {
    expect(pulseWindowKey(anchored('2026-08-10T05:15:57.682Z'))).toBe('2026-08-10T05:15:57.682Z');
  });

  it('gives two digests of the same run the same key, whatever date they are filed under', () => {
    // The production pair: a recovery pulse dated to the missed day and the
    // brand's own pulse dated to today, both computed from the run that
    // completed at 05:15:57.
    const recovery = anchored('2026-08-10T05:15:57.682Z');
    const ownRun = anchored('2026-08-10T05:15:57.682Z');

    expect(pulseWindowKey(recovery)).toBe(pulseWindowKey(ownRun));
  });

  it('gives digests of different runs different keys', () => {
    expect(pulseWindowKey(anchored('2026-08-10T05:15:57.682Z'))).not.toBe(
      pulseWindowKey(anchored('2026-08-11T04:02:11.104Z')),
    );
  });

  it('returns null for a clock-anchored window, which could never match', () => {
    // Weekly digests and brands with no completed run end their window at
    // `now`, so comparing them would suppress nothing and only risk
    // suppressing something it should not.
    expect(
      pulseWindowKey({ window: { from: '2026-08-06T00:00:00Z', to: '2026-08-13T00:00:00Z' } }),
    ).toBeNull();
  });

  it('returns null when the digest predates the window field', () => {
    expect(pulseWindowKey({ windowDays: 1, kpis: { totalResults: 12 } })).toBeNull();
    expect(pulseWindowKey(undefined)).toBeNull();
  });

  it('returns null when a run-anchored window has no end, rather than a false match', () => {
    expect(pulseWindowKey({ window: { runAnchored: true } })).toBeNull();
  });
});
