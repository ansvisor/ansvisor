import { describe, expect, it } from 'vitest';
import { LEADERBOARD_MIN_PROMPTS, leaderboardRows } from './leaderboard';

const brand = (
  name: string,
  score: number | null,
  visiblePrompts?: number,
  visibilityRate = 0,
) => ({
  name,
  score,
  visibilityRate,
  avgVisibilityScore: 0,
  visiblePrompts: visiblePrompts as number,
});

describe('leaderboardRows', () => {
  it('ranks by Visibility score and lists brands under the sample last as low sample', () => {
    // The audit's case (RP-07): Opttab 11 on 14 prompts, Cognizo 10.6 on 93, GeoGenie 10.3 on 1.
    const rows = leaderboardRows([
      brand('GeoGenie', 10.3, 1),
      brand('Opttab', 11, 14),
      brand('Tiny', 40, 3),
      brand('Cognizo', 10.6, 93),
    ]);
    expect(rows.map((r) => [r.entry.name, r.lowSample])).toEqual([
      ['Opttab', false],
      ['Cognizo', false],
      ['Tiny', true],
      ['GeoGenie', true],
    ]);
  });

  it('ranks a brand named in exactly the minimum number of prompts', () => {
    const [row] = leaderboardRows([brand('Edge', 5, LEADERBOARD_MIN_PROMPTS)]);
    expect(row.lowSample).toBe(false);
  });

  it('breaks a tie by name', () => {
    const rows = leaderboardRows([brand('Beta', 20, 50), brand('Alpha', 20, 50)]);
    expect(rows.map((r) => r.entry.name)).toEqual(['Alpha', 'Beta']);
  });

  it('ranks every brand of a report saved before prompt counts, by its own metric', () => {
    const rows = leaderboardRows([
      brand('Low', null, undefined, 12),
      brand('High', null, undefined, 30),
    ]);
    expect(rows.map((r) => [r.entry.name, r.lowSample])).toEqual([
      ['High', false],
      ['Low', false],
    ]);
  });
});
