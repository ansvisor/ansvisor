import { afterEach, describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import supabaseAdmin from '../../config/supabase.js';
import {
  daily,
  degradedPlatforms,
  isTransientDbError,
  positiveSentimentPct,
  series,
  trailingDayWindows,
  windowParams,
} from './metrics.js';

/**
 * Pulse metric execution shape (#687).
 *
 * The digest is a background job, so its aggregate queries run one at a time
 * rather than all at once: concurrency bought no perceived speed and instead
 * multiplied a single brand's peak database load, which is how the largest
 * brand's statements crossed the 8s timeout and its pulse was dropped.
 */

describe('series', () => {
  it('runs thunks one at a time, never overlapping', async () => {
    let running = 0;
    let maxConcurrent = 0;
    const task = () => async () => {
      maxConcurrent = Math.max(maxConcurrent, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return 'ok';
    };

    await series([task(), task(), task()]);

    expect(maxConcurrent).toBe(1);
  });

  it('returns results in input order, like Promise.all', async () => {
    const results = await series([async () => 'first', async () => 'second', async () => 'third']);

    expect(results).toEqual(['first', 'second', 'third']);
  });

  it('propagates a failure instead of swallowing it', async () => {
    const after = vi.fn();

    await expect(
      series([
        async () => 'ok',
        async () => {
          throw new Error('aggregate failed');
        },
        after,
      ]),
    ).rejects.toThrow('aggregate failed');
    // Sequencing means the remaining work never starts — the caller handles
    // the failure rather than the pulse half-computing itself.
    expect(after).not.toHaveBeenCalled();
  });
});

describe('isTransientDbError', () => {
  it('recognises the statement timeout that dropped a production pulse', () => {
    expect(isTransientDbError('canceling statement due to statement timeout')).toBe(true);
  });

  it('recognises deadlocks', () => {
    expect(isTransientDbError('deadlock detected')).toBe(true);
  });

  it('does not retry genuine errors', () => {
    // Retrying these would waste time and hide a real bug behind a slower
    // failure.
    expect(isTransientDbError('column "foo" does not exist')).toBe(false);
    expect(isTransientDbError('permission denied for table prompt_results')).toBe(false);
  });

  it('handles a missing message without throwing', () => {
    expect(isTransientDbError(undefined)).toBe(false);
    expect(isTransientDbError('')).toBe(false);
  });
});

/**
 * Window shape (#818).
 *
 * The wide windows moved off the raw aggregate RPCs, which rescan everything
 * a brand has ever collected and cross the database's 8s statement timeout
 * once a brand is large enough. They are now expressed in whole UTC days and
 * answered from the daily rollups. What is worth pinning is the arithmetic:
 * which days a comparison covers decides what every detector reads.
 */
describe('trailingDayWindows', () => {
  const now = new Date('2026-09-25T02:13:00Z');

  it('covers the trailing seven days, today included', () => {
    expect(trailingDayWindows(now, 7).cur).toEqual({ from: '2026-09-19', to: '2026-09-25' });
  });

  it('puts the previous window immediately before, never overlapping', () => {
    const { cur, prev } = trailingDayWindows(now, 7);
    expect(prev).toEqual({ from: '2026-09-12', to: '2026-09-18' });
    expect(prev.to < cur.from).toBe(true);
  });

  it('gives both windows the same length, so the comparison is like for like', () => {
    const { cur, prev } = trailingDayWindows(now, 7);
    const span = (w) => (Date.parse(w.to) - Date.parse(w.from)) / 86_400_000;
    expect(span(cur)).toBe(span(prev));
  });

  /** The hour the nightly run happens must not change which days it reads. */
  it('does not depend on the time of day', () => {
    const early = trailingDayWindows(new Date('2026-09-25T00:04:00Z'), 7);
    const late = trailingDayWindows(new Date('2026-09-25T23:58:00Z'), 7);
    expect(early).toEqual(late);
  });

  it('crosses a month boundary by date, not by arithmetic on the day number', () => {
    expect(trailingDayWindows(new Date('2026-03-02T05:00:00Z'), 7).cur.from).toBe('2026-02-24');
  });
});

describe('rollup routing', () => {
  it('sends a whole-day window to the rollup variant', () => {
    const days = { from: '2026-09-19', to: '2026-09-25' };
    expect(daily('ai_visibility_aggregates', days)).toBe('ai_visibility_aggregates_daily');
    expect(windowParams('b1', null, null, days)).toEqual({
      p_brand_id: 'b1',
      p_day_from: '2026-09-19',
      p_day_to: '2026-09-25',
    });
  });

  /**
   * The 24-hour window is anchored to the tracking-run ledger rather than to
   * midnight, so no whole-day window can express it — and it is cheap, being
   * one run's worth of rows.
   */
  it('leaves a run-anchored window on the raw RPC', () => {
    const from = new Date('2026-09-24T02:10:00Z');
    const to = new Date('2026-09-25T02:13:00Z');
    expect(daily('ai_visibility_aggregates', null)).toBe('ai_visibility_aggregates');
    expect(windowParams('b1', from, to, null)).toEqual({
      p_brand_id: 'b1',
      p_date_from: from.toISOString(),
      p_date_to: to.toISOString(),
    });
  });
});

/**
 * The e-mail's positive sentiment uses the base Insights and Action Center
 * use (00191, gkhngyk on #1226): answers that name the brand. Cited-only
 * answers are always neutral, so counting them pulled the share down.
 */
describe('positiveSentimentPct', () => {
  it('divides by the answers that name the brand', () => {
    expect(
      positiveSentimentPct({ positive_count: 3, mentioning_results: 6, mention_results: 4 }),
    ).toBe(75);
  });

  it('falls back to answers that name or cite it before 00191', () => {
    expect(positiveSentimentPct({ positive_count: 3, mentioning_results: 6 })).toBe(50);
  });

  it('reads 0 without named answers or a row', () => {
    expect(
      positiveSentimentPct({ positive_count: 0, mentioning_results: 2, mention_results: 0 }),
    ).toBe(0);
    expect(positiveSentimentPct(null)).toBe(0);
  });
});

describe('degradedPlatforms', () => {
  afterEach(() => {
    delete supabaseAdmin.from;
  });

  /**
   * prompt_results counts per platform: `today` over the last day, `week`
   * over the seven days before it. Records which platforms were read.
   */
  function stubCounts(counts) {
    const read = new Set();
    supabaseAdmin.from = () => {
      const q = { platform: null, baseline: false };
      const builder = {
        select: () => builder,
        eq: (_column, value) => {
          q.platform = value;
          read.add(value);
          return builder;
        },
        gte: () => builder,
        lt: () => {
          q.baseline = true;
          return builder;
        },
        then: (resolve) => {
          const c = counts[q.platform] ?? { today: 0, week: 0 };
          return resolve({ count: q.baseline ? c.week : c.today });
        },
      };
      return builder;
    };
    return read;
  }

  it('flags a collapse, but not the paused platforms, whose answers stop by design', async () => {
    // Copilot and Perplexity were paused on 2026-11-06, Grok before them:
    // a busy week, then nothing today.
    const read = stubCounts({
      'chatgpt-web': { today: 10, week: 7000 },
      'gemini-web': { today: 1000, week: 7000 },
      'copilot-web': { today: 0, week: 7000 },
      'perplexity-web': { today: 0, week: 7000 },
      'grok-web': { today: 0, week: 7000 },
    });
    expect(await degradedPlatforms(new Date('2026-11-07T12:00:00Z'))).toEqual(['chatgpt-web']);
    for (const paused of ['copilot-web', 'perplexity-web', 'grok-web']) {
      expect(read.has(paused)).toBe(false);
    }
  });

  it('finds no outage when only the paused platforms went quiet', async () => {
    stubCounts({
      'chatgpt-web': { today: 1000, week: 7000 },
      'copilot-web': { today: 0, week: 7000 },
      'perplexity-web': { today: 0, week: 7000 },
    });
    expect(await degradedPlatforms(new Date('2026-11-07T12:00:00Z'))).toEqual([]);
  });
});
