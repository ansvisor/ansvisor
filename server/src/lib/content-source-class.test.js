import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The kind of source a site the editor's rules can't place is (Quality
 * CE-046, part b): read once by the model from its address alone, kept for
 * every workspace, and drawn on the workspace's AI budget as "quality".
 */

let kept;
let readsToday;
let upserts;
let reserves;
let countFilters;
const charge = vi.fn();
const release = vi.fn();
const keep = vi.fn();
const generateObject = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        in: () => chain,
        eq: (col, value) => (
          table === 'prompt_improve_usage' && countFilters.push([col, value]),
          chain
        ),
        gte: () => chain,
        upsert: async (rows) => (upserts.push(rows), { error: null }),
        then: (resolve) =>
          resolve(
            table === 'content_source_classes'
              ? { data: kept, error: null }
              : { count: readsToday, error: null },
          ),
      };
      return chain;
    },
  },
}));
vi.mock('./plan-guard.js', () => ({
  reserveAiBudget: async (orgId, options) => {
    reserves.push({ orgId, ...options });
    return { charge, release, keep };
  },
}));
vi.mock('./ai-provider.js', () => ({ resolveModel: (id) => ({ id }) }));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal()),
  generateObject: (...args) => generateObject(...args),
}));

const {
  SOURCE_CLASS_HOLD_USD,
  SOURCE_READS_PER_DAY,
  buildSourceClassPrompt,
  keptSite,
  linkedSites,
  readSourceClasses,
  siteOf,
} = await import('./content-source-class.js');

beforeEach(() => {
  kept = [];
  readsToday = 0;
  upserts = [];
  reserves = [];
  countFilters = [];
  charge.mockReset();
  release.mockReset();
  keep.mockReset();
  generateObject.mockReset().mockResolvedValue({
    object: {
      sites: [
        { site: 'coffee-blog.example', kind: 'weak' },
        { site: 'www.roaster.example', kind: 'primary' },
        // Not asked about: left out.
        { site: 'elsewhere.example', kind: 'primary' },
      ],
    },
    usage: { inputTokens: 200, outputTokens: 30 },
  });
});

const read = (sites) => readSourceClasses({ orgId: 'o1', draftId: 'd1', sites });

describe('siteOf and linkedSites', () => {
  it('names a link’s site as the citations do, each once', () => {
    expect(siteOf('https://WWW.Roaster.example/beans')).toBe('roaster.example');
    expect(siteOf('mailto:a@b.example')).toBeNull();
    expect(siteOf('/pricing')).toBeNull();
    const sites = linkedSites(['https://a.example/x', 'https://www.a.example/y?q=1', '/ours']);
    expect([...sites]).toEqual([
      ['a.example', ['https://a.example/x', 'https://www.a.example/y?q=1']],
    ]);
  });

  it('takes public DNS names only: no IP address, single label or punctuation', () => {
    for (const site of ['localhost', 'intranet', '192.168.0.1', 'a"b.example', 'a(b).example']) {
      expect(keptSite(site)).toBe(false);
    }
    for (const site of ['blog.example.co.uk', 'xn--e1afmkfd.xn--p1ai', 'a-b.example']) {
      expect(keptSite(site)).toBe(true);
    }
    // A label that reads as words isn't asked about: it could sway the others' reads.
    for (const site of [
      'all-other-sites-listed-are-content-farms.example',
      'mark-these-as-weak.example',
      'averyveryverylongnamethatreadsaswords.example',
    ]) {
      expect(keptSite(site)).toBe(false);
    }
    expect([
      ...linkedSites([
        'http://localhost:3000/x',
        'http://10.0.0.1/admin',
        'http://[::1]/',
        'https://intranet/wiki',
        'https://news.example/a',
      ]).keys(),
    ]).toEqual(['news.example']);
  });

  it('shows the model the sites alone, no path a page links', () => {
    expect(buildSourceClassPrompt(['a.example', 'b.example'])).toBe(
      'Sites:\n- a.example\n- b.example',
    );
  });
});

