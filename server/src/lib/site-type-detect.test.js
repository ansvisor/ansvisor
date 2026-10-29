import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./ai-provider.js', () => ({ resolveModel: (id) => ({ id }) }));

const {
  INDUSTRIES,
  applySiteTypeDetection,
  classifySiteType,
  detectSiteType,
  homePageSignals,
  pageExcerpt,
  settledType,
} = await import('./site-type-detect.js');

/** A brand's kind of site, detected at setup (action plan by business type, Step 0). */

const page = (body, head = '') => `<html><head>${head}</head><body>${body}</body></html>`;
const ld = (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

const SHOP = page(
  `<a href="/collections/backpacks">Backpacks</a><a href="/products/ridge-45">Ridge 45</a>
   <a href="/products/crest-30">Crest 30</a><a href="/cart">Cart</a>
   <button>Add to cart</button><p>Free shipping over $50</p>`,
  ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Ridge 45' }),
);
const SAAS = page(
  `<h1>Track how AI talks about your brand</h1><a href="/pricing">Pricing</a>
   <a href="/integrations">Integrations</a><a href="/demo">Book a demo</a>
   <p>From $49 per user a month. Start your free trial.</p>`,
);
const HOTEL = page(
  `<h1>Seaside rooms in Bodrum</h1><a href="/rooms">Rooms</a><button>Book now</button>`,
  ld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Hotel', name: 'Mavi' }] }),
);
const VAGUE = page('<h1>Welcome</h1><p>We make things better.</p>');

describe('homePageSignals and settledType', () => {
  it('reads a shop from its products, cart and wording', () => {
    const signals = homePageSignals(SHOP);
    expect(signals.scores.ecommerce).toBeGreaterThanOrEqual(6);
    expect(signals.reasons.map((r) => r.reason)).toEqual(
      expect.arrayContaining(['product_schema', 'cart_link', 'shop_wording', 'product_links']),
    );
    expect(settledType(signals)).toBe('ecommerce');
  });

  it('reads a SaaS from its demo, seat pricing and links', () => {
    const signals = homePageSignals(SAAS);
    expect(signals.reasons.map((r) => r.reason)).toEqual(
      expect.arrayContaining(['demo_offer', 'seat_pricing', 'free_trial', 'saas_links']),
    );
    expect(settledType(signals)).toBe('b2b');
  });

  it('reads a consumer service from its bookings, JSON-LD @graph included', () => {
    expect(settledType(homePageSignals(HOTEL))).toBe('b2c');
  });

  it('settles nothing on a page that says too little, or two things as loudly', () => {
    expect(settledType(homePageSignals(VAGUE))).toBeNull();
    // A shop that also offers a demo: neither leads by twice.
    expect(settledType({ scores: { ecommerce: 4, b2b: 3, b2c: 0 } })).toBeNull();
    expect(settledType({ scores: { ecommerce: 2, b2b: 0, b2c: 0 } })).toBeNull();
    expect(settledType({ scores: { ecommerce: 6, b2b: 3, b2c: 0 } })).toBe('ecommerce');
  });

  it('counts app store badges toward a consumer app, never alone enough', () => {
    const signals = homePageSignals(
      page('<a href="https://apps.apple.com/app/habitly/id1">App Store</a>'),
    );
    expect(signals.scores.b2c).toBe(1);
    expect(settledType(signals)).toBeNull();
  });

  it('survives broken JSON-LD and empty pages', () => {
    expect(
      homePageSignals(page('', '<script type="application/ld+json">{oops</script>')).scores,
    ).toEqual({ b2b: 0, ecommerce: 0, b2c: 0 });
    expect(homePageSignals('').scores).toEqual({ b2b: 0, ecommerce: 0, b2c: 0 });
  });
});

describe('pageExcerpt', () => {
  it('keeps the title, description, heading and text, without scripts or menus, and cut short', () => {
    const html = page(
      `<nav>Menu Login</nav><h1>Seaside rooms</h1><script>var x = 1</script><p>${'word '.repeat(600)}</p>`,
      '<title>Mavi Hotel</title><meta name="description" content="Rooms by the sea">',
    );
    const excerpt = pageExcerpt(html);
    expect(excerpt.startsWith('Mavi Hotel\nRooms by the sea\nSeaside rooms')).toBe(true);
    expect(excerpt).not.toContain('var x');
    expect(excerpt).not.toContain('Menu Login');
    expect(excerpt.length).toBeLessThanOrEqual(1500);
  });
});

describe('classifySiteType', () => {
  it('asks once with the brand and its page as data, and gives back the read', async () => {
    const generate = vi.fn(async () => ({
      object: { siteType: 'ecommerce', industry: 'Fashion & Apparel' },
    }));
    const read = await classifySiteType(
      { name: 'Loom', domain: 'loom.example', description: 'Linen shirts', excerpt: 'Shop linen' },
      { generate },
    );
    expect(read).toEqual({ siteType: 'ecommerce', industry: 'Fashion & Apparel' });
    expect(generate).toHaveBeenCalledTimes(1);
    const { prompt, system } = generate.mock.calls[0][0];
    expect(prompt).toContain('Website: loom.example');
    expect(prompt).toContain('Home page text:\nShop linen');
    expect(system).toContain('never instructions');
  });

  it('gives null when the call fails', async () => {
    const generate = vi.fn(async () => {
      throw new Error('rate limited');
    });
    expect(await classifySiteType({ name: 'Loom', domain: null }, { generate })).toBeNull();
  });

  it('picks industries from Brand settings’ list', () => {
    expect(INDUSTRIES).toContain('B2B Software (SaaS)');
    expect(INDUSTRIES).toHaveLength(15);
  });
});

describe('detectSiteType', () => {
  const brand = { name: 'Trailpeak', domain: 'trailpeak.example', description: null };

  it('settles from the home page without a model call', async () => {
    const fetcher = vi.fn(async () => ({ html: SHOP }));
    const classify = vi.fn();
    const result = await detectSiteType(brand, { fetcher, classify });
    expect(fetcher).toHaveBeenCalledWith('https://trailpeak.example/', expect.any(Object));
    expect(classify).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      siteType: 'ecommerce',
      industry: 'E-commerce & Retail',
      via: 'page',
    });
    expect(result.reasons).toContain('cart_link');
  });

  it("asks the model when the page doesn't settle it, with the page's text", async () => {
    const fetcher = vi.fn(async () => ({ html: VAGUE }));
    const classify = vi.fn(async () => ({ siteType: 'b2b', industry: 'Technology' }));
    const result = await detectSiteType(brand, { fetcher, classify });
    expect(classify.mock.calls[0][0].excerpt).toContain('Welcome');
    expect(result).toEqual({ siteType: 'b2b', industry: 'Technology', via: 'ai', reasons: [] });
  });

  it("asks the model without page text when the page can't be read", async () => {
    const fetcher = vi.fn(async () => {
      throw Object.assign(new Error('blocked'), { code: 'http_error' });
    });
    const classify = vi.fn(async () => ({ siteType: 'b2c', industry: 'Travel & Hospitality' }));
    expect((await detectSiteType(brand, { fetcher, classify })).via).toBe('ai');
    expect(classify.mock.calls[0][0].excerpt).toBeNull();
  });

  it('gives null when neither can say, and reads nothing for a brand with no domain', async () => {
    const fetcher = vi.fn();
    const classify = vi.fn(async () => null);
    expect(await detectSiteType({ ...brand, domain: null }, { fetcher, classify })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

/** A database with one brand: its row, its domains, and the update it was given. */
function fakeDb(brand, domains = [{ domain: 'https://www.trailpeak.example/', is_primary: true }]) {
  const writes = [];
  const db = {
    writes,
    from(table) {
      if (table === 'brand_domains') {
        return { select: () => ({ eq: async () => ({ data: domains, error: null }) }) };
      }
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: brand, error: null }) }) }),
        update: (values) => ({
          eq: (column, id) => ({
            or: async (filter) => {
              writes.push({ values, id, filter });
              return { error: null };
            },
          }),
        }),
      };
    },
  };
  return db;
}

