/**
 * Detector thresholds against what their actions did (learning C6).
 *
 * The Action Center's detectors (config/action-engine.js, `library`) were set
 * as first settings, conservative, "not calibrations". This reads, for one
 * brand, the actions they opened that are over (completed or dismissed): per
 * signal kind, how the actions turned out (improved, mixed, no meaningful
 * change, declined), how many were dismissed and why, and the same by the
 * signal's strength, in quarters (the size of its change, else its value).
 * Where the weakest quarter mostly ends dismissed, or improves far less than
 * the strongest, it suggests a threshold near that quarter's top; where
 * almost nothing improves, it says the detector rarely leads anywhere. A
 * suggestion is a starting point for a maintainer, never applied.
 *
 * It reads rows exported for one brand (scripts/export-detector-outcomes.sql)
 * and gives back aggregates only: nothing of an action (its id, its brand)
 * is in what it returns. Nothing here reads a database or the network.
 */

/** Fewer actions than this for a kind, and nothing is said of it. */
export const MIN_ACTIONS = 20;
/** Fewer actions than this in the weakest quarter, and it isn't judged. */
const MIN_BUCKET = 5;
/** Below this share improved, over enough measured actions, a detector rarely leads anywhere. */
const QUIET_IMPROVED = 0.1;

/** The outcomes that say how an action turned out (the rest are unmeasured). */
export const MEASURED = ['improved', 'mixed', 'no_meaningful_change', 'declined'];
export const DISMISS_REASONS = ['not_relevant', 'already_done', 'wrong_data', 'not_now'];

const num = (value) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * The export's JSON lines, as rows; a line that isn't one is counted, never
 * kept. A row is one action and one of its signals.
 *
 * @returns {{ rows: Array<{ action: string, kind: string, strength: number | null,
 *   status: string, outcome: string | null, dismissReason: string | null }>, skipped: number }}
 */
export function parseRows(text) {
  const rows = [];
  let skipped = 0;
  for (const line of String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!row || typeof row.action !== 'string' || typeof row.kind !== 'string' || !row.kind) {
      skipped += 1;
      continue;
    }
    const change = num(row.change);
    const current = num(row.current);
    rows.push({
      action: row.action,
      kind: row.kind,
      // How strong the signal was: its movement, else its value.
      strength: change !== null ? Math.abs(change) : current !== null ? Math.abs(current) : null,
      status: typeof row.status === 'string' ? row.status : '',
      outcome: typeof row.outcome === 'string' ? row.outcome : null,
      dismissReason: typeof row.dismissReason === 'string' ? row.dismissReason : null,
    });
  }
  return { rows, skipped };
}

/** One row per action and signal kind: its strongest signal of that kind. */
export function actionsByKind(rows) {
  const kinds = new Map();
  for (const row of rows) {
    const byAction = kinds.get(row.kind) ?? new Map();
    const known = byAction.get(row.action);
    if (!known || (row.strength ?? -1) > (known.strength ?? -1)) byAction.set(row.action, row);
    kinds.set(row.kind, byAction);
  }
  return new Map([...kinds].map(([kind, byAction]) => [kind, [...byAction.values()]]));
}

/** The value at a share of sorted values (nearest rank). */
function quantile(sorted, share) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
}

/** How a set of actions turned out: results are a completed action's, as on the Scorecard. */
function tally(actions) {
  const measured = actions.filter((a) => a.status === 'completed' && MEASURED.includes(a.outcome));
  const improved = measured.filter((a) => a.outcome === 'improved').length;
  const dismissed = actions.filter((a) => a.status === 'dismissed').length;
  return {
    actions: actions.length,
    measured: measured.length,
    improved,
    dismissed,
    improvedRate: measured.length ? improved / measured.length : null,
    dismissRate: actions.length ? dismissed / actions.length : null,
  };
}

/**
 * The report, per kind with enough actions: its outcomes, dismissals and
 * their reasons, its strength quarters, and a verdict:
 *  - `raise`: the weakest quarter mostly ends dismissed (more often than
 *    the strongest), or improves at most half as often as the strongest;
 *    `suggestion` is that quarter's top strength, in the signal's own unit;
 *  - `quiet`: under 10% of its measured actions improved;
 *  - `keep`: neither.
 * A kind with fewer actions is listed as insufficient, with its count.
 */
