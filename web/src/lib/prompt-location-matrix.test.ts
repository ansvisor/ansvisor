import { describe, expect, it } from 'vitest';
import {
  cellShade,
  locationAverages,
  matrixInsights,
  matrixLocations,
  metricValue,
  rowGap,
  type PromptLocationCell,
  type PromptLocationMatrix,
} from './prompt-location-matrix';

/** The Tracked Prompts Locations view (PROMPT-015b). */

const cell = (
  score: number | null,
  over: Partial<PromptLocationCell> = {},
): PromptLocationCell => ({
  score,
  mentions: score === null ? 0 : Math.round(score / 2),
  citations: 1,
  position: score ? 3.5 : null,
  runs: score === null ? 0 : 7,
  ...over,
});

const matrix: PromptLocationMatrix = {
  p1: { TR: cell(35), 'TR~istanbul': cell(41), US: cell(62) },
  p2: { TR: cell(26), 'TR~istanbul': cell(47), US: cell(20) },
  p3: { US: cell(70) },
};
const prompts = [
  { id: 'p1', text: 'best specialty coffee subscription', regions: ['US', 'TR', 'TR~istanbul'] },
  { id: 'p2', text: 'same day coffee delivery near me', regions: ['US', 'TR', 'TR~istanbul'] },
  { id: 'p3', text: 'single origin vs blend coffee', regions: ['US'] },
];
const regions = ['US', 'TR', 'TR~istanbul'];

describe('metricValue', () => {
  it("reads the metric, and nothing where there are no answers or it's never named", () => {
    expect(metricValue(matrix.p1.US, 'visibility')).toBe(62);
    expect(metricValue(matrix.p1.US, 'mentions')).toBe(31);
    expect(metricValue(matrix.p1.US, 'position')).toBe(3.5);
    expect(metricValue(cell(0, { position: null }), 'position')).toBeNull();
    expect(metricValue(undefined, 'visibility')).toBeNull();
    expect(metricValue(cell(null), 'visibility')).toBeNull();
  });
});

describe('matrixLocations', () => {
  it('shows the locations the prompts track, the most tracked first', () => {
    expect(matrixLocations(prompts)).toEqual(['US', 'TR', 'TR~istanbul']);
    expect(matrixLocations([{ regions: [] }])).toEqual([]);
  });
});

describe('cellShade', () => {
  it('spreads the tones over the values in view; for position, earlier is darker', () => {
    const inView = [20, 35, 62, 70];
    expect(cellShade(70, inView, 'visibility')).toBe(4);
    expect(cellShade(20, inView, 'visibility')).toBe(1);
    expect(cellShade(null, inView, 'visibility')).toBe(0);
    expect(cellShade(0, inView, 'visibility')).toBe(0);
    expect(cellShade(1.5, [1.5, 6], 'position')).toBe(4);
    expect(cellShade(6, [1.5, 6], 'position')).toBe(1);
  });
});

describe('rowGap and locationAverages', () => {
  it('reads the gap between the best and worst location, and each location’s average', () => {
    expect(rowGap([35, 41, 62])).toBe(27);
    expect(rowGap([35, null])).toBeNull();
    expect(locationAverages(matrix, ['p1', 'p2', 'p3'], regions, 'visibility')).toEqual([
      51, 31, 44,
    ]);
  });
});

describe('matrixInsights', () => {
  it('names the weakest and strongest location and the widest prompt, on visibility', () => {
    expect(matrixInsights(matrix, prompts, regions)).toEqual({
      weakest: { region: 'TR', average: 31, untracked: 1 },
      strongest: { region: 'US', average: 51, tracked: 3 },
      widest: {
        promptId: 'p1',
        text: 'best specialty coffee subscription',
        low: 35,
        lowAt: 'TR',
        high: 62,
        highAt: 'US',
      },
      overall: 43,
    });
  });
});
