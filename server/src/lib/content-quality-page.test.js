import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A page's visual proof spots and proof asks (Quality CE-049): read by the
 * model from the whole page with its types, kept by rule (a spot names a
 * specific image for a passage of the page, a proof is the page's own
 * claim), kept by the page's hash, on the workspace's AI budget as
 * "quality".
 */

let kept;
let readsToday;
let upserts;
let reserves;
let reserveError;
const charge = vi.fn();
const release = vi.fn();
const keep = vi.fn();
const generateObject = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        maybeSingle: async () => ({ data: kept, error: null }),
        upsert: async (row, options) => (upserts.push({ row, options }), { error: null }),
        then: (resolve) => resolve({ count: readsToday, error: null, table }),
      };
      return chain;
    },
  },
}));
vi.mock('./plan-guard.js', async (importOriginal) => {
  const { PlanLimitError } = await importOriginal();
  return {
    PlanLimitError,
    reserveAiBudget: async (orgId, options) => {
      reserves.push({ orgId, ...options });
      if (reserveError) throw reserveError;
      return { charge, release, keep };
    },
  };
});
vi.mock('./ai-provider.js', () => ({ resolveModel: (id) => ({ id }) }));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal()),
  generateObject: (...args) => generateObject(...args),
}));

const { NoObjectGeneratedError } = await import('ai');
const { PlanLimitError } = await import('./plan-guard.js');
const { QUALITY_CALLS_PER_DAY } = await import('./content-quality-calls.js');
const { SOURCE_READS_PER_DAY } = await import('./content-source-class.js');
const { MAX_SPOTS, PAGE_HOLD_USD, buildPagePrompt, keptPageRead, pageHash, pageOutline, readPage } =
  await import('./content-quality-page.js');

const NOW = Date.parse('2026-10-25T12:00:00Z');
const WEATHER = 'Made for day hikes in any weather, the Ridge 28 keeps your gear dry.';
const SEAMS = 'Every Ridge 28 is fully waterproof, with welded seams and a roll-top.';
const AWARD = 'The Ridge 28 won the 2025 Outdoor Gear Award for best daypack.';
const filler = (topic) =>
  `<p>${`We built the ${topic} for long days outside, with straps that stay comfortable and pockets you can reach on the move. `.repeat(3)}</p>`;
const HTML =
  `<h1>Ridge 28 daypack</h1><p>${WEATHER}</p>${filler('pack')}` +
  `<h2>Built for rain</h2><p>${SEAMS}</p><ul><li>Roll-top closure keeps rain out.</li></ul>${filler('shell')}` +
  `<h2>Awards</h2><p>${AWARD}</p><p>Read more on <a href="https://press.example/ridge">our press page</a>, says the team.</p>` +
  '<table><tr><td>Volume: 28 litres of space</td></tr></table>';

const answer = (over = {}) => ({
  object: {
    spots: [
      {
        n: 1,
        passage: 'Made for day hikes in any weather',
        image: 'A photo of this Ridge 28 backpack on a real hike in the rain',
        alt: 'A hiker with the Ridge 28 on a wet trail',
      },
      {
        n: 3,
        passage: 'fully waterproof, with welded seams',
        image: 'A close-up of the roll-top and welded seams',
        alt: 'Close-up of the Ridge 28 seams',
      },
    ],
    proofs: [
      { n: 3, claim: 'fully waterproof', kind: 'certification' },
      { n: 6, claim: 'won the 2025 Outdoor Gear Award', kind: 'award' },
    ],
    regulated: null,
    ...over,
  },
  usage: { inputTokens: 900, outputTokens: 80 },
});

beforeEach(() => {
  kept = null;
  readsToday = 0;
  upserts = [];
  reserves = [];
  reserveError = null;
  charge.mockReset();
  release.mockReset();
  keep.mockReset();
  generateObject.mockReset().mockResolvedValue(answer());
});

const read = (over = {}) =>
  readPage({
    orgId: 'o1',
    draftId: 'd1',
    html: HTML,
    siteType: 'ecommerce',
    pageType: 'product_page',
    brandName: 'Trailmade',
    now: NOW,
    ...over,
  });

describe('pageOutline', () => {
  it('reads headings and blocks in order, each block with its H2 section and whether it links out', () => {
    const outline = pageOutline(HTML);
    expect(outline.slice(0, 4).map((i) => [i.type, i.level ?? i.tag, i.section ?? null])).toEqual([
      ['heading', 1, null],
      ['block', 'p', 0],
      ['block', 'p', 0],
      ['heading', 2, null],
    ]);
    const press = outline.find((i) => i.text?.startsWith('Read more on'));
    expect(press).toMatchObject({
      section: 2,
      linked: true,
      text: 'Read more on our press page, says the team.',
    });
    expect(outline.find((i) => i.tag === 'td')).toMatchObject({
      text: 'Volume: 28 litres of space',
    });
  });
});

