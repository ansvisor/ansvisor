import { describe, expect, it } from 'vitest';
import {
  BAND_PTS,
  CHECKPOINTS,
  MAX_CONTROL_CELLS,
  MIN_CONTROL_CELLS,
  addDays,
  aggregateCells,
  checkAt,
  checkpointEntry,
  checkpointWindow,
  confidenceOf,
  directionOf,
  dueCheckpoints,
  engineOnPlan,
  lastingOf,
  matchControls,
  measureCells,
  nextCheckAt,
  permutationP,
  primaryMetric,
  runOutcome,
  seededRandom,
  verdictOf,
} from './method.js';

/**
 * The impact ledger's method (CHAT-22 §2 items 6–11): the windows, the
 * cells, the controls, the effect and its uncertainty, and the one outcome
 * vocabulary, without a database.
 */

const SHIPPED = '2026-10-01T15:20:00Z';
const STARTER = { allowedScrapers: ['chatgpt-web', 'copilot-web'], allowedModels: [] };
const ALL = {};

/** Rollup rows of one cell: `visible` of its `days` days from `from` named, the rest not. */
function cellRows(prompt, from, days, visible, { platform = 'chatgpt-web', region = 'US' } = {}) {
  return Array.from({ length: days }, (_, i) => ({
    day: addDays(from, i),
    prompt_id: prompt,
    platform,
    model_used: platform === 'claude' ? 'claude-sonnet-5' : 'gpt-5',
    region,
    has_mention: i < visible,
    has_citation: false,
  }));
}

/** Pre and post cells for prompts, each given [visible before, visible after] of 14 days. */
function windows(levels) {
  const pre = [];
  const post = [];
  for (const [prompt, [before, after], options] of levels) {
    pre.push(...cellRows(prompt, '2026-09-17', 14, before, options));
    post.push(...cellRows(prompt, '2026-10-02', 14, after, options));
  }
  return { pre: aggregateCells(pre, ALL), post: aggregateCells(post, ALL) };
}

const promptsOf = (ids, topic = 't1') =>
  new Map(ids.map((id) => [id, { topic_id: topic, is_active: true }]));

describe('windows and checkpoints', () => {
  it('reads the 14 days before ship against the latest 14 days ending on the checkpoint', () => {
    expect(checkpointWindow(SHIPPED, 7)).toEqual({
      pre_start: '2026-09-17',
      pre_end: '2026-09-30',
      post_start: '2026-10-02',
      post_end: '2026-10-08',
    });
    expect(checkpointWindow(SHIPPED, 14)).toMatchObject({
      post_start: '2026-10-02',
      post_end: '2026-10-15',
    });
    // Day 30: days 17–30; day 90: days 77–90.
    expect(checkpointWindow(SHIPPED, 30)).toMatchObject({
      post_start: '2026-10-18',
      post_end: '2026-10-31',
    });
    expect(checkpointWindow(SHIPPED, 90)).toMatchObject({
      post_start: '2026-12-17',
      post_end: '2026-12-30',
    });
  });

  it('is due the morning after a checkpoint’s last day, one checkpoint after another', () => {
    expect(checkAt(SHIPPED, 7)).toBe('2026-10-09T00:00:00.000Z');
    expect(dueCheckpoints([], SHIPPED, new Date('2026-10-08T23:59:00Z'))).toEqual([]);
    expect(dueCheckpoints([], SHIPPED, new Date('2026-10-09T07:53:00Z'))).toEqual([CHECKPOINTS[0]]);
    // Day 14 isn't read before its own day is over.
    expect(
      dueCheckpoints([{ checkpoint: 'd7' }], SHIPPED, new Date('2026-10-15T12:00:00Z')),
    ).toEqual([]);
    expect(
      dueCheckpoints([{ checkpoint: 'd7' }], SHIPPED, new Date('2026-10-16T07:53:00Z')),
    ).toEqual([CHECKPOINTS[1]]);
  });

  it('reads every checkpoint passed when a change is measured late, and none twice', () => {
    expect(
      dueCheckpoints([], SHIPPED, new Date('2026-10-20T07:53:00Z')).map((cp) => cp.key),
    ).toEqual(['d7', 'd14']);
    expect(
      dueCheckpoints(
        [{ checkpoint: 'd7' }, { checkpoint: 'd14' }],
        SHIPPED,
        new Date('2027-02-01T00:00:00Z'),
      ).map((cp) => cp.key),
    ).toEqual(['d30', 'd90']);
  });

  it('comes back at the next checkpoint, and not after day 90', () => {
    expect(nextCheckAt(SHIPPED, 'd7')).toBe(checkAt(SHIPPED, 14));
    expect(nextCheckAt(SHIPPED, 'd14')).toBe(checkAt(SHIPPED, 30));
    expect(nextCheckAt(SHIPPED, 'd30')).toBe(checkAt(SHIPPED, 90));
    expect(nextCheckAt(SHIPPED, 'd90')).toBeNull();
  });
});

