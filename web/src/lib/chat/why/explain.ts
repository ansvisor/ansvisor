/**
 * Why did it move (CHAT-22 §1, explain_change): the analysis itself, from
 * the counts the server read of scheduled tracking (chat_why_cells), with no
 * model call and no engine query (Addendum 2 G). Pure, so every number the
 * answer may say is computed here and kept in chat_why_analyses (00420).
 *
 * The metrics are the app's own (Insights' cards): visibility is the share
 * of tracked prompts the brand was named or cited in (a prompt is one cell,
 * its engines together); the others are rates per prompt × engine cell
 * (mention rate, citation rate, share of voice by mentions, average position).
 *
 * The steps, as §1 item 5 has them:
 *   1. Noise: the change's standard error from the pooled rate of the two
 *      periods; a change of at most 2 × SE is within normal swing (none at
 *      all always is). The average position has no spread within a cell, so
 *      with few cells it can't be measured.
 *   2. Change point: the day the daily series splits into the two most
 *      different halves (at least 3 days each).
 *   3. Mix effect: what the set's change explains. First the engines
 *      tracked in one period only (the change minus the change counted on
 *      the engines in both; visibility's prompts are recounted on those),
 *      then the prompts (minus the change on the cells tracked in both).
 *      Cells tracked in both but counted in one only (the brand not named,
 *      for the average position or share of voice) are a line of their own,
 *      never a set change; cells in both with fewer than 3 runs in a period
 *      are "not enough data", one more.
 *   4. Attribution: each stable cell's own rate change (at its average
 *      weight) goes to one cause, first rule that matches its evidence (a
 *      site change, a citation lost to a competitor, a citation lost, a
 *      competitor entering), or gained ones; its change of weight stays in
 *      the remainder. A cell whose answers couldn't all be read gets none.
 *   5. Engine weather: not in Wave 2 (no benchmark panel yet).
 *   6. Shares of the change, against the parts that moved its way: whole
 *      percents that add up to 100 (largest remainder); a part that moved
 *      the other way partly offset it, in points. Within normal swing, no
 *      shares. The rest is normal swing or unexplained.
 *   7. Confidence by the cells that show the cause.
 * Never "caused": the words are the answer's, from these shares (§ shared 2).
 */

export const WHY_METRICS = [
  'visibility',
  'mention_rate',
  'share_of_voice',
  'citations',
  'avg_position',
] as const;
export type WhyMetric = (typeof WHY_METRICS)[number];

/** Runs a cell needs in each period to count (§1 item 5.1). */
export const MIN_RUNS = 3;
/** Bars shown, at most, "other" included (§1 item 4). */
export const MAX_CAUSES = 5;
/** A cause under this share of the change folds into "other". */
export const MIN_SHARE = 10;
/** Stable cells the average position needs to measure its swing (no spread within a cell). */
export const MIN_POSITION_CELLS = 5;
/** Evidence rows kept per cause. */
const MAX_REFS = 10;

/** A cell's counts in one period, as chat_why_cells sums them. */
export interface CellCounts {
  /** Tracked day rows, and those where the brand was named or cited. */
  runs: number;
  visibleRuns: number;
  /** Answers, those naming the brand and those citing its pages. */
  answers: number;
  mentionAnswers: number;
  citationAnswers: number;
  /** Mentions of the brand, and of its tracked competitors (share of voice). */
  brandMentions: number;
  competitorMentions: number;
  /** Positions where the brand was named: their sum and count. */
  sumPosition: number;
  positionCount: number;
}

/** A day of the series: the counts, with the prompts named or cited and those tracked. */
export interface DayCounts extends CellCounts {
  visiblePrompts: number;
  activePrompts: number;
}

/**
 * One cell, its counts in a and in b: a prompt × engine × location, or for
 * visibility a prompt (its engines together).
 */
export interface WhyCell {
  key: string;
  promptId: string;
  /** The engine's slug (platform or model); "all" for a visibility prompt. */
  engine: string;
  a: CellCounts | null;
  b: CellCounts | null;
}

