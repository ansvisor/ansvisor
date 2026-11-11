import { describe, expect, it } from 'vitest';
import {
  firstPicks,
  mentionRate,
  rankPauseCandidates,
  spotsFreed,
  spotsShort,
  type PauseCandidate,
} from './prompt-swap';

/**
 * The swap dialog's candidates (Simplify PR 16): the brand on screen first,
 * then the workspace's other brands, since the plan's limit is shared; each
 * the least useful first, low demand, then how rarely AI named the brand in
 * 30 days. A prompt in several locations needs that many spots.
 */

const candidate = (id: string, over: Partial<PauseCandidate> = {}): PauseCandidate => ({
  id,
  text: `Prompt ${id}`,
  brandId: 'b1',
  brandName: 'Brewline',
  current: true,
  locations: 1,
  demand: 'low',
  mentions: 0,
  answers: 30,
  ...over,
});

const ids = (list: PauseCandidate[]) => list.map((c) => c.id);

describe('rankPauseCandidates', () => {
  it('lists low demand first, then the prompts AI names the brand on least', () => {
    expect(
      ids(
        rankPauseCandidates([
          candidate('high', { demand: 'high' }),
          candidate('medium-named', { demand: 'medium', mentions: 2 }),
          candidate('low-named', { mentions: 1 }),
          candidate('medium', { demand: 'medium' }),
          candidate('low', { mentions: 0 }),
        ]),
      ),
    ).toEqual(['low', 'low-named', 'medium', 'medium-named', 'high']);
  });

  it('compares the mention rate, not the count, and puts unmeasured demand after low', () => {
    expect(
      ids(
        rankPauseCandidates([
          candidate('unmeasured', { demand: null }),
          candidate('often', { mentions: 3, answers: 6 }),
          candidate('rarely', { mentions: 3, answers: 60 }),
          candidate('medium', { demand: 'medium' }),
        ]),
      ),
    ).toEqual(['rarely', 'often', 'unmeasured', 'medium']);
  });

  it('keeps prompts without answers after those AI was asked about', () => {
    expect(
      ids(
        rankPauseCandidates([
          candidate('new', { answers: 0 }),
          candidate('named', { mentions: 5, answers: 10 }),
        ]),
      ),
    ).toEqual(['named', 'new']);
    expect(mentionRate({ mentions: 0, answers: 0 })).toBeNull();
    expect(mentionRate({ mentions: 1, answers: 4 })).toBe(0.25);
  });

  it("lists the brand on screen first, then the person's other brands, as the limit is shared", () => {
    expect(
      ids(
        rankPauseCandidates([
          candidate('other-low', { current: false, brandId: 'b2' }),
          candidate('here-high', { demand: 'high' }),
          candidate('other-medium', { current: false, brandId: 'b2', demand: 'medium' }),
          candidate('here-low'),
        ]),
      ),
    ).toEqual(['here-low', 'here-high', 'other-low', 'other-medium']);
  });
});

describe('the spots a swap needs', () => {
  it('is short of what the prompt needs, one spot per location, less those free', () => {
    expect(spotsShort(1, 0)).toBe(1);
    expect(spotsShort(3, 1)).toBe(2);
    expect(spotsShort(2, 5)).toBe(0);
    // No limit: nothing is ever short.
    expect(spotsShort(4, null)).toBe(0);
  });

  it('ticks the fewest candidates, in order, that free enough', () => {
    const list = [
      candidate('a'),
      candidate('b', { locations: 2 }),
      candidate('c'),
      candidate('d', { locations: 3 }),
    ];
    expect(firstPicks(list, 0)).toEqual([]);
    expect(firstPicks(list, 1)).toEqual(['a']);
    expect(firstPicks(list, 3)).toEqual(['a', 'b']);
    expect(firstPicks(list, 4)).toEqual(['a', 'b', 'c']);
    expect(firstPicks(list, 8)).toBeNull();
    expect(spotsFreed(list, new Set(['b', 'd']))).toBe(5);
    expect(spotsFreed(list, new Set())).toBe(0);
  });
});
