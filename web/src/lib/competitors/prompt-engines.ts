/**
 * A head-to-head prompt's answers by engine (UX audit CP-05): the prompt row
 * counts engines, not engine × model × location combinations, and opens to
 * each engine with its locations under it. A row of fewer than
 * LOW_SAMPLE_RUNS runs is a low sample (metric dictionary D8).
 */

import { foldScores, type HeadToHeadGroup } from '@/lib/head-to-head';

/** Fewer runs than this and a score is a low sample (D8). */
export const LOW_SAMPLE_RUNS = 10;

export const lowSample = (runs: number) => runs < LOW_SAMPLE_RUNS;

/** One engine of a prompt: its locations' rows, their runs and scores over them. */
export interface EngineRows {
  /** The display provider, "ChatGPT". */
  platform: string;
  rows: HeadToHeadGroup[];
  runs: number;
  brandScore: number;
  competitorScore: number;
  diff: number;
  /** Locations listed under it, each once. */
  locations: number;
}

/** Within an engine: by location, then by model. */
const byLocation = (a: HeadToHeadGroup, b: HeadToHeadGroup) =>
  (a.region ?? '').localeCompare(b.region ?? '') || a.modelUsed.localeCompare(b.modelUsed);

/** How many engines a prompt's groups come from. */
export const engineCount = (groups: readonly HeadToHeadGroup[]) =>
  new Set(groups.map((group) => group.platform)).size;

/**
 * A prompt's groups by engine, most runs first; inside each, its locations
 * by name. `twice` holds the rows whose location shows more than once in
 * their engine (two models), which name their model to tell them apart.
 */
export function engineRows(groups: readonly HeadToHeadGroup[]): {
  engines: EngineRows[];
  twice: Set<HeadToHeadGroup>;
} {
  const map = new Map<string, HeadToHeadGroup[]>();
  for (const group of groups) {
    map.set(group.platform, [...(map.get(group.platform) ?? []), group]);
  }
  const twice = new Set<HeadToHeadGroup>();
  const engines = [...map].map(([platform, rows]) => {
    const perRegion = new Map<string, HeadToHeadGroup[]>();
    for (const row of rows) {
      const key = row.region ?? '';
      perRegion.set(key, [...(perRegion.get(key) ?? []), row]);
    }
    for (const same of perRegion.values()) {
      if (same.length > 1) same.forEach((row) => twice.add(row));
    }
    return {
      platform,
      rows: [...rows].sort(byLocation),
      runs: rows.reduce((sum, row) => sum + row.runs, 0),
      locations: perRegion.size,
      ...foldScores(rows),
    };
  });
  engines.sort((a, b) => b.runs - a.runs || a.platform.localeCompare(b.platform));
  return { engines, twice };
}
