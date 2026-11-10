import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The AI-sourced pipeline from HubSpot (#2140, 00520): the brand's marked
 * contacts and HubSpot's own AI Referrals ones on its domains, their deals
 * each once, credited to the earliest AI contact (Ansvisor's first), the
 * brand's rows replaced, and only with consent, the plan and a live sign-in.
 * Against a fake HubSpot answering in the documented shape (__fixtures__),
 * to be replaced with recorded answers at the live test.
 */

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));

const BRAND = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-11-10T06:00:00.000Z');

/** The rows the fake database holds and the calls made to it. */
const db = vi.hoisted(() => ({ tables: {}, calls: [], domains: [], orgs: [], brands: [] }));
vi.mock('../../config/supabase.js', () => {
  const from = (table) => {
    const q = { table, filters: [] };
    const chain = {
      select: () => chain,
      eq: (col, val) => (q.filters.push(['eq', col, val]), chain),
      in: (col, val) => (q.filters.push(['in', col, val]), chain),
      lt: (col, val) => (q.filters.push(['lt', col, val]), chain),
      upsert: (rows) => {
        db.calls.push(['upsert', table, rows.length]);
        db.tables[table] = [...(db.tables[table] ?? []), ...rows];
        return Promise.resolve({ error: null });
      },
      delete: () => ((q.delete = true), chain),
      then: (resolve) => {
        if (q.delete) {
          const lt = q.filters.find((f) => f[0] === 'lt');
          db.tables[table] = (db.tables[table] ?? []).filter((r) => !(r.synced_at < lt[2]));
          db.calls.push(['delete', table]);
          return resolve({ error: null });
        }
        const data =
          table === 'brand_domains'
            ? db.domains
            : table === 'organizations'
              ? db.orgs
              : table === 'brands'
                ? db.brands
                : [];
        return resolve({ data, error: null });
      },
    };
    return chain;
  };
  return { default: { from } };
});

const hubspot = vi.hoisted(() => ({ routes: {}, calls: [] }));
vi.mock('../composio.js', () => ({
  isHubspotConfigured: () => true,
  proxyRequest: async (_accountId, { endpoint, method, body }) => {
    const path = endpoint.replace('https://api.hubapi.com', '');
    hubspot.calls.push({ method, path, body });
    const route = hubspot.routes[`${method} ${path}`];
    if (!route) throw new Error(`unexpected ${method} ${path}`);
    const answer = typeof route === 'function' ? route(body) : route;
    // A route answers its body, or { status, data } for a refusal.
    return typeof answer.status === 'number'
      ? { status: answer.status, headers: {}, data: answer.data }
      : { status: 200, headers: {}, data: answer };
  },
}));
const conn = vi.hoisted(() => ({
  brandHubspotSettings: vi.fn(),
  markSignInRefused: vi.fn(),
  writeHubspotSync: vi.fn(),
}));
vi.mock('./connection.js', () => ({ HUBSPOT: 'hubspot', ...conn }));
const connected = vi.hoisted(() => vi.fn());
const current = vi.hoisted(() => vi.fn());
vi.mock('../brand-integrations.js', () => ({
  brandConnection: (...a) => current(...a),
  connectedBrands: (...a) => connected(...a),
}));
const active = vi.hoisted(() => ({ orgs: new Set(['org-1']) }));
vi.mock('../active-subscriptions.js', () => ({
  activeOrgFilter: async () => (id) => active.orgs.has(id),
}));
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const {
  creditedContact,
  isoOf,
  onDomains,
  readPipeline,
  runHubspotPipelineSync,
  sourceKeyOf,
  syncBrandPipeline,
} = await import('./pipeline-sync.js');
const { HubspotError } = await import('./client.js');

