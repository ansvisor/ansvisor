/**
 * The impact ledger's method (CHAT-22 §2 items 6–11): what a shipped change
 * did, read at 7, 14, 30 and 90 days against a control set, from scheduled
 * tracking only (Addendum 2 G). Pure: no database, no clock, no model call;
 * the job (job.js) reads the rows and writes what this returns.
 *
 *   * Windows: the baseline is the 14 days before ship; a checkpoint reads
 *     the latest 14 days ending on it, or every day since ship when fewer
 *     have passed (day 7: days 1–7, day 14: 1–14, day 30: 17–30, day 90:
 *     77–90). The ship day itself is in neither.
 *   * Cells: prompt × engine × location, from the Insights rollups
 *     (insights_prompt_daily). A cell's runs are its tracked days; its
 *     visibility is the share of those days the brand was named or cited,
 *     its citations the share it was cited (as Insights counts them). A cell
 *     needs MIN_RUNS days in the baseline and in the checkpoint window.
 *   * Strata: engine × location × baseline band (BAND_PTS-wide slices of
 *     the cell's own baseline). Targets and controls are compared inside a
 *     stratum only, so an engine-wide swing, or a level's own drift, reads
 *     the same for both whatever their mix.
 *   * Controls (item 7): the brand's other active prompts, never a target of
 *     a change shipped in the window, in a target cell's stratum (on
 *     visibility), the same topic first. Fewer than MIN_CONTROL_CELLS: Not
 *     measurable.
 *   * Effect (item 8): a difference in differences, stratified: each cell's
 *     change minus its stratum's mean control change, averaged per prompt;
 *     the effect is the target prompts' mean. A target cell with no control
 *     in its stratum is left out. The controls' before and after are
 *     weighted as the targets are spread over the strata, so the row's
 *     numbers add up: effect = (after − before) − (control after − control
 *     before).
 *   * Uncertainty (item 9): a permutation test over prompts (RESAMPLES
 *     reshuffles of the target and control labels on those residuals) for
 *     the p-value, and a bootstrap over prompts for the 90% interval (none
 *     from fewer than MIN_INTERVAL_PROMPTS target prompts), both seeded, so
 *     the same rows always give the same result.
 *   * Outcome and confidence (item 10) in the one vocabulary: Pending (day 7
 *     shows a direction only), Improved, No meaningful change, Declined, Not
 *     measurable. Judged on the unrounded effect and p; stored rounded. A
 *     verdict and each confidence also need target prompts, not only cells
 *     (one prompt on ten engines is one piece of evidence ten times): from
 *     day 14, fewer than VERDICT_TARGET_PROMPTS is Not measurable
 *     (too_few_prompts), whatever the cells; day 7 still shows a direction.
 */

/** The checkpoints, in order (Addendum 2 F). */
export const CHECKPOINTS = Object.freeze([
  { key: 'd7', day: 7 },
  { key: 'd14', day: 14 },
  { key: 'd30', day: 30 },
  { key: 'd90', day: 90 },
]);

/** Days of baseline before ship, and the longest checkpoint window. */
export const BASELINE_DAYS = 14;
export const WINDOW_DAYS = 14;
/** The minimum meaningful change, in points (config, item 10). */
export const MIN_EFFECT_PTS = 3;
/** p below it gives a verdict (Improved / Declined) and Medium confidence. */
export const P_VERDICT = 0.2;
/** p below it, with HIGH_TARGET_CELLS and HIGH_TARGET_PROMPTS, gives High confidence. */
export const P_HIGH = 0.05;
/** Tracked days a cell needs in the baseline and in the checkpoint window. */
export const MIN_RUNS = 3;
/** Fewest control cells a checkpoint is compared with. */
export const MIN_CONTROL_CELLS = 10;
/** Target cells High, and Medium, confidence need. */
export const HIGH_TARGET_CELLS = 10;
export const MEDIUM_TARGET_CELLS = 5;
/**
 * Target prompts a verdict, Medium and High confidence need (beside the
 * cells). Fewer than VERDICT_TARGET_PROMPTS from day 14: Not measurable
 * (too_few_prompts).
 */