describe('cells', () => {
  it('counts a cell’s tracked days, the days the brand was named or cited, and cited', () => {
    const rows = [
      ...cellRows('p1', '2026-09-17', 5, 2),
      // A second row the same day (the model changed mid-day): still one run.
      { ...cellRows('p1', '2026-09-17', 1, 0)[0], model_used: 'gpt-5.1', has_citation: true },
    ];
    const { cells } = aggregateCells(rows, ALL);
    expect([...cells.values()]).toEqual([
      { promptId: 'p1', platform: 'chatgpt-web', region: 'US', runs: 5, visible: 2, cited: 1 },
    ]);
  });

  it('keeps only the plan’s engines, and says which prompts had answers only off it', () => {
    const rows = [
      ...cellRows('p1', '2026-09-17', 3, 1, { platform: 'perplexity-web' }),
      ...cellRows('p2', '2026-09-17', 3, 1, { platform: 'claude' }),
      ...cellRows('p2', '2026-09-17', 3, 1),
    ];
    const starter = aggregateCells(rows, STARTER);
    expect([...starter.cells.keys()]).toEqual(['p2|chatgpt-web|US']);
    expect([...starter.offPlan]).toEqual(['p1']);
    expect(aggregateCells(rows, ALL).cells.size).toBe(3);
  });

  it('reads API models only when the plan lists them', () => {
    const row = { platform: 'claude', model_used: 'claude-sonnet-5' };
    expect(engineOnPlan({ allowedModels: [] }, row)).toBe(false);
    expect(engineOnPlan({ allowedModels: ['claude-sonnet-5'] }, row)).toBe(true);
    expect(engineOnPlan({}, row)).toBe(true);
    expect(engineOnPlan(STARTER, { platform: 'copilot-web' })).toBe(true);
    expect(engineOnPlan(STARTER, { platform: 'google-aio' })).toBe(false);
  });
});