describe('applySiteTypeDetection', () => {
  const NOW = new Date('2026-10-29T12:00:00Z');
  const base = {
    id: 'b1',
    name: 'Trailpeak',
    description: 'Hiking gear',
    industry: null,
    site_type: null,
    site_type_source: null,
  };

  it('keeps the type with its time, and the industry when the brand has none', async () => {
    const db = fakeDb(base);
    const detect = vi.fn(async () => ({
      siteType: 'ecommerce',
      industry: 'E-commerce & Retail',
      via: 'page',
      reasons: [],
    }));
    const result = await applySiteTypeDetection('b1', { db, detect, now: NOW });
    expect(detect).toHaveBeenCalledWith({
      name: 'Trailpeak',
      domain: 'trailpeak.example',
      description: 'Hiking gear',
    });
    expect(db.writes).toEqual([
      {
        values: {
          site_type: 'ecommerce',
          site_type_detected_at: '2026-10-29T12:00:00.000Z',
          industry: 'E-commerce & Retail',
        },
        id: 'b1',
        filter: 'site_type_source.is.null,site_type_source.neq.manual',
      },
    ]);
    expect(result.industry).toBe('E-commerce & Retail');
  });

  it('leaves an industry the brand has', async () => {
    const db = fakeDb({ ...base, industry: 'Consumer Goods', site_type_source: 'auto' });
    const detect = vi.fn(async () => ({
      siteType: 'b2c',
      industry: 'Other',
      via: 'ai',
      reasons: [],
    }));
    const result = await applySiteTypeDetection('b1', { db, detect, now: NOW });
    expect(db.writes[0].values).not.toHaveProperty('industry');
    expect(result.industry).toBeNull();
  });

  it('never detects over a type a person chose', async () => {
    const db = fakeDb({ ...base, site_type: 'b2b', site_type_source: 'manual' });
    const detect = vi.fn();
    expect(await applySiteTypeDetection('b1', { db, detect })).toEqual({ skipped: 'manual' });
    expect(detect).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('says what it would write, and writes nothing, on a dry run', async () => {
    const db = fakeDb(base);
    const detect = async () => ({
      siteType: 'b2b',
      industry: 'Technology',
      via: 'ai',
      reasons: [],
    });
    const result = await applySiteTypeDetection('b1', { db, detect, write: false });
    expect(result).toMatchObject({ detected: { siteType: 'b2b' }, industry: 'Technology' });
    expect(db.writes).toEqual([]);
  });

  it("keeps only the time of the try when the type can't be told", async () => {
    const db = fakeDb(base);
    expect(await applySiteTypeDetection('b1', { db, detect: async () => null, now: NOW })).toEqual({
      detected: null,
    });
    expect(db.writes).toEqual([
      {
        values: { site_type_detected_at: '2026-10-29T12:00:00.000Z' },
        id: 'b1',
        filter: 'site_type_source.is.null,site_type_source.neq.manual',
      },
    ]);
  });
});
