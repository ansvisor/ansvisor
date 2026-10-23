import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import {
  EEAT_WEIGHTS,
  MAX_LINK_CHECKS,
  TRUST_PHASE1_POINTS,
  TRUST_WEIGHTS,
  authorProfile,
  eeat,
  linksToCheck,
  scoreGain,
  trust,
  trustBlocks,
  trustGain,
  type LinkCheck,
} from './quality-checks';

const author = (over: Partial<ContentAuthor> = {}): ContentAuthor => ({
  id: 'a1',
  name: 'Ada Lovelace',
  title: 'Head of Content',
  bio: 'Writes about forecasting.',
  photoUrl: null,
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
  ...over,
});

describe('eeat (Phase 1: the author)', () => {
  it('gives a real author with a bio and profile links every live point', () => {
    const result = eeat({ author: author() });
    expect(result.score).toBe(100);
    // Schema waits for Before you publish's JSON-LD, dates for the live page.
    expect(result.checks).toEqual([
      { id: 'byline', points: EEAT_WEIGHTS.byline, max: EEAT_WEIGHTS.byline },
      { id: 'authorBio', points: EEAT_WEIGHTS.authorBio, max: EEAT_WEIGHTS.authorBio },
    ]);
  });

  it('gives the organization byline none: it is no person', () => {
    const result = eeat({ author: null });
    expect(result.score).toBe(0);
    expect(scoreGain(result, ['byline'])).toBe(60);
  });

  it('gives half the profile points for a bio or links alone', () => {
    // byline 15 + bio 5 of 25.
    expect(eeat({ author: author({ sameAs: [] }) }).score).toBe(80);
    const bare = eeat({ author: author({ bio: '  ', sameAs: [] }) });
    expect(bare.score).toBe(60);
    expect(scoreGain(bare, ['authorBio'])).toBe(40);
    expect(authorProfile(author({ bio: '  ' }))).toEqual({ bio: false, links: true });
  });
});

