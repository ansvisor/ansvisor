import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
const from = vi.fn();
vi.mock('../../config/supabase.js', () => ({ default: { from: (...a) => from(...a) } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateActionsForBrand } from './generate.js';

const BRAND = 'brand-1';
const NOW = new Date('2026-09-16T04:00:00Z');

/**
 * Enough of the PostgREST builder to drive the generator.
 *
 * Each table answers from `tables`, and every write is recorded so a test can
 * assert what the night actually did. The builder is thenable, which is what
 * lets `await supabase.from(x).select(y).eq(...)` resolve without a terminal
 * call.
 */
function mockDb({ signals = [], activeActions = [], closedActions = [] } = {}) {
  const writes = { inserted: [], updated: [] };

  from.mockImplementation((table) => {
    const state = { op: 'select', payload: null, negated: false };

    const builder = {
      select: () => builder,
      eq: () => builder,
      // The generator asks for actions twice: `.not('status', 'in', ...)` for
      // the active ones, `.in('status', [...])` for the closed ones. The mock
      // has to tell them apart or every test sees one list.
      not: () => {
        state.negated = true;
        return builder;
      },
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      single: () => Promise.resolve(result()),
      insert: (payload) => {
        state.op = 'insert';
        state.payload = payload;
        writes.inserted.push({ table, rows: Array.isArray(payload) ? payload : [payload] });
        return builder;
      },
      update: (payload) => {
        state.op = 'update';
        state.payload = payload;
        writes.updated.push({ table, patch: payload });
        return builder;
      },
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
    };

    function result() {
      if (state.op === 'insert') return { data: { id: `new-${table}` }, error: null };
      if (state.op === 'update') return { data: null, error: null };
      if (table === 'signals') return { data: signals, error: null };
      if (table === 'actions') {
        return { data: state.negated ? activeActions : closedActions, error: null };
      }
      return { data: [], error: null };
    }

    return builder;
  });

  return writes;
}

const signal = (over = {}) => ({
  id: 's1',
  kind: 'sharp_drop',
  impact: 'high',
  kpi_keys: ['ai_visibility'],
  payload: {},
  previous_value: 40,
  current_value: 20,
  change_value: -20,
  action_id: null,
  ...over,
});

const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

beforeEach(() => {
  from.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('generateActionsForBrand', () => {
  it('opens an action when the kind has no active one', async () => {
    const writes = mockDb({ signals: [signal()] });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary.created).toBe(1);
    const action = writes.inserted.find((w) => w.table === 'actions');
    expect(action.rows[0]).toMatchObject({
      brand_id: BRAND,
      kind: 'recover_visibility',
      dedup_key: 'recover_visibility',
    });
    // Its own baseline — the "before" half of a future measurement.
    expect(action.rows[0].baseline.signals).toHaveLength(1);
    expect(writes.inserted.find((w) => w.table === 'action_tasks').rows).toHaveLength(5);
  });

  /**
   * The bug this phase exists for. The nightly pass used to rewrite an active
   * action's payload, so a recovery someone had already started silently
   * became a recovery for a different set of prompts.
   */
  it('never rewrites an active action’s scope', async () => {
    const writes = mockDb({
      signals: [signal({ id: 's2' })],
      activeActions: [{ id: 'a1', dedup_key: 'recover_visibility', status: 'in_progress' }],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary.created).toBe(0);
    expect(summary.refreshed).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'actions')).toBeUndefined();

    const actionPatches = writes.updated.filter((w) => w.table === 'actions');
    for (const patch of actionPatches) {
      expect(patch.patch).not.toHaveProperty('payload');
      expect(patch.patch).not.toHaveProperty('impact');
      expect(patch.patch).not.toHaveProperty('kpi_keys');
    }
  });

  it('links new signals to the active action as evidence', async () => {
    const writes = mockDb({
      signals: [signal({ id: 's3' })],
      activeActions: [{ id: 'a1', dedup_key: 'recover_visibility', status: 'new' }],
    });

    await generateActionsForBrand(BRAND, { now: NOW });

    expect(writes.updated.some((w) => w.table === 'signals')).toBe(true);
    expect(
      writes.inserted.some(
        (w) => w.table === 'action_events' && w.rows[0].event === 'signals_linked',
      ),
    ).toBe(true);
  });

  /**
   * A closed action is the record of one execution cycle. The old code set a
   * completed row's status back to 'new' and cleared completed_at, which
   * destroyed that record instead of adding to it.
   */
  it('never resurrects a closed action', async () => {
    const writes = mockDb({
      signals: [signal()],
      closedActions: [
        { dedup_key: 'recover_visibility', completed_at: daysAgo(40), updated_at: daysAgo(40) },
      ],
    });

    await generateActionsForBrand(BRAND, { now: NOW });

    const patches = writes.updated.filter((w) => w.table === 'actions');
    for (const patch of patches) {
      expect(patch.patch).not.toHaveProperty('status');
      expect(patch.patch).not.toHaveProperty('completed_at');
    }
    expect(
      writes.inserted.some((w) => w.table === 'action_events' && w.rows[0].event === 'reopened'),
    ).toBe(false);
  });

  it('opens a new cycle once the rest window has passed', async () => {
    const writes = mockDb({
      signals: [signal()],
      // No active action; the last cycle closed well outside the rest window.
      closedActions: [
        { dedup_key: 'recover_visibility', completed_at: daysAgo(40), updated_at: daysAgo(40) },
      ],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary.created).toBe(1);
    expect(summary.resting).toBe(0);
    // A second row beside the old one, not a rewrite of it.
    expect(writes.inserted.find((w) => w.table === 'actions')).toBeDefined();
    expect(writes.updated.filter((w) => w.table === 'actions')).toHaveLength(0);
  });

  it('rests instead of reopening the night after a cycle closed', async () => {
    const writes = mockDb({
      signals: [signal()],
      closedActions: [
        { dedup_key: 'recover_visibility', completed_at: daysAgo(1), updated_at: daysAgo(1) },
      ],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary.created).toBe(0);
    expect(summary.resting).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'actions')).toBeUndefined();
  });

  it('does nothing for a kind with no matching open signals', async () => {
    const writes = mockDb({ signals: [] });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary).toEqual({ created: 0, refreshed: 0, resting: 0 });
    expect(writes.inserted).toHaveLength(0);
  });
});