export const VERDICT_TARGET_PROMPTS = 3;
export const MEDIUM_TARGET_PROMPTS = 5;
export const HIGH_TARGET_PROMPTS = 10;
/** Target prompts an interval is read from: none from one. */
export const MIN_INTERVAL_PROMPTS = 2;
/** A stratum's baseline band, in points: 0–9.9, 10–19.9 … 90–100. */
export const BAND_PTS = 10;
/** Another change shipped on this share of the targets makes a checkpoint Not measurable. */
export const OVERLAP_SHARE = 0.5;
/** Most prompts a change is measured on (item 2). */
export const MAX_TARGET_PROMPTS = 50;
/** Most control cells kept (impact_control_sets.entities stays well under its 200 kB). */
export const MAX_CONTROL_CELLS = 1000;
/** Reshuffles of the permutation test, and resamples of the bootstrap. */
export const RESAMPLES = 1000;
/** The platforms API-model answers are stored under (the tracking worker's resolveModelPlatform). */
export const API_PLATFORMS = Object.freeze(['chatgpt', 'claude', 'gemini']);

/** The verdicts: what a checkpoint from day 14 says. */
export const VERDICTS = Object.freeze(['improved', 'no_meaningful_change', 'declined']);

const DAY_MS = 86_400_000;

// ─── Days and windows ───────────────────────────────────────────────────────

/** A timestamp's UTC day, as YYYY-MM-DD. */
export function utcDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD day `n` days later (earlier when negative). */
export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * A checkpoint's windows: the baseline (the BASELINE_DAYS before the ship
 * day) and the latest WINDOW_DAYS ending on the checkpoint, from day 1 at
 * the earliest.
 *
 * @returns {{ pre_start: string, pre_end: string, post_start: string, post_end: string }}
 */
export function checkpointWindow(shippedAt, day) {
  const ship = utcDay(shippedAt);
  return {
    pre_start: addDays(ship, -BASELINE_DAYS),
    pre_end: addDays(ship, -1),
    post_start: addDays(ship, Math.max(1, day - WINDOW_DAYS + 1)),
    post_end: addDays(ship, day),
  };
}

/** When a checkpoint can be read: the UTC midnight after its last day ends. */
export function checkAt(shippedAt, day) {
  return `${addDays(utcDay(shippedAt), day + 1)}T00:00:00.000Z`;
}

/**
 * The checkpoints due now that a measurement hasn't read yet, oldest first:
 * those after the latest it has, whose day has ended. A measurement seeded
 * late reads every one passed (day 7 and day 14, say), each on its own
 * window.
 */
export function dueCheckpoints(checkpointsJson, shippedAt, now) {
  const done = new Set((checkpointsJson ?? []).map((entry) => entry?.checkpoint));
  let last = -1;
  CHECKPOINTS.forEach((cp, index) => {
    if (done.has(cp.key)) last = index;
  });
  return CHECKPOINTS.slice(last + 1).filter(
    (cp) => now.getTime() >= Date.parse(checkAt(shippedAt, cp.day)),
  );
}

/** When the job comes back after a checkpoint: the next one's checkAt, null after day 90. */
export function nextCheckAt(shippedAt, afterKey) {
  const index = CHECKPOINTS.findIndex((cp) => cp.key === afterKey);
  const next = CHECKPOINTS[index + 1];
  return next ? checkAt(shippedAt, next.day) : null;
}

/** Whether a timestamp's day falls inside a window (both ends included). */
export function shippedInWindow(shippedAt, window) {
  const day = utcDay(shippedAt);
  return day >= window.pre_start && day <= window.post_end;
}

// ─── Engines and cells ──────────────────────────────────────────────────────

/**
 * Whether an answer's engine is on the plan (§2 item 15): API models only
 * when the plan lists them (allowedModels), scrapers only those it lists
 * (allowedScrapers); a plan that lists none has them all (Growth's
 * scrapers, self-hosted's everything), as the web's plan-engines reads it.
 */