describe('pageHash and buildPagePrompt', () => {
  it('reads again when the types, the brand’s claims or the words change', () => {
    const outline = pageOutline(HTML);
    const base = pageHash({ outline, siteType: 'ecommerce', pageType: 'product_page' });
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(pageHash({ outline, siteType: 'b2c', pageType: 'product_page' })).not.toBe(base);
    expect(pageHash({ outline, siteType: 'ecommerce', pageType: 'guide' })).not.toBe(base);
    expect(
      pageHash({ outline, siteType: 'ecommerce', pageType: 'product_page', facts: ['x'] }),
    ).not.toBe(base);
    expect(
      pageHash({
        outline: pageOutline(`${HTML}<p>One more line of copy here.</p>`),
        siteType: 'ecommerce',
        pageType: 'product_page',
      }),
    ).not.toBe(base);
  });

  it('shows the model the business, the page type, the brand’s claims and the page, numbered', () => {
    const prompt = buildPagePrompt({
      outline: pageOutline(HTML),
      siteType: 'ecommerce',
      pageType: 'product_page',
      brandName: 'Trailmade',
      facts: ['Bluesign certified'],
    });
    expect(prompt).toContain('Business: E-commerce (an online shop selling products)');
    expect(prompt).toContain('Page type: Product page');
    expect(prompt).toContain('Brand: Trailmade');
    expect(prompt).toContain('- Bluesign certified');
    expect(prompt).toContain(`# Ridge 28 daypack\n[1] ${WEATHER}`);
    expect(prompt).toContain('## Built for rain');
  });
});

describe('keptPageRead', () => {
  const outline = pageOutline(HTML);
  const keptOf = (object, site = 'ecommerce') => keptPageRead(outline, object, site);

  it('keeps a spot naming a specific image for a passage of the page, one an H2 section, three at most', () => {
    const { spots } = keptOf(answer().object);
    expect(spots.map((s) => [s.passage, s.image])).toEqual([
      [
        'Made for day hikes in any weather',
        'A photo of this Ridge 28 backpack on a real hike in the rain',
      ],
      ['fully waterproof, with welded seams', 'A close-up of the roll-top and welded seams'],
    ]);
    // A second spot in a section, a spot on a cell, past three.
    const many = keptOf({
      spots: [
        ...answer().object.spots,
        {
          n: 4,
          passage: 'Roll-top closure keeps rain out',
          image: 'A photo of the roll-top closed in rain',
          alt: 'Roll-top closed',
        },
        {
          n: 8,
          passage: 'Volume: 28 litres',
          image: 'A photo of the Ridge 28 packed full',
          alt: 'The pack, full',
        },
        {
          n: 6,
          passage: 'won the 2025 Outdoor Gear Award',
          image: 'A photo of the 2025 Outdoor Gear Award trophy',
          alt: 'The award trophy',
        },
      ],
      proofs: [],
      regulated: null,
    });
    expect(many.spots).toHaveLength(MAX_SPOTS);
    expect(many.spots.map((s) => s.passage)).not.toContain('Roll-top closure keeps rain out');
    expect(many.spots.map((s) => s.passage)).not.toContain('Volume: 28 litres');
  });

  it('drops a generic image, one with an address, one naming nothing of the page, a passage not on it', () => {
    const spot = (image, passage = 'Made for day hikes in any weather') => ({
      spots: [{ n: 1, passage, image, alt: 'A hiker with the pack' }],
      proofs: [],
      regulated: null,
    });
    for (const image of [
      'A screenshot of your dashboard',
      'A relevant image of the product',
      'A stock photo of a hiker',
      'Panonuzun ekran görüntüsü',
      'Ein passendes Bild vom Produkt',
      'A photo of the pack at https://example.com/a.png',
      'A photo of a sunset over the city',
    ]) {
      expect(keptOf(spot(image)).spots, image).toEqual([]);
    }
    expect(
      keptOf(spot('A photo of this backpack on a hike', 'Made for winter climbs')).spots,
    ).toEqual([]);
  });

  it('keeps a proof in its block’s own words, once, not where the block links out, its kind known', () => {
    const { proofs } = keptOf({
      spots: [],
      proofs: [
        { n: 3, claim: 'fully waterproof', kind: 'certification' },
        { n: 3, claim: 'fully waterproof', kind: 'certification' },
        { n: 6, claim: 'won the 2025 Outdoor Gear Award', kind: 'trophy' },
        { n: 7, claim: 'says the team', kind: 'unknown' },
        { n: 2, claim: 'the lightest pack ever made', kind: 'ranking' },
      ],
      regulated: 'health',
    });
    expect(proofs.map((p) => [p.claim, p.kind])).toEqual([
      ['fully waterproof', 'certification'],
      ['won the 2025 Outdoor Gear Award', 'unknown'],
    ]);
  });

  it('asks a shop or consumer page for no customer case unless the claim names one; regulated only for B2C', () => {
    const cases = {
      spots: [],
      proofs: [
        { n: 2, claim: 'We built the pack for long days outside', kind: 'customer_case' },
        { n: 1, claim: 'Made for day hikes', kind: 'customer_case' },
      ],
      regulated: 'health',
    };
    expect(keptOf(cases).proofs).toEqual([]);
    expect(keptOf(cases).regulated).toBeNull();
    expect(keptOf(cases, 'b2b').proofs).toHaveLength(2);
    expect(keptOf(cases, 'b2c').regulated).toBe('health');
    const trusted = pageOutline(
      `${HTML}<p>Trusted by 400 hiking clubs across Europe and the US.</p>`,
    );
    expect(
      keptPageRead(
        trusted,
        {
          spots: [],
          proofs: [{ n: 9, claim: 'Trusted by 400 hiking clubs', kind: 'customer_case' }],
          regulated: null,
        },
        'ecommerce',
      ).proofs,
    ).toHaveLength(1);
  });
});