/** An answer, a cited page or an audit the evidence drawer opens (§1 item 4). */
export interface EvidenceRef {
  type: 'answer' | 'audit';
  id: string;
  /** The day it was tracked or audited, ISO date. */
  date: string;
  period: 'a' | 'b';
  url?: string;
}

/** What a cell's answers show, read for the cells that moved most. */
export interface CellEvidence {
  /** The brand's own pages cited in its answers, per period. */
  ownCitedA: string[];
  ownCitedB: string[];
  /** Tracked competitors' pages cited, per period. */
  competitorCitedA: string[];
  competitorCitedB: string[];
  /** Answers naming a tracked competitor, as a share of the period's answers. */
  competitorRateA: number;
  competitorRateB: number;
  /** Own pages whose AI-reach signals changed between the periods (Site Audit). */
  siteChanges: {
    url: string;
    direction: 'worse' | 'better';
    signals: string[];
    ref: EvidenceRef;
  }[];
  /** The answers read, per period. */
  answersA: EvidenceRef[];
  answersB: EvidenceRef[];
  /** Not all its answers could be read: no cause is drawn from it. */
  partial?: boolean;
  /** The prompt's text, for the cause's rows. */
  prompt?: string;
}

/** One prompt a cause shows (§1 item 4's table): what was cited before and now, and when. */
export interface CauseRow {
  prompt: string;
  /** The page cited in the earlier period, or null. */
  before: string | null;
  /** The page cited in the later one, or null when none of the brand's or a rival's was. */
  now: string | null;
  /** The newest answer of the later period, ISO date. */
  date: string | null;
  /** That answer, for the evidence drawer. */
  answer: EvidenceRef | null;
}

export type CauseKind =
  | 'site_change'
  | 'lost_citation_to_competitor'
  | 'lost_citation'
  | 'competitor_entered'
  | 'won_citation_from_competitor'
  | 'gained_citation'
  | 'competitor_left'
  | 'engines_changed'
  | 'prompt_set_changed'
  | 'not_mentioned'
  | 'not_enough_data'
  | 'other';

export type Confidence = 'low' | 'medium' | 'high';

/** The next step a cause offers (§1 item 4 "One fix per cause"), by its skill. */
const FIX_SKILL: Partial<Record<CauseKind, string>> = {
  site_change: 'site_audit_fix',
  lost_citation_to_competitor: 'winback',
  lost_citation: 'winback',
  competitor_entered: 'beat',
  prompt_set_changed: 'restore_prompt',
};

export interface WhyCause {
  kind: CauseKind;
  /**
   * Its share of the change, 0–100, among the parts that moved its way;
   * null when it partly offset the change, or the change is within normal swing.
   */
  share: number | null;
  /** Its part of the change, in the metric's unit (points, or positions), signed. */
  contribution: number;
  /** It moved against the change: it partly offset it. */
  offset: boolean;
  confidence: Confidence;
  /** The cells that show it. */
  cells: number;
  evidence_refs: EvidenceRef[];
  fix_skill: string | null;
  /** The pages it is about (own pages lost or gained, a changed page). */
  urls?: string[];
  /** The prompts that show it, up to 10. */
  rows?: CauseRow[];
}

