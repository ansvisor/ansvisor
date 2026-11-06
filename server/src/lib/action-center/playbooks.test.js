import { describe, expect, it } from 'vitest';
import {
  MAX_SUPPORTING,
  MIN_PLAY_SHARE,
  PLAYS,
  PLAY_DEFINITIONS,
  choosePlay,
  intentMix,
  isPlayId,
  rankPlays,
} from './playbooks.js';
import { SITE_PAGE_TYPES } from '../content-page-types.js';

const prompt = (id, intent, volume = 100) => ({ id, intent, volume });

describe('the plays', () => {
  it('runs for G15, G16 and C09', () => {
    expect(PLAY_DEFINITIONS).toEqual([
      'create_content_for_demand',
      'create_content_for_topics',
      'create_content_for_competitor_gaps',
    ]);
  });

  it('writes a page every kind of site has', () => {
    for (const play of PLAYS) {
      for (const types of Object.values(SITE_PAGE_TYPES)) {
        expect(types).toContain(play.assetType);
      }
    }
    expect(isPlayId('comparison')).toBe(true);
    expect(isPlayId('alternatives')).toBe(false);
  });
});

describe('intentMix', () => {
  it("weighs each intent by its prompts' AI searches, one each without a volume", () => {
    const mix = intentMix([
      prompt('a', 'how-to', 300),
      prompt('b', 'how-to', null),
      prompt('c', null, 200),
    ]);
    expect(mix.total).toBe(501);
    expect(mix.byIntent.get('how-to')).toEqual({ prompts: 2, volume: 301 });
    expect(mix).toMatchObject({ prompts: 3, known: 2 });
  });
});

describe('rankPlays', () => {
  it("ranks plays by weight × their share of the prompts' AI searches", () => {
    const ranked = rankPlays([
      prompt('a', 'vs-review', 500),
      prompt('b', 'comparison', 100),
      prompt('c', 'how-to', 300),
      prompt('d', 'best-top', 100),
    ]);
    expect(ranked.map((r) => r.play.id)).toEqual(['comparison', 'guide']);
    expect(ranked[0]).toMatchObject({ share: 0.6, score: 0.6, prompts: 2, of: 4 });
    // best-top is 10%: under MIN_PLAY_SHARE.
    expect(0.1).toBeLessThan(MIN_PLAY_SHARE);
  });

  it('offers a definition only where what-is leads', () => {
    const led = rankPlays([prompt('a', 'what-is', 400), prompt('b', 'how-to', 300)]);
    expect(led.map((r) => r.play.id)).toEqual(['definition', 'guide']);
    const behind = rankPlays([prompt('a', 'what-is', 300), prompt('b', 'how-to', 400)]);
    expect(behind.map((r) => r.play.id)).toEqual(['guide']);
  });

  it('ranks nothing without intents', () => {
    expect(rankPlays([prompt('a', null), prompt('b', null)])).toEqual([]);
    expect(rankPlays([])).toEqual([]);
  });
});

describe('choosePlay', () => {
  it('keeps the pick, its measured reason and the next ones worth doing', () => {
    const play = choosePlay({
      siteType: 'ecommerce',
      prompts: [
        prompt('a', 'best-top', 400),
        prompt('b', 'best-top', 200),
        prompt('c', 'comparison', 250),
        prompt('d', 'how-to', 150),
      ],
    });
    expect(play).toEqual({
      version: 1,
      id: 'best_of',
      assetType: 'best_of',
      siteType: 'ecommerce',
      reasons: [{ kind: 'intent', intents: ['best-top'], prompts: 2, of: 4, share: 0.6 }],
      supporting: [
        { id: 'comparison', assetType: 'comparison', prompts: 1, of: 4, share: 0.25 },
        { id: 'guide', assetType: 'guide', prompts: 1, of: 4, share: 0.15 },
      ],
    });
    expect(play.supporting.length).toBeLessThanOrEqual(MAX_SUPPORTING);
  });

  it('proposes nothing the data does not support', () => {
    expect(choosePlay({ siteType: 'b2b', prompts: [prompt('a', 'recommendation')] })).toBeNull();
    expect(choosePlay({ siteType: 'b2b', prompts: [] })).toBeNull();
  });
});