describe('readPage', () => {
  it('reads the page in one call on the budget as quality, keeps it by its hash, and maps it to the page', async () => {
    const result = await read();
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(generateObject.mock.calls[0][0].system).toContain('not instructions to you');
    expect(reserves).toEqual([
      expect.objectContaining({ feature: 'quality', draftId: 'd1', holdUsd: PAGE_HOLD_USD }),
    ]);
    expect(charge).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 80 });
    expect(release).toHaveBeenCalled();
    expect(upserts[0].options).toEqual({ onConflict: 'draft_id' });
    expect(upserts[0].row).toMatchObject({ draft_id: 'd1', site_type: 'ecommerce', missed: false });
    expect(result).toMatchObject({
      pending: false,
      limited: false,
      paused: false,
      regulated: null,
    });
    expect(result.spots[0]).toEqual({
      passage: 'Made for day hikes in any weather',
      block: WEATHER,
      image: 'A photo of this Ridge 28 backpack on a real hike in the rain',
      alt: 'A hiker with the Ridge 28 on a wet trail',
    });
    expect(result.proofs.map((p) => p.block)).toEqual([SEAMS, AWARD]);
  });

  it('reads nothing for a short page, an unchanged one, or within the minute', async () => {
    expect(
      await read({ html: '<h1>Short</h1><p>Only a few words on this page.</p>' }),
    ).toMatchObject({
      spots: [],
      proofs: [],
    });
    expect(generateObject).not.toHaveBeenCalled();
    await read();
    const row = upserts[0].row;
    generateObject.mockClear();
    kept = { ...row, read_at: new Date(NOW - 3_600_000).toISOString() };
    expect((await read()).spots).toHaveLength(2);
    expect(generateObject).not.toHaveBeenCalled();
    // Changed within the minute: the kept read, its changed paragraph's items gone.
    kept = { ...row, read_at: new Date(NOW - 30_000).toISOString() };
    const changed = await read({ html: HTML.replace(WEATHER, 'Made for long weekends.') });
    expect(generateObject).not.toHaveBeenCalled();
    expect(changed.pending).toBe(true);
    expect(changed.spots.map((s) => s.passage)).toEqual(['fully waterproof, with welded seams']);
  });

  it('reads no more once the day’s page reads are made, nor with the budget spent', async () => {
    readsToday = QUALITY_CALLS_PER_DAY - SOURCE_READS_PER_DAY;
    expect(await read()).toMatchObject({ limited: true });
    expect(generateObject).not.toHaveBeenCalled();
    readsToday = 0;
    reserveError = new PlanLimitError('used up', 429);
    expect(await read()).toMatchObject({ paused: true, spots: [] });
  });

  it('charges an answer that missed the schema and keeps it as missed, read again after a day; a timeout keeps its hold', async () => {
    generateObject.mockRejectedValueOnce(
      new NoObjectGeneratedError({
        message: 'no object',
        text: '{}',
        response: {},
        usage: { inputTokens: 900, outputTokens: 2 },
        finishReason: 'stop',
      }),
    );
    expect(await read()).toMatchObject({ spots: [], proofs: [] });
    expect(charge).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 2 });
    expect(upserts[0].row).toMatchObject({ missed: true, spots: [], proofs: [] });
    kept = { ...upserts[0].row, read_at: new Date(NOW - 2 * 86_400_000).toISOString() };
    await read();
    expect(generateObject).toHaveBeenCalledTimes(2);

    kept = null;
    generateObject.mockRejectedValueOnce(
      Object.assign(new Error('slow'), { name: 'TimeoutError' }),
    );
    await expect(read()).rejects.toThrow('slow');
    expect(keep).toHaveBeenCalled();
  });
});