export function engineOnPlan(limits, row) {
  if (API_PLATFORMS.includes(row.platform)) {
    const models = limits?.allowedModels;
    return !Array.isArray(models) || models.includes(row.model_used);
  }
  const scrapers = limits?.allowedScrapers;
  return !Array.isArray(scrapers) || scrapers.includes(row.platform);
}

/** A cell's key: prompt × engine × location. */
export function cellKey(row) {
  return `${row.prompt_id}|${row.platform ?? ''}|${row.region ?? ''}`;
}

/**
 * One window's rollup rows as cells: on the plan's engines, each with its
 * tracked days (runs), the days the brand was named or cited (visible) and
 * cited (cited). Two rows of a day (a model changed mid-day) are one run.
 * `offPlan` holds the prompts with answers only on engines off the plan.
 *
 * @param {Array<{ day: string, prompt_id: string, platform: string|null, model_used: string|null,
 *   region: string|null, has_mention: boolean, has_citation: boolean }>} rows
 * @returns {{ cells: Map<string, { promptId: string, platform: string|null, region: string|null,
 *   runs: number, visible: number, cited: number }>, offPlan: Set<string> }}
 */
export function aggregateCells(rows, limits) {
  const byCell = new Map();
  const offPlan = new Set();
  for (const row of rows) {
    if (!engineOnPlan(limits, row)) {
      offPlan.add(row.prompt_id);
      continue;
    }
    const key = cellKey(row);
    let cell = byCell.get(key);
    if (!cell) {
      cell = {
        promptId: row.prompt_id,
        platform: row.platform ?? null,
        region: row.region ?? null,
        days: new Map(),
      };
      byCell.set(key, cell);
    }
    const bits = (row.has_mention || row.has_citation ? 1 : 0) | (row.has_citation ? 2 : 0);
    cell.days.set(row.day, (cell.days.get(row.day) ?? 0) | bits);
  }
  const cells = new Map();
  for (const [key, { days, ...cell }] of byCell) {
    let visible = 0;
    let cited = 0;
    for (const bits of days.values()) {
      if (bits & 1) visible++;
      if (bits & 2) cited++;
    }
    cells.set(key, { ...cell, runs: days.size, visible, cited });
  }
  for (const cell of cells.values()) offPlan.delete(cell.promptId);
  return { cells, offPlan };
}

/** A cell's rate in points: visibility (named or cited) or citations. */
export function rate(cell, metric) {
  return ((metric === 'citations' ? cell.cited : cell.visible) / cell.runs) * 100;
}
/** A rate's baseline band: 0 for 0–9.9 points … 9 for 90–100. */
export function bandOf(points) {
  return Math.min(9, Math.floor(points / BAND_PTS + 1e-9));
}

/** A cell's stratum on a metric: engine × location × the band of its baseline. */
export function stratumOf(cell, metric) {
  return `${cell.platform ?? ''}|${cell.region ?? ''}|${bandOf(rate(cell, metric))}`;
}

// ─── Controls ───────────────────────────────────────────────────────────────

/**
 * The control cells (item 7): candidates in a target cell's stratum on
 * visibility (its engine, location and baseline band). The same topic as a
 * target when those reach MIN_CONTROL_CELLS and every stratum the others
 * would; else any topic, the same topic first. At most MAX_CONTROL_CELLS,
 * shared out between the strata so none is crowded out.
 *
 * @param {{ targets: Array<{ key: string, pre: object }>, candidates: Array<{ key: string, pre: object,
 *   post: object }>, targetTopics: Set<string>, topicOf: (promptId: string) => string|null }} input
 */
