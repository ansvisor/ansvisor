import { describe, expect, it, vi } from 'vitest';

// The real client needs the service key; each test passes its own.
vi.mock('../config/supabase.js', () => ({ default: {} }));

const { PageFetchError } = await import('./safe-fetch.js');
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
const page = (url, title = null, fetch_status = 200) => ({ url, title, fetch_status });
const html = (title, h1 = '', extra = '') => `<title>${title}</title><h1>${h1}</h1>${extra}`;
const ORG = '<script type="application/ld+json">{"@type":"Organization"}</script>';

/** The tables computeSiteTrust and readSiteTrust read, and the writes. */
function fakeDb(tables) {
  const writes = [];
  const db = {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
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
    page('https://acme.com/company/news/launch', 'We launched'),
    page('https://acme.com/company/', 'Our company'),
    page('https://acme.com/help', 'Contact us · Acme'),
  ];

  it("finds a page by its address's last part, or a title that is just that", () => {
    expect(findPage(pages, 'about')).toBe('https://acme.com/company/');
    expect(findPage(pages, 'contact')).toBe('https://acme.com/help');
    expect(findPage([page('https://acme.com/how-we-review')], 'editorial')).toBe(
      'https://acme.com/how-we-review',
    );
    expect(findPage([page('https://acme.com/p/12', 'Editorial policy | Acme')], 'editorial')).toBe(
      'https://acme.com/p/12',
    );
  });

  it('finds none in posts that only mention the word', () => {
    expect(findPage(pages.slice(0, 2), 'about')).toBeNull();
    expect(
      findPage([page('https://acme.com/blog/x', 'How to write an editorial policy')], 'editorial'),
    ).toBeNull();
  });
});

describe('hasOrganization', () => {
  const ld = (type) =>
    `<script type="application/ld+json">${JSON.stringify({ '@type': type })}</script>`;
  it('reads Organization, a kind of it, or one with its vocabulary', () => {
    expect(hasOrganization(ld('Organization'))).toBe(true);
    expect(hasOrganization(ld('Restaurant'))).toBe(true);
    expect(hasOrganization(ld('LocalBusiness'))).toBe(true);
    expect(hasOrganization(ld('https://schema.org/Organization'))).toBe(true);
    expect(hasOrganization(ld('WebSite'))).toBe(false);
  });
});