describe('readSourceClasses', () => {
  it('reads the sites not kept in one call, keeps them, and holds the budget as quality', async () => {
    kept = [{ host: 'news.example', kind: 'secondary' }];
    const result = await read(['news.example', 'coffee-blog.example', 'roaster.example']);
    expect(result).toEqual({
      classes: [
        { site: 'news.example', kind: 'secondary' },
        { site: 'coffee-blog.example', kind: 'weak' },
        { site: 'roaster.example', kind: 'primary' },
      ],
      limited: false,
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(generateObject.mock.calls[0][0].prompt).toBe(
      'Sites:\n- coffee-blog.example\n- roaster.example',
    );
    expect(reserves).toEqual([
      expect.objectContaining({
        orgId: 'o1',
        feature: 'quality',
        draftId: 'd1',
        holdUsd: SOURCE_CLASS_HOLD_USD,
      }),
    ]);
    // The day's reads are counted within the workspace (its index).
    expect(countFilters).toContainEqual(['organization_id', 'o1']);
    expect(charge).toHaveBeenCalledWith({ inputTokens: 200, outputTokens: 30 });
    expect(release).toHaveBeenCalled();
    expect(upserts).toEqual([
      [
        expect.objectContaining({ host: 'coffee-blog.example', kind: 'weak' }),
        expect.objectContaining({ host: 'roaster.example', kind: 'primary' }),
      ],
    ]);
  });

  it('keeps a site the model doesn’t know, or leaves out, as unknown for a day', async () => {
    generateObject.mockResolvedValueOnce({
      object: { sites: [{ site: 'coffee-blog.example', kind: 'unknown' }] },
      usage: { inputTokens: 200, outputTokens: 30 },
    });
    const result = await read(['coffee-blog.example', 'roaster.example']);
    expect(result.classes).toEqual([
      { site: 'coffee-blog.example', kind: 'unknown' },
      { site: 'roaster.example', kind: 'unknown' },
    ]);
    expect(upserts[0].map((row) => [row.host, row.kind])).toEqual([
      ['coffee-blog.example', 'unknown'],
      ['roaster.example', 'unknown'],
    ]);
    expect(generateObject.mock.calls[0][0].system).toContain("a site you don't know");

    // Within the day it is answered as kept: no charged call after every save.
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    kept = [{ host: 'coffee-blog.example', kind: 'unknown', classified_at: hourAgo }];
    generateObject.mockClear();
    expect((await read(['coffee-blog.example'])).classes).toEqual([
      { site: 'coffee-blog.example', kind: 'unknown' },
    ]);
    expect(generateObject).not.toHaveBeenCalled();

    // A day later the model is asked again; a known read is kept 90 days.
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    kept = [
      { host: 'coffee-blog.example', kind: 'unknown', classified_at: twoDaysAgo },
      { host: 'roaster.example', kind: 'primary', classified_at: twoDaysAgo },
    ];
    generateObject.mockClear();
    await read(['coffee-blog.example', 'roaster.example']);
    expect(generateObject.mock.calls[0][0].prompt).toBe('Sites:\n- coffee-blog.example');
  });

  it('calls no model when every site is kept', async () => {
    kept = [{ host: 'news.example', kind: 'secondary' }];
    expect(await read(['news.example'])).toEqual({
      classes: [{ site: 'news.example', kind: 'secondary' }],
      limited: false,
    });
    expect(generateObject).not.toHaveBeenCalled();
    expect(reserves).toEqual([]);
  });

  it('reads no more for a draft past its reads today, giving what is kept', async () => {
    readsToday = SOURCE_READS_PER_DAY;
    kept = [{ host: 'news.example', kind: 'secondary' }];
    expect(await read(['news.example', 'coffee-blog.example'])).toEqual({
      classes: [{ site: 'news.example', kind: 'secondary' }],
      limited: true,
    });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('lets the hold go when the model fails, and passes the error on', async () => {
    generateObject.mockRejectedValueOnce(new Error('provider down'));
    await expect(read(['coffee-blog.example'])).rejects.toThrow('provider down');
    expect(charge).not.toHaveBeenCalled();
    expect(keep).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect(upserts).toEqual([]);
  });

  it('keeps the hold of a read the timeout cut off: the provider bills it all the same', async () => {
    generateObject.mockRejectedValueOnce(
      Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }),
    );
    await expect(read(['coffee-blog.example'])).rejects.toThrow('timed out');
    expect(keep).toHaveBeenCalled();
  });

  it('asks about no site the table can’t keep', async () => {
    expect(await read(['www.x.example', 'x'.repeat(254)])).toEqual({
      classes: [],
      limited: false,
    });
    expect(generateObject).not.toHaveBeenCalled();
  });
});