export function matchControls({ targets, candidates, targetTopics, topicOf }) {
  const strata = new Set(targets.map((t) => stratumOf(t.pre, 'visibility')));
  const near = [];
  for (const candidate of candidates) {
    const stratum = stratumOf(candidate.pre, 'visibility');
    if (!strata.has(stratum)) continue;
    const topic = topicOf(candidate.pre.promptId);
    near.push({ ...candidate, stratum, sameTopic: !!topic && targetTopics.has(topic) });
  }
  const same = near.filter((cell) => cell.sameTopic);
  const covered = (cells) => new Set(cells.map((cell) => cell.stratum)).size;
  const useSame = same.length >= MIN_CONTROL_CELLS && covered(same) === covered(near);
  const pool = (useSame ? same : near).sort(
    (a, b) => Number(b.sameTopic) - Number(a.sameTopic) || (a.key < b.key ? -1 : 1),
  );
  const perStratum = Math.max(1, Math.floor(MAX_CONTROL_CELLS / Math.max(1, covered(pool))));
  const taken = new Map();
  const cells = pool.filter((cell) => {
    const n = taken.get(cell.stratum) ?? 0;
    if (n >= perStratum) return false;
    taken.set(cell.stratum, n + 1);
    return true;
  });
  return {
    cells,
    rules: {
      topic: useSame ? 'same' : same.length ? 'same_then_any' : 'any',
      band_pts: BAND_PTS,
      strata: covered(cells),
      engines: [...new Set(targets.map((t) => t.pre.platform).filter(Boolean))].sort(),
      min_runs: MIN_RUNS,
    },
  };
}

// ─── Statistics ─────────────────────────────────────────────────────────────

/** A 32-bit seed from a string (FNV-1a). */
function hashSeed(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A seeded generator in [0, 1) (mulberry32): the same rows always give the same p and interval. */
export function seededRandom(seed) {
  let state = hashSeed(String(seed));
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Two-sided permutation p-value of mean(targets) − mean(controls): the
 * labels reshuffled `resamples` times over the pooled prompts. Never 0:
 * (hits + 1) / (resamples + 1).
 */
export function permutationP(targets, controls, random, resamples = RESAMPLES) {
  const pool = [...targets, ...controls];
  const n = targets.length;
  const m = controls.length;
  const total = pool.reduce((sum, v) => sum + v, 0);
  const observed = Math.abs(mean(targets) - mean(controls));
  let hits = 0;
  for (let r = 0; r < resamples; r++) {
    // A partial Fisher–Yates: the first n places are a uniform draw.
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      sum += pool[i];
    }
    if (Math.abs(sum / n - (total - sum) / m) >= observed - 1e-9) hits++;
  }
  return (hits + 1) / (resamples + 1);
}

/**
 * The 90% interval of the effect (the target prompts' mean residual): a
 * bootstrap over prompts, each group resampled on its own, the controls'
 * resampled mean taken as the noise of the strata's means around it.
 */
export function bootstrapInterval(targets, controls, random, resamples = RESAMPLES) {
  const draw = (values) => {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)];
    return sum / values.length;
  };
  const centre = mean(controls);
  const effects = [];
  for (let r = 0; r < resamples; r++) effects.push(draw(targets) - (draw(controls) - centre));
  effects.sort((a, b) => a - b);
  const at = (q) => effects[Math.floor(q * (effects.length - 1))];
  return { low: at(0.05), high: at(0.95) };
}

/** The direction of an effect, as day 7 shows it (up, flat, down). */
export function directionOf(effect) {
  if (effect >= MIN_EFFECT_PTS) return 'up';
  if (effect <= -MIN_EFFECT_PTS) return 'down';
  return 'flat';
}