describe('trust (Phase 1: figures and links)', () => {
  const NOW = Date.parse('2026-10-23T12:00:00Z');
  const blocks = (html: string) => trustBlocks(html);
  const read = (rows: Partial<LinkCheck>[]) =>
    new Map(
      rows.map((r) => [r.href!, { status: 'ok', httpStatus: 200, date: null, ...r } as LinkCheck]),
    );
  const run = (html: string, links = new Map<string, LinkCheck>()) =>
    trust({ blocks: blocks(html), links, brandDomains: ['acme.com'], now: NOW });

  it("isn't scored while the page has no figure, dated source or link read", () => {
    const result = run('<h1>Pipeline</h1><p>Teams forecast 5 steps ahead in 2026.</p>');
    expect(result.score).toBeNull();
    expect(result.figures).toBe(0);
  });

  it('counts a figure as sourced when its paragraph links another site', () => {
    const result = run(
      '<p>Win rates rose 42% last year (<a href="https://research.example/report">report</a>).</p>' +
        '<p>Deals close $2.5 million faster.</p>' +
        '<p>Our own page says 3x <a href="https://www.acme.com/pricing">pricing</a>.</p>' +
        '<ul><li>%40 daha hızlı</li></ul>',
    );
    // Our own site is no source: three of four figures have none.
    expect(result.figures).toBe(4);
    expect(result.unsourced).toEqual([
      'Deals close $2.5 million faster.',
      'Our own page says 3x pricing.',
      '%40 daha hızlı',
    ]);
    expect(result.checks).toEqual([
      { id: 'claimsSourced', points: TRUST_WEIGHTS.claimsSourced / 4, max: 30 },
    ]);
    expect(result.score).toBe(25);
  });

  it('reads sources older than 24 months as stale, and leaves undated ones out', () => {
    const result = run(
      '<p>See <a href="https://old.example/a">old</a>, <a href="https://new.example/b">new</a> and <a href="https://undated.example/">undated</a>.</p>',
      read([
        { href: 'https://old.example/a', date: '2024-09-01T00:00:00.000Z' },
        { href: 'https://new.example/b', date: '2025-01-01T00:00:00.000Z' },
        { href: 'https://undated.example/' },
      ]),
    );
    expect(result.dated).toBe(2);
    expect(result.stale.map((l) => l.url)).toEqual(['https://old.example/a']);
    expect(result.checks.find((c) => c.id === 'freshSources')).toEqual({
      id: 'freshSources',
      points: 3.5,
      max: 7,
    });
  });

  it("counts the links that answer, and leaves out the ones that wouldn't tell", () => {
    const result = run(
      '<p><a href="https://gone.example/">gone</a> <a href="https://www.acme.com/x">ours</a> <a href="https://walled.example/">walled</a></p>',
      read([
        { href: 'https://gone.example/', status: 'broken', httpStatus: 404 },
        { href: 'https://www.acme.com/x' },
        { href: 'https://walled.example/', status: 'unknown', httpStatus: 403 },
      ]),
    );
    expect(result.broken.map((l) => l.url)).toEqual(['https://gone.example/']);
    expect(result.checks).toEqual([{ id: 'noBrokenLinks', points: 1.5, max: 3 }]);
    // Links alone don't score Trust; the dead one is worth 1.5 of the 40 Phase 1 points.
    expect(result.score).toBeNull();
    expect(TRUST_PHASE1_POINTS).toBe(40);
    expect(trustGain(result, ['noBrokenLinks'])).toBe(4);
  });

  it('scores Trust only once a figure or a dated source is there', () => {
    const dead = read([{ href: 'https://gone.example/', status: 'broken', httpStatus: 404 }]);
    const working = read([{ href: 'https://gone.example/' }]);
    const linkOnly = '<p>See <a href="https://gone.example/">this</a>.</p>';
    // One link would otherwise set the whole score: 0 dead, 100 working.
    expect(run(linkOnly, dead).score).toBeNull();
    expect(run(linkOnly, working).score).toBeNull();
    expect(trustGain(run(linkOnly, dead), ['noBrokenLinks'])).toBe(8);
    expect(trustGain(run(linkOnly, working), ['noBrokenLinks'])).toBe(0);

    // With a figure the links count among Trust's live checks: 30 + 0 of 33.
    const withFigure = run(
      '<p>Win rates rose 42% (<a href="https://gone.example/">this</a>).</p>',
      dead,
    );
    expect(withFigure.score).toBe(91);
    expect(trustGain(withFigure, ['noBrokenLinks'])).toBe(scoreGain(withFigure, ['noBrokenLinks']));
    // A dated source alone is enough too.
    const dated = read([{ href: 'https://gone.example/', date: '2026-01-01T00:00:00.000Z' }]);
    expect(run(linkOnly, dated).score).toBe(100);
  });

  it(`asks for each http(s) link once, ${MAX_LINK_CHECKS} at most`, () => {
    const many = Array.from({ length: 25 }, (_, i) => `<a href="https://s${i}.example/">s</a>`);
    const html = `<p><a href="/pricing">p</a> <a href="https://a.example/">a</a> <a href="https://a.example/">a</a></p><p>${many.join(' ')}</p>`;
    const urls = linksToCheck(blocks(html));
    expect(urls[0]).toBe('https://a.example/');
    expect(urls).toHaveLength(MAX_LINK_CHECKS);
  });

  it('reads only figures as claims: not prices, sizes, years or ranks', () => {
    const claims = [
      'Teams grew 10k accounts.',
      'Revenue hit 2M last year.',
      'It loads 3 times faster.',
      'Rates rose 12 percent.',
      'Costs fell by €4.5 million.',
      '100% of our customers renewed.',
      'Get 50% off and 20% more reach.',
    ];
    const plain = [
      'Plans start at $29/month.',
      'A 10 x 20 cm box.',
      'Room 3X is upstairs.',
      'Support is open 24/7.',
      'We ranked #1 in 2026.',
      'Save 20% on your first order.',
      'Get 50% off all shoes.',
      'A 0% APR loan.',
      'Made from 100% organic cotton.',
      'Our 100% money-back guarantee covers every plan.',
      'Watch it in 4K on any TV.',
      'Roll it into your 401k.',
      'Plans from $1.2k/month.',
    ];
    const result = run(`<p>${[...claims, ...plain].join(' ')}</p>`);
    expect(result.unsourced).toEqual(claims);
  });

  it('counts a link and a sentence once, as the draft saves the link', () => {
    const html =
      '<p>Read <a href="https://WWW.Gone.example?utm_source=mail">this</a>.</p>' +
      '<p>And <a href="https://www.gone.example/">this again</a>.</p>' +
      '<ul><li>Up 40% now.<ul><li>Up 40% now.</li></ul></li></ul>';
    expect(linksToCheck(blocks(html))).toEqual(['https://www.gone.example/']);
    const result = run(
      html,
      read([{ href: 'https://www.gone.example/', status: 'broken', httpStatus: 404 }]),
    );
    expect(result.broken).toHaveLength(1);
    expect(result.figures).toBe(1);
  });
});
