import { describe, expect, it, vi } from 'vitest';

// The real client needs the service key; each test passes its own.
vi.mock('../config/supabase.js', () => ({ default: {} }));

const {
  RECHECK_MS,
  SITE_TRUST_TTL_MS,
  authorPage,
  computeSiteTrust,
  findPage,
  hasOrganization,
  nameSlug,
  readSiteTrust,
} = await import('./site-trust.js');

/**
 * Site trust (Quality spec §8, CE-043): About, Contact, an editorial policy,
 * Organization schema on the home page, and a page for each author, read
 * from the brand's own site.
 */

const NOW = Date.parse('2026-10-23T12:00:00Z');
const page = (url, title = null) => ({ url, title });

/** The tables computeSiteTrust and readSiteTrust read, and the writes. */
function fakeDb(tables) {
  const writes = [];
  const db = {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        single: async () => ({ data: tables[table], error: null }),
        maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
        then: (resolve) => resolve({ data: tables[table] ?? [], error: null }),
        upsert: async (row) => {
          writes.push({ table, row });
          return { error: null };
        },
      };
      return chain;
    },
  };
  return { db, writes };
}

describe('findPage', () => {
  const pages = [
    page('https://acme.com/blog/about-our-pricing', 'About our pricing changes'),
    page('https://acme.com/company/', 'Our company'),
    page('https://acme.com/help', 'Contact us · Acme'),
    page('https://acme.com/tr/hakkimizda'),
  ];

  it('finds a page by a whole part of its address, or a title that starts so', () => {
    expect(findPage(pages, 'about')).toBe('https://acme.com/company/');
    expect(findPage(pages, 'contact')).toBe('https://acme.com/help');
    expect(findPage([page('https://acme.com/how-we-review')], 'editorial')).toBe(
      'https://acme.com/how-we-review',
    );
  });

  it('finds none in a blog post that only mentions the word', () => {
    expect(findPage([pages[0]], 'about')).toBeNull();
    expect(findPage(pages, 'editorial')).toBeNull();
  });
});

describe('hasOrganization', () => {
  it('reads Organization, or a kind of it, from the JSON-LD', () => {
    expect(
      hasOrganization(
        '<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Organization","name":"Acme"}]}</script>',
      ),
    ).toBe(true);
    expect(
      hasOrganization('<script type="application/ld+json">{"@type":"LocalBusiness"}</script>'),
    ).toBe(true);
    expect(hasOrganization('<script type="application/ld+json">{"@type":"WebSite"}</script>')).toBe(
      false,
    );
  });
});

describe('authorPage', () => {
  const onSite = (link) => link.startsWith('https://acme.com/');
  it("finds an author's page by their name in its address or title, or a profile on the site", () => {
    const pages = [
      page('https://acme.com/authors/ada-lovelace'),
      page('https://acme.com/team', 'Bob Stone'),
    ];
    expect(authorPage(pages, { name: 'Ada Lovelace', same_as: [] }, onSite)).toBe(
      'https://acme.com/authors/ada-lovelace',
    );
    expect(authorPage(pages, { name: 'Bob Stone', same_as: [] }, onSite)).toBe(
      'https://acme.com/team',
    );
    expect(
      authorPage(
        [],
        { name: 'Cal', same_as: ['https://x.com/cal', 'https://acme.com/cal'] },
        onSite,
      ),
    ).toBe('https://acme.com/cal');
    expect(authorPage([], { name: 'Dee', same_as: ['https://x.com/dee'] }, onSite)).toBeNull();
  });

  it('names an author as an address would', () => {
    expect(nameSlug('Çağrı Işık')).toBe('cagri-isik');
    expect(nameSlug('José  García')).toBe('jose-garcia');
  });
});

describe('computeSiteTrust', () => {
  const tables = {
    brands: { organization_id: 'o1' },
    brand_domains: [
      { domain: 'https://www.acme.com/', is_primary: true },
      { domain: 'acme.de', is_primary: false },
    ],
    site_pages: [
      page('https://acme.com/about-us', 'About us'),
      page('https://acme.com/authors/ada-lovelace'),
    ],
    content_authors: [
      { name: 'Ada Lovelace', same_as: [] },
      { name: 'Bob Stone', same_as: [] },
    ],
  };

  it('reads the list, tries the usual addresses, and the home page', async () => {
    const { db } = fakeDb(tables);
    const fetcher = vi.fn(async (url) => {
      if (url === 'https://acme.com/')
        return {
          url,
          html: '<script type="application/ld+json">{"@type":"Organization"}</script>',
        };
      if (url === 'https://acme.com/contact') return { url, html: '<title>Contact · Acme</title>' };
      // A site that answers every address with its home page: no editorial policy there.
      return { url, html: '<title>Acme — coffee for teams</title>' };
    });
    const { checks, score } = await computeSiteTrust('b1', { db, fetcher });
    expect(checks.about).toEqual({ ok: true, url: 'https://acme.com/about-us' });
    expect(checks.contact).toEqual({ ok: true, url: 'https://acme.com/contact' });
    expect(checks.editorial).toEqual({ ok: false, url: null });
    expect(checks.organizationSchema).toEqual({ ok: true, url: 'https://acme.com/' });
    expect(checks.authorPages).toEqual({
      ok: false,
      authors: [
        { name: 'Ada Lovelace', url: 'https://acme.com/authors/ada-lovelace' },
        { name: 'Bob Stone', url: null },
      ],
    });
    expect(score).toBe(3);
    // Only the brand's own site is read.
    expect(fetcher.mock.calls.every(([url]) => url.startsWith('https://acme.com/'))).toBe(true);
  });

  it("doesn't take a redirect to the home page for the page, nor pass without authors", async () => {
    const { db } = fakeDb({ ...tables, site_pages: [], content_authors: [] });
    const fetcher = vi.fn(async () => ({
      url: 'https://acme.com/',
      html: '<title>About Acme</title>',
    }));
    const { checks, score } = await computeSiteTrust('b1', { db, fetcher });
    expect(checks.about.ok).toBe(false);
    expect(checks.authorPages).toEqual({ ok: false, authors: [] });
    expect(score).toBe(0);
  });
});

describe('readSiteTrust', () => {
  const kept = (age) => ({
    checks: { about: { ok: true, url: 'https://acme.com/about' } },
    score: 1,
    checked_at: new Date(NOW - age).toISOString(),
  });
  const base = {
    brands: { organization_id: 'o1' },
    brand_domains: [],
    site_pages: [],
    content_authors: [],
  };

  it('keeps a read for a day, and reads again when asked, but not within minutes', async () => {
    let { db, writes } = fakeDb({ ...base, site_trust: kept(60_000) });
    const fetcher = vi.fn();
    expect((await readSiteTrust('b1', { db, fetcher, now: NOW })).score).toBe(1);
    expect((await readSiteTrust('b1', { db, fetcher, now: NOW, refresh: true })).score).toBe(1);
    expect(writes).toEqual([]);

    ({ db, writes } = fakeDb({ ...base, site_trust: kept(RECHECK_MS + 60_000) }));
    expect((await readSiteTrust('b1', { db, fetcher, now: NOW, refresh: true })).score).toBe(0);
    expect(writes).toHaveLength(1);

    ({ db, writes } = fakeDb({ ...base, site_trust: kept(SITE_TRUST_TTL_MS + 60_000) }));
    const fresh = await readSiteTrust('b1', { db, fetcher, now: NOW });
    expect(fresh.checkedAt).toBe(new Date(NOW).toISOString());
    expect(writes[0]).toMatchObject({ table: 'site_trust', row: { brand_id: 'b1', score: 0 } });
  });
});