describe('control set', () => {
  const cell = (promptId, visible, { platform = 'chatgpt-web', region = 'US' } = {}) => ({
    promptId,
    platform,
    region,
    runs: 14,
    visible,
    cited: 0,
  });
  const candidate = (id, visible, options) => ({
    key: `${id}|${options?.platform ?? 'chatgpt-web'}|US`,
    pre: cell(id, visible, options),
    post: cell(id, visible, options),
  });
  const targets = [{ key: 't|chatgpt-web|US', pre: cell('t', 7) }];

  it('takes prompts of the targets’ topic first, on their engine, within the band', () => {
    const topics = new Map();
    const candidates = [];
    for (let i = 0; i < 12; i++) {
      candidates.push(candidate(`same${i}`, 7));
      topics.set(`same${i}`, 't1');
    }
    // 0% against the target's 50%: outside the band.
    candidates.push(candidate('far', 0));
    topics.set('far', 't1');
    candidates.push(candidate('other-topic', 7));
    topics.set('other-topic', 't2');
    candidates.push(candidate('other-engine', 7, { platform: 'perplexity-web' }));
    topics.set('other-engine', 't1');

    const { cells, rules } = matchControls({
      targets,
      candidates,
      targetTopics: new Set(['t1']),
      topicOf: (id) => topics.get(id),
    });
    expect(cells.map((c) => c.pre.promptId).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `same${i}`).sort(),
    );
    expect(rules).toEqual({
      topic: 'same',
      band_pts: BAND_PTS,
      engines: ['chatgpt-web'],
      min_runs: 3,
    });
  });

  it('adds other topics when the same topic has too few, the same topic first', () => {
    const topics = new Map([['same', 't1']]);
    const candidates = [candidate('same', 8)];
    for (let i = 0; i < 12; i++) candidates.push(candidate(`any${i}`, 6));
    const { cells, rules } = matchControls({
      targets,
      candidates,
      targetTopics: new Set(['t1']),
      topicOf: (id) => topics.get(id) ?? null,
    });
    expect(cells).toHaveLength(13);
    expect(cells[0].pre.promptId).toBe('same');
    expect(rules.topic).toBe('same_then_any');
  });

  it('keeps at most MAX_CONTROL_CELLS, the closest first', () => {
    const candidates = Array.from({ length: MAX_CONTROL_CELLS + 5 }, (_, i) =>
      candidate(`c${String(i).padStart(4, '0')}`, i < 5 ? 6 : 7),
    );
    const { cells } = matchControls({
      targets,
      candidates,
      targetTopics: new Set(),
      topicOf: () => null,
    });
    expect(cells).toHaveLength(MAX_CONTROL_CELLS);
    expect(cells.every((c) => c.pre.visible === 7)).toBe(true);
  });
});

describe('effect, p-value and outcome', () => {
  const targetIds = Array.from({ length: 10 }, (_, i) => `t${i}`);
  const controlIds = Array.from({ length: 20 }, (_, i) => `c${i}`);
  const measure = (levels, ids = targetIds) =>
    measureCells({
      seed: 'm1:d14',
      primary: 'visibility',
      targetIds: ids,
      ...windows(levels),
      excluded: new Set(ids),
      prompts: promptsOf([...targetIds, ...controlIds]),
    });

  it('gives No meaningful change when targets and controls rise equally', () => {
    const result = measure([
      ...targetIds.map((id) => [id, [4, 10]]),
      ...controlIds.map((id) => [id, [4, 10]]),
    ]);
    expect(result.reason).toBeNull();
    const [visibility] = result.metrics;
    expect(visibility).toMatchObject({ metric: 'visibility', delta: 42.9, effect: 0, p_value: 1 });
    expect(visibility).toMatchObject({ control_before: 28.6, control_after: 71.4 });
    expect(verdictOf(visibility)).toBe('no_meaningful_change');
    expect(confidenceOf({ p: visibility.p_value, targetCells: result.targetCells })).toBe('low');
  });

  it('gives Improved, High, when only the targets rise, with an interval around the effect', () => {
    const result = measure([
      ...targetIds.map((id, i) => [id, [4, 11 + (i % 2)]]),
      ...controlIds.map((id, i) => [id, [4, 4 + (i % 3)]]),
    ]);
    const [visibility, citations] = result.metrics;
    expect(visibility.effect).toBeGreaterThan(40);
    expect(visibility.p_value).toBeLessThan(0.05);
    expect(visibility.interval_low).toBeLessThanOrEqual(visibility.effect);
    expect(visibility.interval_high).toBeGreaterThanOrEqual(visibility.effect);
    expect(verdictOf(visibility)).toBe('improved');
    expect(confidenceOf({ p: visibility.p_value, targetCells: result.targetCells })).toBe('high');
    // The second metric is read beside it, never judged on.
    expect(citations).toMatchObject({ metric: 'citations', effect: 0 });
  });

  it('gives Declined when the targets fall beyond the controls', () => {
    const result = measure([
      ...targetIds.map((id, i) => [id, [10, 2 + (i % 2)]]),
      ...controlIds.map((id, i) => [id, [10, 9 + (i % 3)]]),
    ]);
    expect(verdictOf(result.metrics[0])).toBe('declined');
  });

  it('is the same result every time for the same rows (seeded)', () => {
    const levels = [
      ...targetIds.map((id, i) => [id, [4, 6 + (i % 3)]]),
      ...controlIds.map((id, i) => [id, [4, 4 + (i % 4)]]),
    ];
    expect(measure(levels).metrics).toEqual(measure(levels).metrics);
  });

  it('reads the p-value of identical changes as 1 and of a clean split as near 0', () => {
    expect(permutationP([1, 1, 1], [1, 1, 1, 1], seededRandom('x'))).toBe(1);
    expect(permutationP([9, 9, 9, 9, 9], [0, 0, 0, 0, 0, 0, 0], seededRandom('x'))).toBeLessThan(
      0.01,
    );
  });

  it('needs the minimum meaningful change and p < 0.2 for a verdict, and cells for confidence', () => {
    expect(verdictOf({ effect: 2.9, p_value: 0.01 })).toBe('no_meaningful_change');
    expect(verdictOf({ effect: 3, p_value: 0.19 })).toBe('improved');
    expect(verdictOf({ effect: 8, p_value: 0.2 })).toBe('no_meaningful_change');
    expect(verdictOf({ effect: -3, p_value: 0.1 })).toBe('declined');
    expect(confidenceOf({ p: 0.01, targetCells: 9 })).toBe('medium');
    expect(confidenceOf({ p: 0.01, targetCells: 10, stormy: true })).toBe('medium');
    expect(confidenceOf({ p: 0.1, targetCells: 4 })).toBe('low');
    expect(directionOf(3)).toBe('up');
    expect(directionOf(-2.9)).toBe('flat');
    expect(directionOf(-3)).toBe('down');
  });

  it('judges outreach on citations, every other change on visibility', () => {
    expect(primaryMetric({ kind: 'third_party_observed', change_type: null })).toBe('citations');
    expect(primaryMetric({ kind: 'manual', change_type: 'outreach' })).toBe('citations');
    expect(primaryMetric({ kind: 'cms_publish', change_type: 'content' })).toBe('visibility');
  });
});