/** The explain_change contract (§1 item 6), engine weather aside (not in Wave 2). */
export interface WhyResult {
  metric: WhyMetric;
  /** "pts" for a rate, "positions" for the average position. */
  unit: 'pts' | 'positions';
  period_a: { from: string; to: string };
  period_b: { from: string; to: string };
  value_a: number | null;
  value_b: number | null;
  delta: number | null;
  /** The standard error of the change; null when it can't be measured. */
  se: number | null;
  noise_verdict: 'beyond_normal_swing' | 'within_normal_swing' | 'not_measurable';
  /** A decline is a lower rate, or a higher average position. */
  direction: 'declined' | 'improved' | 'flat';
  change_point: { date: string; before: number; after: number } | null;
  mix_effect: {
    contribution: number;
    share: number | null;
    prompts_added: number;
    prompts_removed: number;
    engines_added: string[];
    engines_removed: string[];
  };
  /** Up to 5 bars, "other" included, largest first. */
  causes: WhyCause[];
  /** Cells tracked in both periods with fewer than 3 runs in one ("Not enough data"). */
  excluded_cells: number;
  /** Cells compared in both periods. */
  stable_cells: number;
  /** Cells tracked in a period where the metric had nothing to count (the brand not named). */
  unmentioned_cells: { a: number; b: number };
  /** The moved cells' answers couldn't all be read: some got no cause. */
  evidence_partial: boolean;
  unexplained: {
    kind: 'normal_swing' | 'unexplained';
    contribution: number;
    share: number | null;
  };
}

const round = (value: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** A metric's count over what it counts in, for one cell's period. */
export function ratioOf(metric: WhyMetric, c: CellCounts): { num: number; den: number } {
  switch (metric) {
    // A prompt: named or cited at all in the period, of it being tracked.
    case 'visibility':
      return { num: c.visibleRuns > 0 ? 1 : 0, den: c.runs > 0 ? 1 : 0 };
    case 'mention_rate':
      return { num: c.mentionAnswers, den: c.answers };
    case 'citations':
      return { num: c.citationAnswers, den: c.answers };
    case 'share_of_voice':
      return { num: c.brandMentions, den: c.brandMentions + c.competitorMentions };
    case 'avg_position':
      return { num: c.sumPosition, den: c.positionCount };
  }
}

/** A day's value: visibility as Insights counts it per day, the others as their cells. */
function dayRatio(metric: WhyMetric, day: DayCounts): { num: number; den: number } {
  return metric === 'visibility'
    ? { num: day.visiblePrompts, den: day.activePrompts }
    : ratioOf(metric, day);
}

/** A rate reads in points (0–100); the average position as it is. */
const scaleOf = (metric: WhyMetric) => (metric === 'avg_position' ? 1 : 100);

/** For the average position, a lower number is better. */
const betterSign = (metric: WhyMetric) => (metric === 'avg_position' ? -1 : 1);

/** Tracked in the period: the cell had runs, whatever the metric counted. */
const tracked = (c: CellCounts | null): c is CellCounts => !!c && c.runs > 0;

/** The pooled value of some cells' parts, in the metric's unit; null with nothing to count. */
function valueOf(metric: WhyMetric, parts: { num: number; den: number }[]): number | null {
  const den = parts.reduce((sum, p) => sum + p.den, 0);
  if (den <= 0) return null;
  return (parts.reduce((sum, p) => sum + p.num, 0) / den) * scaleOf(metric);
}

/**
 * The change's standard error over the stable cells, or null when it can't
 * be measured. A rate: the pooled rate of the two periods, p(1−p)(1/Na + 1/Nb).
 * The average position: the cells' spread around the mean, with enough cells.
 */
export function changeSe(
  metric: WhyMetric,
  a: { num: number; den: number }[],
  b: { num: number; den: number }[],
): number | null {
  const denA = a.reduce((s, p) => s + p.den, 0);
  const denB = b.reduce((s, p) => s + p.den, 0);
  if (denA <= 0 || denB <= 0) return null;
  if (metric !== 'avg_position') {
    const p = (a.reduce((s, x) => s + x.num, 0) + b.reduce((s, x) => s + x.num, 0)) / (denA + denB);
    const rate = Math.min(1, Math.max(0, p));
    return Math.sqrt(rate * (1 - rate) * (1 / denA + 1 / denB)) * scaleOf(metric);
  }
  if (a.length < MIN_POSITION_CELLS) return null;
  const spread = (parts: { num: number; den: number }[], den: number) => {
    const mean = parts.reduce((s, p) => s + p.num, 0) / den;
    return parts.reduce((s, p) => s + (p.den / den) ** 2 * (p.num / p.den - mean) ** 2, 0);
  };
  return Math.sqrt(spread(a, denA) + spread(b, denB));
}

/**
 * The day the daily series changed most: the split into two runs of days
 * (3 at least each) whose means differ most, weighted by their lengths.
 */
export function changePoint(
  metric: WhyMetric,
  daily: { day: string; counts: DayCounts }[],
): WhyResult['change_point'] {
  const series = daily
    .map((d) => ({ day: d.day, ...dayRatio(metric, d.counts) }))
    .filter((d) => d.den > 0)
    .sort((x, y) => x.day.localeCompare(y.day))
    .map((d) => ({ day: d.day, value: (d.num / d.den) * scaleOf(metric) }));
  if (series.length < 2 * 3) return null;
  let best: { at: number; score: number } | null = null;
  for (let at = 3; at <= series.length - 3; at++) {
    const left = series.slice(0, at);
    const right = series.slice(at);
    const m1 = left.reduce((s, d) => s + d.value, 0) / left.length;
    const m2 = right.reduce((s, d) => s + d.value, 0) / right.length;
    const score = ((left.length * right.length) / series.length) * (m1 - m2) ** 2;
    if (!best || score > best.score) best = { at, score };
  }
  if (!best || best.score === 0) return null;
  const mean = (list: { value: number }[]) => list.reduce((s, d) => s + d.value, 0) / list.length;
  return {
    date: series[best.at].day,
    before: round(mean(series.slice(0, best.at))),
    after: round(mean(series.slice(best.at))),
  };
}

const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));