/** Values grouped by a key, in first-seen order. */
function grouped(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

/**
 * One metric (ActionResultMetric, item 12), stratified: the targets' and
 * the (target-weighted) controls' baseline and checkpoint, the change, the
 * effect, its p-value and 90% interval, in points, as stored (rounded); and
 * the unrounded effect and p it is judged on, with the target cells and
 * prompts kept and the control cells used. Null when no target cell has a
 * control in its stratum.
 */
export function metricResult({ metric, targets, controls, seed }) {
  const strata = new Map();
  for (const [stratum, cells] of grouped(controls, (c) => stratumOf(c.pre, metric))) {
    const pre = mean(cells.map((c) => rate(c.pre, metric)));
    const post = mean(cells.map((c) => rate(c.post, metric)));
    strata.set(stratum, { pre, post, change: post - pre });
  }
  const kept = targets
    .map((cell) => ({ cell, stratum: strata.get(stratumOf(cell.pre, metric)) }))
    .filter((t) => t.stratum);
  if (kept.length === 0) return null;
  const used = new Set(kept.map((t) => stratumOf(t.cell.pre, metric)));
  const usedControls = controls.filter((c) => used.has(stratumOf(c.pre, metric)));

  const targetPrompts = [...grouped(kept, (t) => t.cell.pre.promptId).values()].map((cells) => {
    const of = (fn) => mean(cells.map(fn));
    const pre = of((t) => rate(t.cell.pre, metric));
    const post = of((t) => rate(t.cell.post, metric));
    const controlPre = of((t) => t.stratum.pre);
    const controlPost = of((t) => t.stratum.post);
    return {
      pre,
      post,
      controlPre,
      controlPost,
      residual: post - pre - (controlPost - controlPre),
    };
  });
  const controlResiduals = [...grouped(usedControls, (c) => c.pre.promptId).values()].map((cells) =>
    mean(
      cells.map((c) => {
        const stratum = strata.get(stratumOf(c.pre, metric));
        return rate(c.post, metric) - rate(c.pre, metric) - stratum.change;
      }),
    ),
  );

  const residuals = targetPrompts.map((p) => p.residual);
  const before = mean(targetPrompts.map((p) => p.pre));
  const after = mean(targetPrompts.map((p) => p.post));
  const controlBefore = mean(targetPrompts.map((p) => p.controlPre));
  const controlAfter = mean(targetPrompts.map((p) => p.controlPost));
  const effect = mean(residuals);
  const random = seededRandom(`${seed}:${metric}`);
  const p = permutationP(residuals, controlResiduals, random);
  const interval =
    targetPrompts.length >= MIN_INTERVAL_PROMPTS
      ? bootstrapInterval(residuals, controlResiduals, random)
      : null;
  return {
    stored: {
      metric,
      unit: 'pts',
      before: round1(before),
      after: round1(after),
      delta: round1(after - before),
      deltaPercent: before > 0 ? round1(((after - before) / before) * 100) : null,
      direction: directionOf(effect),
      control_before: round1(controlBefore),
      control_after: round1(controlAfter),
      effect: round1(effect),
      p_value: round3(p),
      interval_low: interval ? round1(interval.low) : null,
      interval_high: interval ? round1(interval.high) : null,
      target_cells: kept.length,
      target_prompts: targetPrompts.length,
      control_cells: usedControls.length,
      control_prompts: controlResiduals.length,
    },
    effect,
    p,
    targetCells: kept.length,
    targetPrompts: targetPrompts.length,
    controlCells: usedControls.length,
  };
}

// ─── One checkpoint ─────────────────────────────────────────────────────────

/** The metric a change is judged on: citations for outreach (third-party placements), else visibility. */
export function primaryMetric(ship) {
  return ship.kind === 'third_party_observed' || ship.change_type === 'outreach'
    ? 'citations'
    : 'visibility';
}

/**
 * One checkpoint of one change, from its windows' cells: the target cells
 * (MIN_RUNS days in both windows), the matched controls, and the metrics,
 * the primary first, with what the primary is judged on (`judged`); or why
 * it can't be measured: no target left once other changes took theirs
 * (overlapping_change), engine_not_on_plan, too_few_runs, or too few
 * controls in the targets' strata (too_few_controls). The controls are
 * returned either way once they were matched, for impact_control_sets.
 *
 * @param {{ seed: string, primary: 'visibility'|'citations', targetIds: string[],
 *   pre: ReturnType<typeof aggregateCells>, post: ReturnType<typeof aggregateCells>,
 *   excluded: Set<string>, prompts: Map<string, { topic_id: string|null, is_active: boolean }> }} input
 */
export function measureCells({ seed, primary, targetIds, pre, post, excluded, prompts }) {
  if (targetIds.length === 0) return { reason: 'overlapping_change', targetCells: 0 };
  const isTarget = new Set(targetIds);
  const targets = [];
  let seen = false;
  for (const [key, cell] of pre.cells) {
    if (!isTarget.has(cell.promptId)) continue;
    seen = true;
    const later = post.cells.get(key);
    if (later && cell.runs >= MIN_RUNS && later.runs >= MIN_RUNS) {
      targets.push({ key, pre: cell, post: later });
    }
  }
  if (targets.length === 0) {
    for (const cell of post.cells.values()) if (isTarget.has(cell.promptId)) seen = true;
    const offPlan = targetIds.some((id) => pre.offPlan.has(id) || post.offPlan.has(id));
    return {
      reason: !seen && offPlan ? 'engine_not_on_plan' : 'too_few_runs',
      targetCells: 0,
    };
  }

  const candidates = [];
  for (const [key, cell] of pre.cells) {
    if (excluded.has(cell.promptId) || !prompts.get(cell.promptId)?.is_active) continue;
    const later = post.cells.get(key);
    if (later && cell.runs >= MIN_RUNS && later.runs >= MIN_RUNS) {
      candidates.push({ key, pre: cell, post: later });
    }
  }
  const targetTopics = new Set(
    targetIds.map((id) => prompts.get(id)?.topic_id).filter((topic) => !!topic),
  );
  const control = matchControls({
    targets,
    candidates,
    targetTopics,
    topicOf: (id) => prompts.get(id)?.topic_id ?? null,
  });
  const main = control.cells.length
    ? metricResult({ metric: primary, targets, controls: control.cells, seed })
    : null;
  if (!main || main.controlCells < MIN_CONTROL_CELLS) {
    return { reason: 'too_few_controls', targetCells: main?.targetCells ?? 0, control };
  }
  const other = metricResult({
    metric: primary === 'visibility' ? 'citations' : 'visibility',
    targets,
    controls: control.cells,
    seed,
  });
  return {
    reason: null,
    targetCells: main.targetCells,
    control,
    metrics: [main.stored, ...(other ? [other.stored] : [])],
    judged: {
      effect: main.effect,
      p: main.p,
      targetCells: main.targetCells,
      targetPrompts: main.targetPrompts,
    },
  };
}

// ─── Outcome ────────────────────────────────────────────────────────────────

/**
 * A verdict from the primary metric's unrounded effect and p (item 10), for
 * a checkpoint with VERDICT_TARGET_PROMPTS target prompts at least
 * (checkpointEntry makes one with fewer Not measurable).
 */
export function verdictOf({ effect, p }) {
  if (effect >= MIN_EFFECT_PTS && p < P_VERDICT) return 'improved';
  if (effect <= -MIN_EFFECT_PTS && p < P_VERDICT) return 'declined';
  return 'no_meaningful_change';
}

/**
 * Confidence (item 10): High with p < P_HIGH, HIGH_TARGET_CELLS and
 * HIGH_TARGET_PROMPTS and no Stormy engine weather on the targets' engines
 * in the window; Medium with p < P_VERDICT, MEDIUM_TARGET_CELLS and
 * MEDIUM_TARGET_PROMPTS; Low otherwise. `stormy` is false until engine
 * weather (feature 1 item 7) exists: none is known.
 */
export function confidenceOf({ p, targetCells, targetPrompts, stormy = false }) {
  if (
    p < P_HIGH &&
    targetCells >= HIGH_TARGET_CELLS &&
    targetPrompts >= HIGH_TARGET_PROMPTS &&
    !stormy
  ) {
    return 'high';
  }
  if (
    p < P_VERDICT &&
    targetCells >= MEDIUM_TARGET_CELLS &&
    targetPrompts >= MEDIUM_TARGET_PROMPTS
  ) {
    return 'medium';
  }
  return 'low';
}

/**
 * Whether a day 90 result held the verdict before it (day 30, else day 14):
 * "held" when it is the same Improved or Declined, "faded" when it isn't;
 * null when there was no such verdict to hold.
 */
export function lastingOf(entries, d90Outcome) {
  const before = [...entries]
    .reverse()
    .find((entry) => entry.checkpoint === 'd30' || entry.checkpoint === 'd14');
  if (!before || (before.outcome !== 'improved' && before.outcome !== 'declined')) return null;
  return d90Outcome === before.outcome ? 'held' : 'faded';
}

/**
 * A checkpoint's entry in checkpoints_json from what measureCells (or the
 * job's earlier checks) said: day 7 is Pending with a direction only, from
 * day 14 a verdict with its confidence, or Not measurable with the reason:
 * the one measureCells gave, or too_few_prompts with fewer than
 * VERDICT_TARGET_PROMPTS target prompts (one prompt's swing isn't a
 * change's effect, however many engines it is on).
 * Each keeps the primary metric's before, after and controls, so an earlier
 * checkpoint's row can be shown beside the latest.
 */
export function checkpointEntry({ cp, window, result, earlier, measuredAt }) {
  const primary = result.metrics?.[0] ?? null;
  const base = {
    checkpoint: cp.key,
    window,
    metric: primary?.metric ?? null,
    before: primary?.before ?? null,
    after: primary?.after ?? null,
    control_before: primary?.control_before ?? null,
    control_after: primary?.control_after ?? null,
    effect: primary?.effect ?? null,
    p_value: primary?.p_value ?? null,
    interval_low: primary?.interval_low ?? null,
    interval_high: primary?.interval_high ?? null,
    direction: primary?.direction ?? null,
    target_cells: result.targetCells ?? 0,
    target_prompts: result.judged?.targetPrompts ?? 0,
    control_cells: primary?.control_cells ?? result.control?.cells.length ?? 0,
    // No engine weather yet (feature 1 item 7): Stormy days can't be checked.
    weather_checked: false,
    measured_at: measuredAt,
  };
  if (cp.key === 'd7') {
    return {
      ...base,
      outcome: 'pending',
      confidence: null,
      not_measurable_reason: result.reason ?? null,
    };
  }
  const reason =
    result.reason ??
    (result.judged.targetPrompts < VERDICT_TARGET_PROMPTS ? 'too_few_prompts' : null);
  if (reason) {
    const entry = {
      ...base,
      outcome: 'not_measurable',
      confidence: null,
      not_measurable_reason: reason,
    };
    return cp.key === 'd90' ? { ...entry, lasting: lastingOf(earlier, 'not_measurable') } : entry;
  }
  const outcome = verdictOf(result.judged);
  const entry = {
    ...base,
    outcome,
    confidence: confidenceOf(result.judged),
    not_measurable_reason: null,
  };
  return cp.key === 'd90' ? { ...entry, lasting: lastingOf(earlier, outcome) } : entry;
}

// ─── An agent run's outcome ─────────────────────────────────────────────────

const CONFIDENCE_ORDER = ['low', 'medium', 'high'];

/**
 * An agent run's outcome from what it shipped (CHAT-21 §I item 43): most
 * runs ship one change, and take its outcome. With several: Pending while
 * none has a verdict (Not measurable when none can have one), Improved when
 * one improved and none declined, Declined the other way round, else No
 * meaningful change; the lowest confidence of the verdicts read.
 *
 * @param {Array<{ outcome: string, confidence: string|null }>} measurements
 * @returns {{ outcome: string, confidence: string|null } | null}
 */
export function runOutcome(measurements) {
  if (measurements.length === 0) return null;
  const verdicts = measurements.filter((m) => VERDICTS.includes(m.outcome));
  if (verdicts.length === 0) {
    const none = measurements.every((m) => m.outcome === 'not_measurable');
    return { outcome: none ? 'not_measurable' : 'pending', confidence: null };
  }
  const improved = verdicts.some((m) => m.outcome === 'improved');
  const declined = verdicts.some((m) => m.outcome === 'declined');
  const outcome =
    improved && !declined
      ? 'improved'
      : declined && !improved
        ? 'declined'
        : 'no_meaningful_change';
  const confidence = verdicts
    .map((m) => m.confidence)
    .filter((c) => CONFIDENCE_ORDER.includes(c))
    .sort((a, b) => CONFIDENCE_ORDER.indexOf(a) - CONFIDENCE_ORDER.indexOf(b))[0];
  return { outcome, confidence: confidence ?? 'low' };
}