/** HubSpot's search answers by its filter: Ansvisor's brand id, or HubSpot's AI Referrals. */
function searchRoute(body) {
  const filters = body.filterGroups[0].filters;
  const native = filters.some((f) => f.propertyName === 'hs_analytics_source');
  return fixture(native ? 'contacts-search-ai-referrals' : 'contacts-search-marked');
}
const ROUTES = {
  'POST /crm/v3/objects/contacts/search': searchRoute,
  'POST /crm/v4/associations/contacts/deals/batch/read': fixture('associations-contacts-deals'),
  'POST /crm/v3/objects/deals/batch/read': fixture('deals-batch-read'),
};
/** A bound request on the fake HubSpot, as client.js gives one. */
const request = async ({ method = 'GET', path, body }) => {
  hubspot.calls.push({ method, path, body });
  const route = hubspot.routes[`${method} ${path}`];
  if (route instanceof Error) throw route;
  return { status: 200, headers: {}, data: typeof route === 'function' ? route(body) : route };
};

const CONNECTION = {
  brandId: BRAND,
  provider: 'hubspot',
  accountId: 'acc-1',
  organizationId: 'org-1',
  entityId: 'org_org-1',
  composioAccountId: 'ca_1',
  connected: true,
};
const SETTINGS = {
  consent: { contacts: true, pages: false },
  portal: { id: 4412893, currency: 'USD' },
};

beforeEach(() => {
  hubspot.routes = { ...ROUTES };
  hubspot.calls = [];
  db.tables = {};
  db.calls = [];
  db.domains = [{ domain: 'acme.test' }];
  db.orgs = [{ id: 'org-1', plan: 'growth', plan_overrides: null }];
  db.brands = [{ id: BRAND }];
  active.orgs = new Set(['org-1']);
  for (const fn of Object.values(conn)) fn.mockReset();
  conn.brandHubspotSettings.mockResolvedValue(SETTINGS);
  connected.mockReset().mockResolvedValue([CONNECTION]);
  current.mockReset().mockResolvedValue(CONNECTION);
  vi.stubEnv('IS_CLOUD', 'true');
});