export function calibrate(rows, { min = MIN_ACTIONS } = {}) {
  const kinds = [];
  const insufficient = [];
  for (const [kind, actions] of [...actionsByKind(rows)].sort(([a], [b]) => a.localeCompare(b))) {
    if (actions.length < min) {
      insufficient.push({ kind, actions: actions.length });
      continue;
    }
    const completed = actions.filter((a) => a.status === 'completed');
    const outcomes = Object.fromEntries(
      [...MEASURED, 'not_measurable', 'pending_measurement'].map((o) => [
        o,
        completed.filter((a) => a.outcome === o).length,
      ]),
    );
    const dismissReasons = Object.fromEntries(
      DISMISS_REASONS.map((r) => [r, actions.filter((a) => a.dismissReason === r).length]),
    );
    const strengths = actions
      .map((a) => a.strength)
      .filter((s) => s !== null)
      .sort((a, b) => a - b);
    const cuts = strengths.length
      ? [0.25, 0.5, 0.75].map((share) => quantile(strengths, share))
      : [];
    const quarterOf = (strength) => {
      if (strength === null) return -1;
      const quarter = cuts.findIndex((cut) => strength <= cut);
      return quarter === -1 ? 3 : quarter;
    };
    const buckets = cuts.length
      ? [0, 1, 2, 3].map((q) => ({
          upTo: q < 3 ? cuts[q] : strengths[strengths.length - 1],
          ...tally(actions.filter((a) => quarterOf(a.strength) === q)),
        }))
      : [];

    const overall = tally(actions);
    const weakest = buckets[0];
    const strongest = buckets[3];
    let verdict = 'keep';
    let suggestion = null;
    // Only where the weakest and strongest quarters differ in strength, and
    // each holds enough actions, is there a threshold to move.
    const comparable =
      weakest &&
      strongest &&
      weakest.actions >= MIN_BUCKET &&
      strongest.actions >= MIN_BUCKET &&
      weakest.upTo < strongest.upTo;
    if (
      comparable &&
      ((weakest.dismissRate >= 0.5 && weakest.dismissRate > strongest.dismissRate) ||
        (weakest.improvedRate !== null &&
          strongest.improvedRate > 0 &&
          weakest.improvedRate <= strongest.improvedRate / 2))
    ) {
      verdict = 'raise';
      suggestion = weakest.upTo;
    } else if (overall.measured >= min && (overall.improvedRate ?? 0) < QUIET_IMPROVED) {
      verdict = 'quiet';
    }
    kinds.push({ kind, ...overall, outcomes, dismissReasons, buckets, verdict, suggestion });
  }
  return { kinds, insufficient };
}

const pct = (rate) => (rate === null ? '–' : `${Math.round(rate * 100)}%`);
const round = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

/** The report as Markdown, for a maintainer to read. */
export function renderReport({ kinds, insufficient }, { skipped = 0, min = MIN_ACTIONS } = {}) {
  const lines = ['# Detector thresholds against outcomes (one brand)', ''];
  if (kinds.length === 0) {
    lines.push(`No signal kind has ${min} or more closed actions yet.`, '');
  }
  for (const k of kinds) {
    lines.push(`## ${k.kind}`, '');
    lines.push(
      `${k.actions} closed actions · ${k.measured} measured · improved ${pct(k.improvedRate)} · dismissed ${pct(k.dismissRate)}`,
      '',
    );
    lines.push('| Strength up to | Actions | Improved | Dismissed |', '| --- | --- | --- | --- |');
    for (const b of k.buckets) {
      lines.push(
        `| ${round(b.upTo)} | ${b.actions} | ${pct(b.improvedRate)} | ${pct(b.dismissRate)} |`,
      );
    }
    const reasons = Object.entries(k.dismissReasons)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => `${reason} ${count}`);
    if (reasons.length) lines.push('', `Dismissed because: ${reasons.join(', ')}`);
    lines.push(
      '',
      k.verdict === 'raise'
        ? `Suggestion: consider a threshold near ${round(k.suggestion)}: its weakest quarter rarely leads anywhere.`
        : k.verdict === 'quiet'
          ? 'Note: under 10% of its measured actions improved; check what the detector asks for.'
          : 'Keep: no quarter stands out.',
      '',
    );
  }
  if (insufficient.length) {
    lines.push(
      `Too few closed actions to say (under ${min}): ` +
        insufficient.map((k) => `${k.kind} (${k.actions})`).join(', '),
      '',
    );
  }
  if (skipped) lines.push(`${skipped} line(s) of the export weren't rows and were skipped.`, '');
  return lines.join('\n');
}