describe('authorPage', () => {
  const onSite = (link) => link.startsWith('https://acme.com/');
  const author = (name, same_as = []) => ({ name, same_as });

  it('finds the page in an author folder named for them, or titled just their name', () => {
    const pages = [
      page('https://acme.com/authors/ada-lovelace'),
      page('https://acme.com/blog/ada-lovelace'),
      page('https://acme.com/x', 'Bob Stone · Acme'),
    ];
    expect(authorPage(pages, author('Ada Lovelace'), onSite)).toBe(
      'https://acme.com/authors/ada-lovelace',
    );
    expect(authorPage(pages, author('Bob Stone'), onSite)).toBe('https://acme.com/x');
  });

  it("doesn't take a post about them, or a name inside another word", () => {
    const pages = [
      page('https://acme.com/blog/ada-lovelace', "Ada Lovelace's legacy"),
      page('https://acme.com/guides/california', 'California guide'),
    ];
    expect(authorPage(pages, author('Ada Lovelace'), onSite)).toBeNull();
    expect(authorPage(pages, author('Cal'), onSite)).toBeNull();
  });

  it('takes a profile link of theirs on the brand’s site', () => {
    expect(
      authorPage([], author('Cal', ['https://x.com/cal', 'https://acme.com/cal']), onSite),
    ).toBe('https://acme.com/cal');
    expect(authorPage([], author('Dee', ['https://x.com/dee']), onSite)).toBeNull();
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
      page('https://acme.com/contact', 'Contact', 404),
    ],
    content_authors: [
      { id: 'a1', name: 'Ada Lovelace', same_as: [] },
      { id: 'a2', name: 'Bob Stone', same_as: [] },
      { id: 'a3', name: 'Other Brand Writer', same_as: [] },
    ],
    content_drafts: [{ author_id: 'a1' }],
    content_author_defaults: [{ author_id: 'a2' }],
  };
  const HOME = html('Acme — coffee for teams', 'Coffee for teams', ORG);

  it('reads the list, tries the usual addresses, and the home page', async () => {
    const { db } = fakeDb(tables);
    const fetcher = vi.fn(async (url) => {
      if (url === 'https://acme.com/') return { url, html: HOME };
      if (url === 'https://acme.com/contact') return { url, html: html('Contact – Acme') };
      // A site that answers every address with its home page: no editorial policy there.
      return { url, html: HOME };
    });
    const { checks, score, complete } = await computeSiteTrust('b1', { db, fetcher });
    expect(checks.about).toEqual({ ok: true, url: 'https://acme.com/about-us' });
    // The listed /contact answered 404, so the site was asked.
    expect(checks.contact).toEqual({ ok: true, url: 'https://acme.com/contact' });
    expect(checks.editorial).toEqual({ ok: false, url: null });
    expect(checks.organizationSchema).toEqual({ ok: true, url: 'https://acme.com/' });
    // The brand's authors: the one its pages are by and its default.
    expect(checks.authorPages).toEqual({
      ok: false,
      authors: [
        { name: 'Ada Lovelace', url: 'https://acme.com/authors/ada-lovelace' },
        { name: 'Bob Stone', url: null },
      ],
    });
    expect(score).toBe(3);
    expect(complete).toBe(true);
    expect(fetcher.mock.calls.every(([url]) => url.startsWith('https://acme.com/'))).toBe(true);
  });

  it('takes neither a redirect off the site nor one to the home page, nor passes without authors', async () => {
    const { db } = fakeDb({
      ...tables,
      site_pages: [],
      content_authors: [],
      content_drafts: [],
      content_author_defaults: [],
    });
    const fetcher = vi.fn(async (url) => {
      if (url === 'https://acme.com/about')
        return { url: 'https://other.example/about', html: html('About us') };
      if (url === 'https://acme.com/about-us')
        return { url: 'https://acme.com/', html: html('About Acme') };
      return { url, html: html('Acme') };
    });
    const { checks, score } = await computeSiteTrust('b1', { db, fetcher });
    expect(checks.about.ok).toBe(false);
    expect(checks.authorPages).toEqual({ ok: false, authors: [] });
    expect(score).toBe(0);
  });

  it("marks a read the site didn't answer all of", async () => {
    const { db } = fakeDb(tables);
    const fetcher = vi.fn(async (url) => {
      if (url === 'https://acme.com/') throw new PageFetchError('timeout', 'slow');
      throw new PageFetchError('http_error', '404', { status: 404 });
    });
    const { checks, complete } = await computeSiteTrust('b1', { db, fetcher });
    expect(checks.organizationSchema.ok).toBe(false);
    expect(complete).toBe(false);
  });
});

describe('readSiteTrust', () => {
  const kept = (age, complete = true) => ({
    checks: { about: { ok: true, url: 'https://acme.com/about' } },
    score: 1,
    complete,
    checked_at: new Date(NOW - age).toISOString(),
  });
  const base = {
    brands: { organization_id: 'o1' },
    brand_domains: [],
    site_pages: [],
    content_authors: [],
    content_drafts: [],
    content_author_defaults: [],
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
    expect(writes[0]).toMatchObject({
      table: 'site_trust',
      row: { brand_id: 'b1', score: 0, complete: true },
    });
  });

  it('reads a partial read again after a few minutes', async () => {
    const { db, writes } = fakeDb({ ...base, site_trust: kept(RECHECK_MS + 60_000, false) });
    await readSiteTrust('b1', { db, fetcher: vi.fn(), now: NOW });
    expect(writes).toHaveLength(1);
  });

  it('reads once for two asks at the same time', async () => {
    const { db, writes } = fakeDb(base);
    const [a, b] = await Promise.all([
      readSiteTrust('b-twice', { db, fetcher: vi.fn(), now: NOW }),
      readSiteTrust('b-twice', { db, fetcher: vi.fn(), now: NOW }),
    ]);
    expect(writes).toHaveLength(1);
    expect(a).toEqual(b);
  });
});
