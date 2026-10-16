/**
 * The Insights visibility trend (VIS-007), as in the v2 mockup: your line
 * and the competitors you pin (they stay the same whatever the range),
 * markers for the days prompts were added and Action Center actions were
 * sent, and the Action Center goal. Kept apart from the chart so the rules
 * are tested on their own.
 */

/** At most this many competitors can be pinned (also a check on brands, 00136). */
export const MAX_PINNED_COMPETITORS = 5;
/** Without pins, the chart shows this many: the strongest at the end of the range. */
const AUTO_COMPETITORS = 4;
/** Markers of each kind shown at once, so the chart stays readable. */
const MARKERS_PER_KIND = 3;

export const OWN_BRAND_COLOR = '#22c55e';
/** Competitor colors in line order: pin order, or rank without pins. */
const COMPETITOR_PALETTE = ['#1e3a8a', '#a855f7', '#f97316', '#ef4444', '#0d9488'];

interface Entity {
  key: string;
  name: string;
  isOwnBrand: boolean;
}

interface Point {
  date: string;
  day: string;
  values: Record<string, number>;
}

export type TrendLine<E extends Entity = Entity> = E & { color: string };

/**
 * The lines to draw: yours, then the pinned competitors in pin order, or,
 * with nothing pinned, the strongest four at the end of the range (ties
 * broken by the range average), as before pins.
 */
export function trendLines<E extends Entity>(
  entities: E[],
  points: Point[],
  pinned: string[],
): TrendLine<E>[] {
  const own = entities.filter((e) => e.isOwnBrand);
  const competitors = entities.filter((e) => !e.isOwnBrand);
  const byKey = new Map(competitors.map((e) => [e.key, e]));
  const pins = pinned.map((key) => byKey.get(key)).filter((e): e is E => e !== undefined);

  const last = (key: string) => points[points.length - 1]?.values[key] ?? 0;
  const avg = (key: string) =>
    points.reduce((sum, p) => sum + (p.values[key] ?? 0), 0) / Math.max(points.length, 1);
  const shown =
    pins.length > 0
      ? pins.slice(0, MAX_PINNED_COMPETITORS)
      : [...competitors]
          .sort((a, b) => last(b.key) - last(a.key) || avg(b.key) - avg(a.key))
          .slice(0, AUTO_COMPETITORS);

  return [
    ...own.map((e) => ({ ...e, color: OWN_BRAND_COLOR })),
    ...shown.map((e, i) => ({ ...e, color: COMPETITOR_PALETTE[i % COMPETITOR_PALETTE.length] })),
  ];
}

export interface TrendMarkerData {
  promptsAdded: { day: string; count: number }[];
  actionsSent: { day: string; actionNos: number[] }[];
  /** The active "AI visibility" Action Center KPI's target; null without one. */
  goal: number | null;
}

/** The insights_trend_markers payload (00136). */
export function parseTrendMarkers(raw: unknown): Omit<TrendMarkerData, 'goal'> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rows = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    promptsAdded: rows(r.prompts_added).map((d) => ({
      day: String(d.day),
      count: Number(d.count ?? 0),
    })),
    actionsSent: rows(r.actions_sent).map((d) => ({
      day: String(d.day),
      actionNos: Array.isArray(d.action_nos) ? d.action_nos.map(Number) : [],
    })),
  };
}

export type TrendMarker =
  | { kind: 'prompts'; day: string; date: string | null; count: number }
  | { kind: 'actions'; day: string; date: string | null; actionNos: number[] };

/**
 * The markers, each on the chart point of its day (or the next day with a
 * point): the days the most prompts were added and the latest days actions
 * were sent, three of each at most, in day order. A day after the last point
 * (the latest run hasn't landed yet) gets no `date`: it is listed under the
 * chart but not drawn on a day it didn't happen.
 */
export function trendMarkers(data: TrendMarkerData, points: Point[]): TrendMarker[] {
  const dateOf = (day: string) => points.find((p) => p.day >= day)?.date ?? null;

  const prompts = [...data.promptsAdded]
    .sort((a, b) => b.count - a.count || b.day.localeCompare(a.day))
    .slice(0, MARKERS_PER_KIND)
    .map((d) => ({ kind: 'prompts' as const, day: d.day, date: dateOf(d.day), count: d.count }));
  const actions = [...data.actionsSent]
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, MARKERS_PER_KIND)
    .map((d) => ({
      kind: 'actions' as const,
      day: d.day,
      date: dateOf(d.day),
      actionNos: d.actionNos,
    }));

  return [...prompts, ...actions].sort(
    (a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind),
  );
}

/**
 * The Y axis top: ticks run 5, 15, 25, … and the top one sits just above
 * the highest value in view, the goal included, so the goal line is never
 * cut off.
 */
export function trendAxisTop(values: number[], goal: number | null): number {
  const max = Math.max(0, ...values, goal ?? 0);
  let top = 5;
  while (top <= max) top += 10;
  return top;
}
