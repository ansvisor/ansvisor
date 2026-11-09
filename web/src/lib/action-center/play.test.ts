import { describe, expect, it } from 'vitest';
import { PLAY_IDS, actionPlay } from './play';

/** The play the API's chooser keeps on G15, G16 and C09 (AC plan P-2), as the drawer reads it. */

const PLAY = {
  version: 1,
  id: 'comparison',
  assetType: 'comparison',
  siteType: 'ecommerce',
  reasons: [{ kind: 'intent', intents: ['vs-review'], prompts: 6, of: 14, share: 0.52 }],
  supporting: [
    { id: 'guide', assetType: 'guide', prompts: 3, of: 14, share: 0.2 },
    { id: 'alternatives', assetType: 'alternatives', prompts: 2, of: 14, share: 0.16 },
  ],
};

describe('actionPlay', () => {
  it('reads the play, its reasons and the plays next worth doing', () => {
    expect(actionPlay({ play: PLAY })).toEqual({
      id: 'comparison',
      assetType: 'comparison',
      siteType: 'ecommerce',
      reasons: [{ kind: 'intent', prompts: 6, of: 14, share: 0.52 }],
      // A play this build has no words for is left out.
      supporting: [{ id: 'guide', assetType: 'guide', prompts: 3, of: 14, share: 0.2 }],
    });
  });

  it('leaves out what it cannot read', () => {
    expect(actionPlay({})).toBeNull();
    expect(actionPlay(null)).toBeNull();
    expect(actionPlay({ play: { ...PLAY, id: 'pricing' } })).toBeNull();
    expect(actionPlay({ play: { ...PLAY, siteType: 'zoo', reasons: [{ kind: 'x' }] } })).toEqual(
      expect.objectContaining({ siteType: 'b2b', reasons: [] }),
    );
  });

  it("names the server's plays, and a store's category page (AC plan P-7)", () => {
    expect(PLAY_IDS).toEqual([
      'comparison',
      'best_of',
      'guide',
      'definition',
      'category_page',
      'buying_guide',
    ]);
  });

  it('reads a category page play’s reason: the category, its page and its products in stock', () => {
    const play = actionPlay({
      play: {
        ...PLAY,
        id: 'category_page',
        assetType: 'category_page',
        siteType: 'ecommerce',
        reasons: [
          {
            kind: 'category',
            category: ' Coffee ',
            page: 'https://shop.example/c/coffee',
            inStock: 30,
          },
          // Not a whole address: left out.
          { kind: 'category', category: 'Gifts', page: '/c/gifts', inStock: 2 },
          // No page: a buying guide's reason (EC-1).
          { kind: 'category', category: 'Mugs', page: null, inStock: 3 },
        ],
      },
    });
    expect(play).toMatchObject({
      id: 'category_page',
      reasons: [
        {
          kind: 'category',
          category: 'Coffee',
          page: 'https://shop.example/c/coffee',
          inStock: 30,
        },
        { kind: 'category', category: 'Mugs', page: null, inStock: 3 },
      ],
    });
  });

  it('reads a buying guide next to a live category page, the page it links (AC plan P-7)', () => {
    const guide = {
      id: 'buying_guide',
      assetType: 'buying_guide',
      kind: 'category',
      category: ' Coffee > Cold Brew ',
      linkTo: 'https://shop.example/collections/cold-brew',
    };
    const play = actionPlay({
      play: {
        ...PLAY,
        id: 'category_page',
        assetType: 'category_page',
        supporting: [guide, { id: 'best_of', assetType: 'best_of', prompts: 3, of: 5, share: 0.6 }],
      },
    });
    expect(play?.supporting).toEqual([
      {
        kind: 'category',
        id: 'buying_guide',
        assetType: 'buying_guide',
        category: 'Coffee > Cold Brew',
        linkTo: 'https://shop.example/collections/cold-brew',
      },
      { id: 'best_of', assetType: 'best_of', prompts: 3, of: 5, share: 0.6 },
    ]);
    // Not a whole address to link, or no category: left out.
    expect(
      actionPlay({
        play: {
          ...PLAY,
          supporting: [
            { ...guide, linkTo: '/collections/cold-brew' },
            { ...guide, category: ' ' },
          ],
        },
      })?.supporting,
    ).toEqual([]);
  });
});