describe('not measurable', () => {
  const targetIds = ['t1', 't2'];

  it('says too_few_controls with fewer than 10 control cells, keeping those it matched', () => {
    const controls = Array.from({ length: MIN_CONTROL_CELLS - 1 }, (_, i) => `c${i}`);
    const result = measureCells({
      seed: 's',
      primary: 'visibility',
      targetIds,
      ...windows([...targetIds, ...controls].map((id) => [id, [4, 8]])),
      excluded: new Set(targetIds),
      prompts: promptsOf([...targetIds, ...controls]),
    });
    expect(result).toMatchObject({ reason: 'too_few_controls', targetCells: 2 });
    expect(result.control.cells).toHaveLength(MIN_CONTROL_CELLS - 1);
  });

  it('says too_few_runs with fewer than 3 tracked days in a window (tracking started late)', () => {
    const pre = aggregateCells(
      targetIds.flatMap((id) => cellRows(id, '2026-09-28', 2, 1)),
      ALL,
    );
    const post = aggregateCells(
      targetIds.flatMap((id) => cellRows(id, '2026-10-02', 14, 5)),
      ALL,
    );
    expect(
      measureCells({
        seed: 's',
        primary: 'visibility',
        targetIds,
        pre,
        post,
        excluded: new Set(),
        prompts: promptsOf(targetIds),
      }).reason,
    ).toBe('too_few_runs');
  });

  it('says too_few_runs with no data at all, and engine_not_on_plan when the data is off the plan', () => {
    const empty = aggregateCells([], STARTER);
    const base = { seed: 's', primary: 'visibility', targetIds, excluded: new Set() };
    expect(
      measureCells({ ...base, pre: empty, post: empty, prompts: promptsOf(targetIds) }).reason,
    ).toBe('too_few_runs');
    const perplexity = (from) =>
      aggregateCells(
        targetIds.flatMap((id) => cellRows(id, from, 14, 5, { platform: 'perplexity-web' })),
        STARTER,
      );
    expect(
      measureCells({
        ...base,
        pre: perplexity('2026-09-17'),
        post: perplexity('2026-10-02'),
        prompts: promptsOf(targetIds),
      }).reason,
    ).toBe('engine_not_on_plan');
  });

  it('never takes a paused prompt, or one another change targets, as a control', () => {
    const controls = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const prompts = promptsOf([...targetIds, ...controls]);
    prompts.set('c0', { topic_id: 't1', is_active: false });
    const result = measureCells({
      seed: 's',
      primary: 'visibility',
      targetIds,
      ...windows([...targetIds, ...controls].map((id) => [id, [4, 8]])),
      excluded: new Set([...targetIds, 'c1', 'c2']),
      prompts,
    });
    expect(result.reason).toBe('too_few_controls');
    expect(result.control.cells.map((c) => c.pre.promptId)).not.toContain('c0');
    expect(result.control.cells.map((c) => c.pre.promptId)).not.toContain('c1');
  });
});