describe('readPipeline', () => {
  it('reads the marked contacts, and HubSpot’s own AI Referrals ones on the brand’s domains', async () => {
    const { contacts } = await readPipeline(request, {
      brandId: BRAND,
      domains: ['acme.test'],
      currency: 'USD',
      now: NOW,
    });
    expect(contacts).toEqual([
      {
        contact_id: '101',
        origin: 'ansvisor',
        ai_source: 'chatgpt.com',
        landing_url: 'https://acme.test/pricing',
        first_at: '2026-11-02T14:12:00.000Z',
        converted_at: '2026-11-03T09:40:00.000Z',
        hs_created_at: '2026-11-03T09:40:05.000Z',
      },
      {
        contact_id: '102',
        origin: 'ansvisor',
        ai_source: 'perplexity.ai',
        // Without its query string.
        landing_url: 'https://acme.test/blog/ai-crm-guide',
        first_at: '2026-11-04T08:00:00.000Z',
        converted_at: '2026-11-04T08:20:00.000Z',
        hs_created_at: '2026-10-20T10:00:00.000Z',
      },
      // 102 is marked already; 202 landed on another brand's site.
      {
        contact_id: '201',
        origin: 'hubspot',
        ai_source: 'chatgpt.com',
        landing_url: 'https://www.acme.test/compare/acme-vs-zenith',
        first_at: null,
        converted_at: null,
        hs_created_at: '2026-11-01T12:00:00.000Z',
      },
    ]);
    const [marked, native] = hubspot.calls.filter((c) => c.path.endsWith('/contacts/search'));
    expect(marked.body.filterGroups[0].filters[0]).toEqual({
      propertyName: 'ansvisor_brand_id',
      operator: 'EQ',
      value: BRAND,
    });
    expect(native.body.filterGroups[0].filters[0]).toEqual({
      propertyName: 'hs_analytics_source',
      operator: 'EQ',
      value: 'AI_REFERRALS',
    });
    // No name or email is ever asked for.
    expect(JSON.stringify(hubspot.calls)).not.toMatch(/email|firstname|lastname/);
  });

  it('counts each deal once, in full, credited to its earliest AI contact', async () => {
    const { deals } = await readPipeline(request, {
      brandId: BRAND,
      domains: ['acme.test'],
      currency: 'USD',
      now: NOW,
    });
    expect(deals).toEqual([
      {
        deal_id: '9001',
        contact_id: '101',
        origin: 'ansvisor',
        ai_source: 'chatgpt.com',
        landing_url: 'https://acme.test/pricing',
        // In the account's own currency.
        amount: 12000.5,
        currency: 'USD',
        is_closed: true,
        is_won: true,
        close_date: '2026-11-08T17:00:00.000Z',
        hs_created_at: '2026-11-03T10:00:00.000Z',
      },
      // Two AI contacts: 101 came first.
      expect.objectContaining({
        deal_id: '9002',
        contact_id: '101',
        amount: 50000,
        is_closed: false,
        is_won: false,
      }),
      expect.objectContaining({ deal_id: '9003', contact_id: '201', origin: 'hubspot' }),
    ]);
    const [associations] = hubspot.calls.filter((c) => c.path.includes('/associations/'));
    expect(associations.body.inputs).toEqual([{ id: '101' }, { id: '102' }, { id: '201' }]);
  });

  it('pages past the last contact read, beyond HubSpot’s 10,000 search results', async () => {
    let page = 0;
    hubspot.routes['POST /crm/v3/objects/contacts/search'] = (body) => {
      if (body.filterGroups[0].filters[0].propertyName === 'hs_analytics_source') {
        return { results: [] };
      }
      page += 1;
      const start = page === 1 ? 1 : 101;
      const count = page === 1 ? 100 : 3;
      return {
        results: Array.from({ length: count }, (_, i) => ({
          id: String(start + i),
          properties: { ansvisor_ai_source: 'claude.ai' },
        })),
      };
    };
    hubspot.routes['POST /crm/v4/associations/contacts/deals/batch/read'] = { results: [] };
    const { contacts } = await readPipeline(request, { brandId: BRAND, domains: [], now: NOW });
    expect(contacts).toHaveLength(103);
    const searches = hubspot.calls.filter((c) => c.path.endsWith('/contacts/search'));
    expect(searches.map((c) => c.body.filterGroups[0].filters.at(-1))).toEqual([
      { propertyName: 'hs_object_id', operator: 'GT', value: '0' },
      { propertyName: 'hs_object_id', operator: 'GT', value: '100' },
    ]);
    // With no domain, HubSpot's own AI Referrals aren't asked for.
    expect(searches).toHaveLength(2);
    expect(hubspot.calls.filter((c) => c.path.includes('/associations/'))).toHaveLength(2);
  });

  it('reads none of HubSpot’s own when the account refuses that filter', async () => {
    hubspot.routes['POST /crm/v3/objects/contacts/search'] = (body) => {
      if (body.filterGroups[0].filters[0].propertyName === 'hs_analytics_source') {
        throw new HubspotError('invalid', '400', { status: 400 });
      }
      return fixture('contacts-search-marked');
    };
    const { contacts } = await readPipeline(request, {
      brandId: BRAND,
      domains: ['acme.test'],
      now: NOW,
    });
    expect(contacts.map((c) => c.origin)).toEqual(['ansvisor', 'ansvisor']);
  });
});

describe('the helpers', () => {
  it('credits a deal to Ansvisor’s earliest contact before HubSpot’s own', () => {
    const marked = { contact_id: '5', origin: 'ansvisor', first_at: '2026-11-05T00:00:00Z' };
    const earlierNative = { contact_id: '3', origin: 'hubspot', hs_created_at: '2026-10-01' };
    const earlierMarked = { contact_id: '9', origin: 'ansvisor', first_at: '2026-11-01T00:00:00Z' };
    expect(creditedContact([earlierNative, marked]).contact_id).toBe('5');
    expect(creditedContact([marked, earlierMarked, earlierNative]).contact_id).toBe('9');
  });

  it('reads HubSpot’s dates, sources and domains', () => {
    expect(isoOf('1762300000000')).toBe('2025-11-04T23:46:40.000Z');
    expect(isoOf('2026-11-03T09:40:00Z')).toBe('2026-11-03T09:40:00.000Z');
    expect(isoOf('')).toBeNull();
    expect(isoOf('not a date')).toBeNull();
    expect(sourceKeyOf('chat.openai.com')).toBe('chatgpt.com');
    expect(sourceKeyOf('somewhere.test')).toBe('unknown');
    expect(onDomains('https://www.acme.test/x', ['acme.test'])).toBe(true);
    expect(onDomains('https://blog.acme.test/x', ['acme.test'])).toBe(true);
    expect(onDomains('https://notacme.test/x', ['acme.test'])).toBe(false);
    expect(onDomains('not a url', ['acme.test'])).toBe(false);
  });
});

