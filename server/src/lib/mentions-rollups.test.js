import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
const rpc = vi.fn();
const from = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) },
}));

import {
  refreshMentionHistory,
  refreshMentionTermsDaily,
  refreshMentionTermsHistory,
  refreshMentionsDaily,
} from './mentions-rollups.js';

/** A day-bound query on `expected`: first call ascending (first day), then descending. */
function bounds(expected, first, last) {
  const days = [first, last];
  from.mockImplementation((table) => {
    if (table !== expected) throw new Error(`unexpected table ${table}`);
    const day = days.shift();
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () =>
        Promise.resolve({ data: day ? [{ created_at: `${day}T04:00:00Z` }] : [], error: null }),
    };
    return q;
  });
}
const resultBounds = (first, last) => bounds('prompt_results', first, last);

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe('refreshMentionsDaily', () => {
  it('refreshes the rollups for the range, then the terms a day at a time', async () => {
    rpc.mockResolvedValue({ error: null });
    await expect(refreshMentionsDaily('brand-1', '2026-10-15', '2026-10-17')).resolves.toBe(true);
    const args = (from, to) => ({ p_brand_id: 'brand-1', p_day_from: from, p_day_to: to });
    expect(rpc.mock.calls).toEqual([
      ['refresh_mentions_daily', args('2026-10-15', '2026-10-17')],
      ['refresh_mention_terms', args('2026-10-15', '2026-10-15')],
      ['refresh_mention_terms', args('2026-10-16', '2026-10-16')],
      ['refresh_mention_terms', args('2026-10-17', '2026-10-17')],
    ]);
  });

  // Derived state: a failed refresh costs freshness until the next sweep and
  // must never throw into a tracking run's finalize path.
  it('reports failure without throwing', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } });
    await expect(refreshMentionsDaily('brand-1', '2026-10-17', '2026-10-17')).resolves.toBe(false);
  });

  it('reports a failed terms refresh too', async () => {
    rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'x' } });
    await expect(refreshMentionsDaily('brand-1', '2026-10-17', '2026-10-17')).resolves.toBe(false);
  });
});

describe('refreshMentionTermsDaily (00231)', () => {
  it('rebuilds the Perception rollups a week at a time', async () => {
    rpc.mockResolvedValue({ error: null });
    await expect(refreshMentionTermsDaily('brand-1', '2026-10-01', '2026-10-16')).resolves.toBe(
      true,
    );
    const args = (from, to) => ({ p_brand_id: 'brand-1', p_day_from: from, p_day_to: to });
    expect(rpc.mock.calls).toEqual([
      ['refresh_mention_terms_daily', args('2026-10-01', '2026-10-07')],
      ['refresh_mention_terms_daily', args('2026-10-08', '2026-10-14')],
      ['refresh_mention_terms_daily', args('2026-10-15', '2026-10-16')],
    ]);
  });

  it('stops at a failed week and says so, without throwing', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'timeout' } });
    await expect(refreshMentionTermsDaily('brand-1', '2026-10-01', '2026-10-16')).resolves.toBe(
      false,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('refreshMentionHistory', () => {
  it('recomputes the whole history a day at a time', async () => {
    resultBounds('2026-10-01', '2026-10-03');
    rpc.mockResolvedValue({ error: null });

    await expect(refreshMentionHistory('brand-1')).resolves.toBe(3);
    expect(rpc.mock.calls.map(([fn, args]) => [fn, args.p_day_from, args.p_day_to])).toEqual([
      ['refresh_mentions_daily', '2026-10-01', '2026-10-01'],
      ['refresh_mention_terms', '2026-10-01', '2026-10-01'],
      ['refresh_mentions_daily', '2026-10-02', '2026-10-02'],
      ['refresh_mention_terms', '2026-10-02', '2026-10-02'],
      ['refresh_mentions_daily', '2026-10-03', '2026-10-03'],
      ['refresh_mention_terms', '2026-10-03', '2026-10-03'],
    ]);
  });

  it('skips a brand with no results', async () => {
    resultBounds(null, null);
    await expect(refreshMentionHistory('brand-1')).resolves.toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stops at a failed chunk so the backfill can be run again', async () => {
    resultBounds('2026-09-01', '2026-10-17');
    rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'x' } });
    await expect(refreshMentionHistory('brand-1')).rejects.toThrow(
      'mention rollup refresh failed for brand-1 2026-09-02..2026-09-02',
    );
  });
});

describe('refreshMentionTermsHistory (00231 backfill)', () => {
  it("rebuilds the rollups over the brand's terms history, a week at a time", async () => {
    bounds('mentions_answer_terms', '2026-10-01', '2026-10-16');
    rpc.mockResolvedValue({ error: null });

    await expect(refreshMentionTermsHistory('brand-1')).resolves.toBe(3);
    expect(rpc.mock.calls.map(([fn, args]) => [fn, args.p_day_from, args.p_day_to])).toEqual([
      ['refresh_mention_terms_daily', '2026-10-01', '2026-10-07'],
      ['refresh_mention_terms_daily', '2026-10-08', '2026-10-14'],
      ['refresh_mention_terms_daily', '2026-10-15', '2026-10-16'],
    ]);
  });

  it('skips a brand with no terms', async () => {
    bounds('mentions_answer_terms', null, null);
    await expect(refreshMentionTermsHistory('brand-1')).resolves.toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stops at a failed week so the backfill can be run again', async () => {
    bounds('mentions_answer_terms', '2026-10-01', '2026-10-16');
    rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'x' } });
    await expect(refreshMentionTermsHistory('brand-1')).rejects.toThrow(
      'mention terms rollup refresh failed for brand-1 2026-10-08..2026-10-14',
    );
  });
});