describe('checkpoint entries', () => {
  const window = checkpointWindow(SHIPPED, 7);
  const measured = (effect, p) => ({
    reason: null,
    targetCells: 12,
    control: { cells: new Array(20) },
    metrics: [{ effect, p_value: p, direction: directionOf(effect) }],
  });
  const at = '2026-10-09T07:53:00.000Z';

  it('keeps day 7 Pending with a direction only, no verdict and no confidence', () => {
    const entry = checkpointEntry({
      cp: CHECKPOINTS[0],
      window,
      result: measured(12, 0.001),
      earlier: [],
      measuredAt: at,
    });
    expect(entry).toMatchObject({
      checkpoint: 'd7',
      outcome: 'pending',
      confidence: null,
      direction: 'up',
      not_measurable_reason: null,
    });
  });

  it('gives a verdict with its confidence from day 14, and Not measurable with the reason', () => {
    expect(
      checkpointEntry({
        cp: CHECKPOINTS[1],
        window,
        result: measured(12, 0.001),
        earlier: [],
        measuredAt: at,
      }),
    ).toMatchObject({ outcome: 'improved', confidence: 'high' });
    expect(
      checkpointEntry({
        cp: CHECKPOINTS[1],
        window,
        result: { reason: 'too_few_controls', targetCells: 3 },
        earlier: [],
        measuredAt: at,
      }),
    ).toMatchObject({
      outcome: 'not_measurable',
      confidence: null,
      not_measurable_reason: 'too_few_controls',
    });
  });

  it('says at day 90 whether the effect held or faded', () => {
    const earlier = [
      { checkpoint: 'd14', outcome: 'improved' },
      { checkpoint: 'd30', outcome: 'improved' },
    ];
    expect(
      checkpointEntry({
        cp: CHECKPOINTS[3],
        window,
        result: measured(9, 0.01),
        earlier,
        measuredAt: at,
      }).lasting,
    ).toBe('held');
    expect(
      checkpointEntry({
        cp: CHECKPOINTS[3],
        window,
        result: measured(1, 0.6),
        earlier,
        measuredAt: at,
      }).lasting,
    ).toBe('faded');
    expect(lastingOf([{ checkpoint: 'd30', outcome: 'no_meaningful_change' }], 'improved')).toBe(
      null,
    );
  });
});

describe('an agent run’s outcome', () => {
  it('follows its one change, and Pending until it has a verdict', () => {
    expect(runOutcome([])).toBeNull();
    expect(runOutcome([{ outcome: 'pending', confidence: null }])).toEqual({
      outcome: 'pending',
      confidence: null,
    });
    expect(runOutcome([{ outcome: 'improved', confidence: 'high' }])).toEqual({
      outcome: 'improved',
      confidence: 'high',
    });
    expect(runOutcome([{ outcome: 'not_measurable', confidence: null }])).toEqual({
      outcome: 'not_measurable',
      confidence: null,
    });
  });

  it('reads several changes together, with the lowest confidence', () => {
    expect(
      runOutcome([
        { outcome: 'improved', confidence: 'high' },
        { outcome: 'no_meaningful_change', confidence: 'medium' },
        { outcome: 'pending', confidence: null },
      ]),
    ).toEqual({ outcome: 'improved', confidence: 'medium' });
    expect(
      runOutcome([
        { outcome: 'improved', confidence: 'high' },
        { outcome: 'declined', confidence: 'high' },
      ]).outcome,
    ).toBe('no_meaningful_change');
  });
});
