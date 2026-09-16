import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('../../config/supabase.js', () => ({
  default: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) },
}));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  MEANINGFUL_CHANGE_RATIO,
  VALIDATION_WAIT_DAYS,
  deriveOutcome,
  measureKpis,
  validateAction,
} from './validate.js';

const NOW = new Date('2026-09-20T04:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** Records every write so a test can assert what was stored. */
function mockWrites() {
  const writes = { updated: [], inserted: [] };
  from.mockImplementation((table) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      not: () => builder,
      limit: () => builder,
      update: (patch) => {
        writes.updated.push({ table, patch });
        return builder;
      },
      insert: (rows) => {
        writes.inserted.push({ table, rows });
        return builder;
      },
      then: (resolve, reject) =>
        Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject),
    };
    return builder;
  });
  return writes;
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deriveOutcome', () => {
  const pair = (metric, before, after) => ({ metric, unit: 'count', before, after });

  it('reports nothing measurable when no metric has both halves', () => {
    expect(deriveOutcome([pair('citations', null, 40)])).toBe('not_measurable');
    expect(deriveOutcome([])).toBe('not_measurable');
  });

  it('calls a rise past the threshold an improvement', () => {
    expect(deriveOutcome([pair('citations', 100, 120)])).toBe('improved');
  });

  it('calls a fall past the threshold a decline', () => {
    expect(deriveOutcome([pair('citations', 100, 80)])).toBe('declined');
  });

  /**
   * The guard that keeps every outcome from being a verdict. These metrics
   * drift on their own; a move inside the noise band is not a result.
   */
  it('ignores movement inside the noise band', () => {
    const wobble = Math.round(100 * MEANINGFUL_CHANGE_RATIO) - 1;
    expect(deriveOutcome([pair('citations', 100, 100 + wobble)])).toBe('no_meaningful_change');
    expect(deriveOutcome([pair('citations', 100, 100 - wobble)])).toBe('no_meaningful_change');
  });

  it('reports an improvement when one metric rose and another fell', () => {
    expect(deriveOutcome([pair('citations', 100, 150), pair('mentions', 100, 50)])).toBe(
      'improved',
    );
  });

  // Nothing to scale a ratio by, so any real arrival counts.
  it('treats a first arrival from zero as movement', () => {
    expect(deriveOutcome([pair('citations', 0, 3)])).toBe('improved');
  });
});

describe('measureKpis', () => {
  it('asks only for the sources the requested metrics need', async () => {
    rpc.mockResolvedValue({ data: { total_citations: 42, total_mentions: 7 }, error: null });

    const values = await measureKpis('brand-1', ['citations'], '2026-09-01', '2026-09-07');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('insights_aggregates_daily', {
      p_brand_id: 'brand-1',
      p_platform: null,
      p_models: null,
      p_region: null,
      p_day_from: '2026-09-01',
      p_day_to: '2026-09-07',
    });
    expect(values).toEqual({ citations: 42 });
  });

  it('ignores metrics it has no source for', async () => {
    const values = await measureKpis('brand-1', ['something_else'], '2026-09-01', '2026-09-07');
    expect(values).toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });

  it('computes share of voice the way the dashboard does', async () => {
    rpc.mockResolvedValue({
      data: { total_brand_mentions: 250, total_competitor_mentions: 750 },
      error: null,
    });

    const values = await measureKpis('brand-1', ['share_of_voice'], '2026-09-01', '2026-09-07');

    expect(values.share_of_voice).toBe(25);
  });

  it('reports a window with no answers as unmeasured, not zero', async () => {
    rpc.mockResolvedValue({ data: { answers: 0 }, error: null });

    const values = await measureKpis('brand-1', ['ai_visibility'], '2026-09-01', '2026-09-07');

    expect(values.ai_visibility).toBeNull();
  });
});

describe('validateAction', () => {
  const action = (over = {}) => ({
    id: 'a1',
    brand_id: 'brand-1',
    kpi_keys: ['citations'],
    created_at: daysAgo(30),
    completed_at: daysAgo(10),
    ...over,
  });

  /**
   * The window has to be over. Measured early, its unhappened days read as
   * zero and file recent work as a decline.
   */
  it('refuses to measure while the after window is still running', async () => {
    const writes = mockWrites();

    const outcome = await validateAction(action({ completed_at: daysAgo(3) }), { now: NOW });

    expect(outcome).toBeNull();
    expect(writes.updated).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('measures once the window has closed', async () => {
    mockWrites();
    rpc.mockResolvedValue({ data: { total_citations: 10 }, error: null });

    const outcome = await validateAction(action({ completed_at: daysAgo(VALIDATION_WAIT_DAYS) }), {
      now: NOW,
    });

    expect(outcome).not.toBeNull();
  });

  it('measures before and after over equal windows and stores both', async () => {
    const writes = mockWrites();
    rpc
      .mockResolvedValueOnce({ data: { total_citations: 100 }, error: null })
      .mockResolvedValueOnce({ data: { total_citations: 140 }, error: null });

    const outcome = await validateAction(action(), { now: NOW });

    expect(outcome).toBe('improved');
    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.outcome).toBe('improved');
    expect(patch.validated_at).toBe(NOW.toISOString());
    expect(patch.validation.metrics).toEqual([
      { metric: 'citations', unit: 'count', before: 100, after: 140 },
    ]);
    // Equal-length windows, one before the action was raised and one after it
    // closed — a comparison between like periods.
    expect(patch.validation.beforeWindow.to < patch.validation.afterWindow.from).toBe(true);
  });

  it('records the verdict on the action trail', async () => {
    const writes = mockWrites();
    rpc.mockResolvedValue({ data: { total_citations: 10 }, error: null });

    await validateAction(action(), { now: NOW });

    const event = writes.inserted.find((w) => w.table === 'action_events');
    expect(event.rows.event).toBe('outcome_measured');
  });

  /**
   * An action whose rule never named a success metric cannot be judged. Saying
   * so is honest; inventing a metric it never claimed would not be.
   */
  it('reports an action with no success metrics as not measurable', async () => {
    const writes = mockWrites();

    const outcome = await validateAction(action({ kpi_keys: [] }), { now: NOW });

    expect(outcome).toBe('not_measurable');
    expect(rpc).not.toHaveBeenCalled();
    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.validation).toBeNull();
  });

  it('does nothing for an action that never closed', async () => {
    const writes = mockWrites();

    const outcome = await validateAction(action({ completed_at: null }), { now: NOW });

    expect(outcome).toBeNull();
    expect(writes.updated).toHaveLength(0);
  });
});