/**
 * The cause one stable cell's move goes to, first rule that matches (§1
 * item 5.4); null when its answers show none, or couldn't all be read.
 * `worse`: the cell's own rate moved the bad way.
 */
export function cellCause(
  evidence: CellEvidence | undefined,
  worse: boolean,
): { kind: CauseKind; urls: string[]; refs: EvidenceRef[] } | null {
  if (!evidence || evidence.partial) return null;
  return causeOf(evidence, worse);
}

/** A cell's row for its cause's table. */
function rowOf(evidence: CellEvidence, kind: CauseKind): CauseRow | null {
  if (!evidence.prompt) return null;
  const latest = evidence.answersB[0] ?? null;
  const gained = kind === 'won_citation_from_competitor' || kind === 'gained_citation';
  return {
    prompt: evidence.prompt,
    before: gained
      ? (evidence.competitorCitedA[0] ?? null)
      : (minus(evidence.ownCitedA, evidence.ownCitedB)[0] ?? evidence.ownCitedA[0] ?? null),
    now: gained
      ? (minus(evidence.ownCitedB, evidence.ownCitedA)[0] ?? evidence.ownCitedB[0] ?? null)
      : (evidence.competitorCitedB[0] ?? evidence.ownCitedB[0] ?? null),
    date: latest?.date ?? null,
    answer: latest,
  };
}

