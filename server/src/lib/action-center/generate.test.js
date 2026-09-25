import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
const from = vi.fn();
vi.mock('../../config/supabase.js', () => ({ default: { from: (...a) => from(...a) } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateActionsForBrand } from './generate.js';
import { ENGINE_THRESHOLDS } from '../../config/action-engine.js';

const { maxNewActionsPerDay } = ENGINE_THRESHOLDS.noise;

const BRAND = 'brand-1';
/** A brand with everything connected, so eligibility is not what a test is
 *  measuring unless it says so. */
const ALL_SOURCES = new Set(['tracking', 'competitors', 'site_audits', 'analytics']);
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

    expect(summary).toEqual({
      created: 0,
      refreshed: 0,
      resting: 0,
      ineligible: 0,
      capped: 0,
    });
    expect(writes.inserted).toHaveLength(0);
  });
});

/**
 * Phase 4 (#818): the engine stopped knowing any definition by name. What is
 * tested here is the part it still owns — whether a brand may have this
 * definition at all, and how many it may have in one day.
 */
describe('eligibility', () => {
  it('does not raise a definition the brand has no data for', async () => {
    const writes = mockDb({ signals: [signal({ kind: 'page_opportunity', impact: 'medium' })] });

    // Page opportunities are landing pages read from an analytics connection.
    const summary = await generateActionsForBrand(BRAND, {
      now: NOW,
      sources: new Set(['tracking']),
    });

    expect(summary.created).toBe(0);
    expect(summary.ineligible).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'actions')).toBeUndefined();
  });

  it('raises it once the source is connected', async () => {
    const writes = mockDb({ signals: [signal({ kind: 'page_opportunity', impact: 'medium' })] });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(1);
    expect(summary.ineligible).toBe(0);
    expect(writes.inserted.find((w) => w.table === 'actions').rows[0]).toMatchObject({
      kind: 'capture_ai_traffic',
      category: 'growth',
    });
  });

  /**
   * Losing a source mid-cycle must not orphan work already handed out: the
   * action stays, and evidence keeps attaching to it.
   */
  it('keeps maintaining an active action whose source went away', async () => {
    const writes = mockDb({
      signals: [signal({ id: 's9', kind: 'page_opportunity', impact: 'medium' })],
      activeActions: [{ id: 'a9', dedup_key: 'capture_ai_traffic', status: 'in_progress' }],
    });

    const summary = await generateActionsForBrand(BRAND, {
      now: NOW,
      sources: new Set(['tracking']),
    });

    expect(summary.refreshed).toBe(1);
    expect(summary.ineligible).toBe(0);
    expect(writes.updated.some((w) => w.table === 'signals')).toBe(true);
  });
});

describe('the daily cap', () => {
  /** One open signal for every definition that exists. */
  const oneOfEachKind = () =>
    [
      'sharp_drop',
      'visibility_slipping',
      'platform_gap',
      'uncited_mentions',
      'page_opportunity',
      'audit_low_score',
      'competitor_citation_gap',
      'competitor_surge',
    ].map((kind, index) => signal({ id: `s${index}`, kind, impact: 'medium' }));

  it('stops at the configured number of new actions a day', async () => {
    const writes = mockDb({ signals: oneOfEachKind() });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(maxNewActionsPerDay);
    expect(summary.capped).toBe(8 - maxNewActionsPerDay);
    expect(writes.inserted.filter((w) => w.table === 'actions')).toHaveLength(maxNewActionsPerDay);
  });

  /**
   * The budget is the day's, not the run's. An action raised this morning
   * and dismissed by lunch still spent its slot — the brand was told.
   */
  it('counts what the brand was already given today', async () => {
    const spent = Array.from({ length: maxNewActionsPerDay - 1 }, (_, i) => ({
      id: `spent-${i}`,
      dedup_key: `unrelated-${i}`,
      status: 'new',
      created_at: NOW.toISOString(),
    }));
    const writes = mockDb({ signals: oneOfEachKind(), activeActions: spent });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(1);
    expect(writes.inserted.filter((w) => w.table === 'actions')).toHaveLength(1);
  });

  it('ignores actions raised on earlier days', async () => {
    const yesterday = Array.from({ length: maxNewActionsPerDay }, (_, i) => ({
      id: `old-${i}`,
      dedup_key: `unrelated-${i}`,
      status: 'new',
      created_at: daysAgo(1),
    }));
    mockDb({ signals: oneOfEachKind(), activeActions: yesterday });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(maxNewActionsPerDay);
  });

  /** When there is room for one, it goes to the one that matters most. */
  it('spends the last slot on the highest impact candidate', async () => {
    const spent = Array.from({ length: maxNewActionsPerDay - 1 }, (_, i) => ({
      id: `spent-${i}`,
      dedup_key: `unrelated-${i}`,
      status: 'new',
      created_at: NOW.toISOString(),
    }));
    const writes = mockDb({
      signals: [
        signal({ id: 'low', kind: 'platform_gap', impact: 'low' }),
        signal({ id: 'high', kind: 'sharp_drop', impact: 'high' }),
      ],
      activeActions: spent,
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(1);
    expect(summary.capped).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'actions').rows[0].kind).toBe(
      'recover_visibility',
    );
  });
});

describe('the definition version', () => {
  it('is stamped on the action that the definition raised', async () => {
    const writes = mockDb({ signals: [signal()] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    const row = writes.inserted.find((w) => w.table === 'actions').rows[0];
    expect(row.definition_version).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(row.definition_version)).toBe(true);
  });
});

/**
 * Phase 5's exit condition (#818), through the writer rather than the
 * planner: two brands with the same problem, one with an integration
 * connected and one without, are given different work.
 */
describe('the task plan the action is created with', () => {
  const taskRows = (writes) =>
    (writes.inserted.find((w) => w.table === 'action_tasks')?.rows ?? []).map(
      (row) => row.task_key,
    );

  it('asks a brand with analytics what the drop cost in sessions', async () => {
    const writes = mockDb({ signals: [signal()] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(taskRows(writes)).toContain('measure_traffic_impact');
  });

  it('does not ask a brand that has no analytics connected', async () => {
    const writes = mockDb({ signals: [signal()] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: new Set(['tracking']) });

    expect(taskRows(writes)).not.toContain('measure_traffic_impact');
    expect(taskRows(writes).length).toBeGreaterThan(0);
  });

  it('records how each task may be carried out, and what it waits on', async () => {
    const writes = mockDb({ signals: [signal()] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    const rows = writes.inserted.find((w) => w.table === 'action_tasks').rows;
    for (const row of rows) {
      expect(['manual', 'agent']).toContain(row.mode);
      expect(['none', 'approval']).toContain(row.permission);
      expect(Array.isArray(row.depends_on)).toBe(true);
      expect(row.task_version).toBeGreaterThanOrEqual(1);
    }
    // Positions are contiguous whatever the plan dropped.
    expect(rows.map((row) => row.position)).toEqual(rows.map((_, i) => i + 1));
  });

  it('names the target on a task whose payload resolves one', async () => {
    const writes = mockDb({
      signals: [
        signal({
          kind: 'platform_gap',
          impact: 'medium',
          payload: { platform: 'gemini-web', bestPlatform: 'chatgpt-web' },
        }),
      ],
    });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    const compare = writes.inserted
      .find((w) => w.table === 'action_tasks')
      .rows.find((row) => row.task_key === 'compare_platforms');
    expect(compare.title_params).toEqual({
      platform: 'gemini-web',
      bestPlatform: 'chatgpt-web',
    });
  });
});