describe('syncBrandPipeline', () => {
  it('replaces the brand’s rows and keeps how the read went', async () => {
    db.tables.hubspot_ai_contacts = [
      { brand_id: BRAND, contact_id: '1', synced_at: '2026-11-09T06:00:00.000Z' },
    ];
    const sync = await syncBrandPipeline(CONNECTION, { settings: SETTINGS, now: NOW });
    expect(sync).toEqual({ at: '2026-11-10T06:00:00.000Z', contacts: 3, deals: 3, error: null });
    // The old row is gone, the new ones are the brand's.
    expect(db.tables.hubspot_ai_contacts.map((r) => r.contact_id)).toEqual(['101', '102', '201']);
    expect(db.tables.hubspot_ai_deals.every((r) => r.brand_id === BRAND)).toBe(true);
    expect(conn.writeHubspotSync).toHaveBeenCalledWith(BRAND, sync);
  });

  it('keeps nothing when the brand moved to another account, or disconnected, during the read', async () => {
    for (const after of [{ ...CONNECTION, accountId: 'acc-2', composioAccountId: 'ca_2' }, null]) {
      db.calls = [];
      conn.writeHubspotSync.mockReset();
      current.mockResolvedValue(after);
      const sync = await syncBrandPipeline(CONNECTION, { settings: SETTINGS, now: NOW });
      expect(sync).toMatchObject({ error: 'account_changed', contacts: null, deals: null });
      expect(current).toHaveBeenCalledWith(BRAND, 'hubspot');
      // Not a row of the old account written, nor its sync on the new one's settings.
      expect(db.calls).toEqual([]);
      expect(conn.writeHubspotSync).not.toHaveBeenCalled();
    }
  });

  it('marks a refused sign-in, and keeps why the read failed', async () => {
    hubspot.routes['POST /crm/v3/objects/contacts/search'] = {
      status: 401,
      data: { category: 'INVALID_AUTHENTICATION' },
    };
    const sync = await syncBrandPipeline(CONNECTION, { settings: SETTINGS, now: NOW });
    expect(sync).toMatchObject({ error: 'auth', contacts: null });
    expect(conn.markSignInRefused).toHaveBeenCalledWith('acc-1');
    expect(db.calls).toEqual([]);
  });
});

describe('runHubspotPipelineSync', () => {
  it('syncs a brand with a live sign-in, consent, an active plan with HubSpot', async () => {
    const run = await runHubspotPipelineSync({ now: NOW });
    expect(run).toMatchObject({ synced: 1, skipped: 0 });
    expect(conn.writeHubspotSync).toHaveBeenCalledOnce();
  });

  it('reads nothing without consent to mark contacts', async () => {
    conn.brandHubspotSettings.mockResolvedValue({ ...SETTINGS, consent: { contacts: false } });
    expect(await runHubspotPipelineSync({ now: NOW })).toMatchObject({ synced: 0, skipped: 1 });
    expect(hubspot.calls).toEqual([]);
  });

  it('reads nothing on Starter, once the plan has ended, or for the demo brand', async () => {
    db.orgs = [{ id: 'org-1', plan: 'starter', plan_overrides: null }];
    expect(await runHubspotPipelineSync({ now: NOW })).toMatchObject({ synced: 0 });

    db.orgs = [{ id: 'org-1', plan: 'growth', plan_overrides: null }];
    active.orgs = new Set();
    expect(await runHubspotPipelineSync({ now: NOW })).toMatchObject({ synced: 0 });

    active.orgs = new Set(['org-1']);
    db.brands = [];
    expect(await runHubspotPipelineSync({ now: NOW })).toMatchObject({ synced: 0 });
    expect(hubspot.calls).toEqual([]);
  });

  it('syncs one brand for Sync now', async () => {
    await runHubspotPipelineSync({ brandId: BRAND, now: NOW });
    expect(connected).toHaveBeenCalledWith('hubspot', { brandId: BRAND });
  });
});