function causeOf(
  evidence: CellEvidence,
  worse: boolean,
): { kind: CauseKind; urls: string[]; refs: EvidenceRef[] } | null {
  const lost = minus(evidence.ownCitedA, evidence.ownCitedB);
  const gained = minus(evidence.ownCitedB, evidence.ownCitedA);
  const site = evidence.siteChanges.filter(
    (change) => change.direction === (worse ? 'worse' : 'better'),
  );
  const refsOf = (period: 'a' | 'b') => (period === 'a' ? evidence.answersA : evidence.answersB);
  if (site.length > 0) {
    return {
      kind: 'site_change',
      urls: site.map((change) => change.url),
      refs: [...site.map((change) => change.ref), ...refsOf(worse ? 'b' : 'a').slice(0, 2)],
    };
  }
  if (worse) {
    if (lost.length > 0) {
      const swapped = evidence.competitorCitedB.length > 0;
      return {
        kind: swapped ? 'lost_citation_to_competitor' : 'lost_citation',
        urls: lost,
        refs: [...refsOf('a').slice(0, 2), ...refsOf('b').slice(0, 2)],
      };
    }
    if (evidence.competitorRateB > evidence.competitorRateA) {
      return { kind: 'competitor_entered', urls: [], refs: refsOf('b').slice(0, 3) };
    }
    return null;
  }
  if (gained.length > 0) {
    const swapped = evidence.competitorCitedA.length > 0;
    return {
      kind: swapped ? 'won_citation_from_competitor' : 'gained_citation',
      urls: gained,
      refs: [...refsOf('a').slice(0, 2), ...refsOf('b').slice(0, 2)],
    };
  }
  if (evidence.competitorRateB < evidence.competitorRateA) {
    return { kind: 'competitor_left', urls: [], refs: refsOf('b').slice(0, 3) };
  }
  return null;
}

/** High: shown in 10 cells or more; Medium: in 3 to 9; Low: fewer (§1 item 5.7). */
export function confidenceOf(cells: number): Confidence {
  if (cells >= 10) return 'high';
  if (cells >= 3) return 'medium';
  return 'low';
}

/** In both periods with something to count in each. */
const inBoth = (metric: WhyMetric, cell: WhyCell) =>
  tracked(cell.a) &&
  tracked(cell.b) &&
  ratioOf(metric, cell.a).den > 0 &&
  ratioOf(metric, cell.b).den > 0;

/** A cell in both periods with enough runs in each (the stable set). */
const isStable = (metric: WhyMetric, cell: WhyCell) =>
  inBoth(metric, cell) && cell.a!.runs >= MIN_RUNS && cell.b!.runs >= MIN_RUNS;

/**
 * The stable cells whose own rate moved most, by key: those whose answers
 * are read for evidence (the rest go to "other" or the remainder).
 */
export function movedCells(metric: WhyMetric, cells: WhyCell[], count: number): string[] {
  return cells
    .filter((cell) => isStable(metric, cell))
    .map((cell) => {
      const a = ratioOf(metric, cell.a!);
      const b = ratioOf(metric, cell.b!);
      return { key: cell.key, moved: Math.abs(b.num / b.den - a.num / a.den) };
    })
    .filter((cell) => cell.moved > 0)
    .sort((x, y) => y.moved - x.moved)
    .slice(0, count)
    .map((cell) => cell.key);
}

/** A number's sign, a float's leftover (±1e−14) counting as none. */
const signOf = (value: number) => (Math.abs(value) < 1e-9 ? 0 : Math.sign(value));

/**
 * Whole percents that add up as the parts do (100 for all of the change):
 * each rounded down, the percents left to the largest remainders. A null
 * part keeps none.
 */
export function wholeShares(raw: (number | null)[]): (number | null)[] {
  const floors = raw.map((share) => (share === null ? null : Math.floor(share)));
  const given = floors.reduce<number>((sum, share) => sum + (share ?? 0), 0);
  const target = Math.round(raw.reduce<number>((sum, share) => sum + (share ?? 0), 0));
  const order = raw
    .map((share, i) => ({ i, rest: share === null ? -1 : share - Math.floor(share) }))
    .filter((part) => part.rest >= 0)
    .sort((x, y) => y.rest - x.rest);
  const out = [...floors];
  for (let k = 0; k < target - given && k < order.length; k++) {
    out[order[k].i] = (out[order[k].i] ?? 0) + 1;
  }
  return out;
}

/** The analysis, from the cells, the daily series and the moved cells' evidence. */
export function explainChange(input: {
  metric: WhyMetric;
  periodA: { from: string; to: string };
  periodB: { from: string; to: string };
  cells: WhyCell[];
  /** The engines tracked in each period; else read from the cells (visibility's don't name theirs). */
  engines?: { a: string[]; b: string[] };
  /**
   * The cells counted on the engines tracked in both periods only: what the
   * periods are compared on (visibility's prompts recounted without an added
   * or a dropped engine). Else the cells of those engines.
   */
  sameEngineCells?: WhyCell[];
  daily: { day: string; counts: DayCounts }[];
  evidence: Map<string, CellEvidence>;
}): WhyResult {
  const { metric, cells } = input;
  const unit = metric === 'avg_position' ? 'positions' : 'pts';
  const scale = scaleOf(metric);
  const sign = betterSign(metric);
  const counted = (c: CellCounts | null): c is CellCounts =>
    tracked(c) && ratioOf(metric, c).den > 0;

  // The headline: every cell tracked in the period, as the app's own pages count it.
  const valueA = valueOf(
    metric,
    cells.flatMap((c) => (counted(c.a) ? [ratioOf(metric, c.a)] : [])),
  );
  const valueB = valueOf(
    metric,
    cells.flatMap((c) => (counted(c.b) ? [ratioOf(metric, c.b)] : [])),
  );
  const delta = valueA !== null && valueB !== null ? valueB - valueA : null;

  // The engines in each period; the periods are compared on those in both.
  const enginesIn = (period: 'a' | 'b') =>
    new Set(
      input.engines?.[period] ?? cells.filter((c) => tracked(c[period])).map((c) => c.engine),
    );
  const [ea, eb] = [enginesIn('a'), enginesIn('b')];
  const enginesChanged = [...ea].some((e) => !eb.has(e)) || [...eb].some((e) => !ea.has(e));
  const same = input.sameEngineCells ?? cells.filter((c) => ea.has(c.engine) && eb.has(c.engine));

  // Of those: tracked in both periods; counted in both; with enough runs in each (stable).
  const trackedBoth = same.filter((c) => tracked(c.a) && tracked(c.b));
  const both = trackedBoth.filter((c) => inBoth(metric, c));
  const stable = both.filter((c) => isStable(metric, c));
  const partsA = (list: WhyCell[]) => list.map((c) => ratioOf(metric, c.a!));
  const partsB = (list: WhyCell[]) => list.map((c) => ratioOf(metric, c.b!));
  /** The change over some cells, each period counting the cells it can. */
  const changeIn = (list: WhyCell[]) => {
    const a = valueOf(
      metric,
      list.flatMap((c) => (counted(c.a) ? [ratioOf(metric, c.a)] : [])),
    );
    const b = valueOf(
      metric,
      list.flatMap((c) => (counted(c.b) ? [ratioOf(metric, c.b)] : [])),
    );
    return a !== null && b !== null ? b - a : 0;
  };
  const deltaSame = changeIn(same);
  const deltaTracked = changeIn(trackedBoth);
  const deltaBoth = changeIn(both);
  const deltaStable = changeIn(stable);
  // The set's change: engines added or dropped, then prompts (§1 item 5.3).
  const engineMix = delta === null ? 0 : delta - deltaSame;
  const promptMix = delta === null ? 0 : deltaSame - deltaTracked;
  const mix = engineMix + promptMix;
  // Tracked in both, counted in one only: the brand not named there.
  const unmentioned = deltaTracked - deltaBoth;
  const notEnough = deltaBoth - deltaStable;
  const se = stable.length > 0 ? changeSe(metric, partsA(stable), partsB(stable)) : null;
  const noise: WhyResult['noise_verdict'] =
    delta === null
      ? 'not_measurable'
      : round(delta, 6) === 0
        ? 'within_normal_swing'
        : se === null
          ? 'not_measurable'
          : Math.abs(delta) <= 2 * se
            ? 'within_normal_swing'
            : 'beyond_normal_swing';

  // What changed in the set: prompts tracked in one period only.
  const promptsIn = (period: 'a' | 'b') =>
    new Set(cells.filter((c) => tracked(c[period])).map((c) => c.promptId));
  const [pa, pb] = [promptsIn('a'), promptsIn('b')];

  // Each stable cell's part of the stable change, split: its own rate's
  // change at its average weight (what evidence explains), and its change
  // of weight (the remainder's). The two sum to its part, the parts to deltaStable.
  const denA = stable.reduce((s, c) => s + ratioOf(metric, c.a!).den, 0);
  const denB = stable.reduce((s, c) => s + ratioOf(metric, c.b!).den, 0);
  const byKind = new Map<
    CauseKind,
    {
      contribution: number;
      cells: number;
      refs: EvidenceRef[];
      urls: Set<string>;
      rows: CauseRow[];
    }
  >();
  for (const cell of stable) {
    const ra = ratioOf(metric, cell.a!);
    const rb = ratioOf(metric, cell.b!);
    const rateA = ra.num / ra.den;
    const rateB = rb.num / rb.den;
    const weight = (ra.den / denA + rb.den / denB) / 2;
    const own = weight * (rateB - rateA) * scale;
    if (own === 0) continue;
    const found = input.evidence.get(cell.key);
    const cause = cellCause(found, (rateB - rateA) * sign < 0);
    if (!cause || !found) continue;
    const entry = byKind.get(cause.kind) ?? {
      contribution: 0,
      cells: 0,
      refs: [],
      urls: new Set<string>(),
      rows: [],
    };
    const row = rowOf(found, cause.kind);
    if (row && entry.rows.length < MAX_REFS) entry.rows.push(row);
    entry.contribution += own;
    entry.cells += 1;
    for (const ref of cause.refs) if (entry.refs.length < MAX_REFS) entry.refs.push(ref);
    for (const url of cause.urls) entry.urls.add(url);
    byKind.set(cause.kind, entry);
  }

  type Part = Omit<WhyCause, 'share' | 'offset'>;
  const parts: Part[] = [...byKind.entries()].map(([kind, entry]) => ({
    kind,
    contribution: entry.contribution,
    confidence: confidenceOf(entry.cells),
    cells: entry.cells,
    evidence_refs: entry.refs,
    fix_skill: FIX_SKILL[kind] ?? null,
    ...(entry.urls.size > 0 ? { urls: [...entry.urls].slice(0, 5) } : {}),
    ...(entry.rows.length > 0 ? { rows: entry.rows } : {}),
  }));
  // The set changed: an engine, or a prompt, tracked in one period only.
  // Arithmetic, not inference: the set did change.
  const promptSetChanged = same.some((c) => tracked(c.a) !== tracked(c.b));
  const setChanged = enginesChanged || promptSetChanged;
  if (enginesChanged && round(engineMix, 2) !== 0) {
    const sameByKey = new Map(same.map((c) => [c.key, c]));
    parts.push({
      kind: 'engines_changed',
      contribution: engineMix,
      confidence: 'high',
      // The cells an added or dropped engine counts in.
      cells: cells.filter((c) => {
        const kept = sameByKey.get(c.key);
        return !kept || kept.a?.runs !== c.a?.runs || kept.b?.runs !== c.b?.runs;
      }).length,
      evidence_refs: [],
      fix_skill: null,
    });
  }
  if (promptSetChanged && round(promptMix, 2) !== 0) {
    parts.push({
      kind: 'prompt_set_changed',
      contribution: promptMix,
      confidence: 'high',
      cells: same.filter((c) => tracked(c.a) !== tracked(c.b)).length,
      evidence_refs: [],
      fix_skill: FIX_SKILL.prompt_set_changed ?? null,
    });
  }
  if (round(unmentioned, 2) !== 0) {
    parts.push({
      kind: 'not_mentioned',
      contribution: unmentioned,
      confidence: 'low',
      cells: trackedBoth.length - both.length,
      evidence_refs: [],
      fix_skill: null,
    });
  }
  if (round(notEnough, 2) !== 0) {
    parts.push({
      kind: 'not_enough_data',
      contribution: notEnough,
      confidence: 'low',
      cells: both.length - stable.length,
      evidence_refs: [],
      fix_skill: null,
    });
  }

  // The rest: cells no evidence explained, their changes of weight, and normal swing.
  const residualPart = (delta ?? 0) - parts.reduce((s, p) => s + p.contribution, 0);

  // Shares among what moved the change's way, 0–100; none within normal swing or without a stable set.
  const way = signOf(delta ?? 0);
  const towards = [...parts.map((p) => p.contribution), residualPart].filter(
    (c) => signOf(c) === way && way !== 0,
  );
  const total = towards.reduce((s, c) => s + c, 0);
  const sharing = noise === 'beyond_normal_swing' && stable.length > 0 && total !== 0;
  /** Its share before rounding; null when it didn't move the change's way. */
  const shareOf = (contribution: number) =>
    sharing && signOf(contribution) === way
      ? Math.min(100, Math.max(0, (contribution / total) * 100))
      : null;

  // Largest first, at most 5 bars: past 4, or under 10%, into "other".
  parts.sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution));
  const small = (p: Part) => {
    const share = shareOf(p.contribution);
    return share !== null && share < MIN_SHARE;
  };
  const big = parts.filter((p) => !small(p));
  const needsOther = big.length < parts.length || big.length > MAX_CAUSES;
  const shown = needsOther ? big.slice(0, MAX_CAUSES - 1) : big;
  const folded = parts.filter((p) => !shown.includes(p));
  const causes: WhyCause[] = shown.map((p) => ({
    ...p,
    contribution: round(p.contribution, 2),
    share: shareOf(p.contribution),
    offset: way !== 0 && signOf(p.contribution) === -way,
  }));
  if (folded.length > 0) {
    const contribution = folded.reduce((s, p) => s + p.contribution, 0);
    causes.push({
      kind: 'other',
      contribution: round(contribution, 2),
      share: shareOf(contribution),
      offset: way !== 0 && signOf(contribution) === -way,
      confidence: 'low',
      cells: folded.reduce((s, p) => s + p.cells, 0),
      evidence_refs: folded.flatMap((p) => p.evidence_refs).slice(0, MAX_REFS),
      fix_skill: null,
    });
  }
  // The bars and the rest, in whole percents that add up to 100.
  const shares = wholeShares([...causes.map((c) => c.share), shareOf(residualPart)]);
  causes.forEach((cause, i) => (cause.share = shares[i]));
  const residualShare = shares[causes.length];
  const mixShare = shareOf(mix);

  return {
    metric,
    unit,
    period_a: input.periodA,
    period_b: input.periodB,
    value_a: valueA === null ? null : round(valueA),
    value_b: valueB === null ? null : round(valueB),
    delta: delta === null ? null : round(delta),
    se: se === null ? null : round(se, 2),
    noise_verdict: noise,
    direction:
      delta === null || round(delta) === 0 ? 'flat' : delta * sign < 0 ? 'declined' : 'improved',
    change_point: changePoint(metric, input.daily),
    mix_effect: {
      contribution: round(mix, 2),
      share: setChanged && mixShare !== null ? Math.round(mixShare) : null,
      prompts_added: minus([...pb], [...pa]).length,
      prompts_removed: minus([...pa], [...pb]).length,
      engines_added: minus([...eb], [...ea]),
      engines_removed: minus([...ea], [...eb]),
    },
    causes,
    excluded_cells: both.length - stable.length,
    stable_cells: stable.length,
    unmentioned_cells: {
      a: cells.filter((c) => tracked(c.a) && !counted(c.a)).length,
      b: cells.filter((c) => tracked(c.b) && !counted(c.b)).length,
    },
    evidence_partial: [...input.evidence.values()].some((e) => e.partial === true),
    unexplained: {
      kind: se !== null && Math.abs(residualPart) <= 2 * se ? 'normal_swing' : 'unexplained',
      contribution: round(residualPart, 2),
      share: residualShare,
    },
  };
}
