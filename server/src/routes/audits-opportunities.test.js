import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for the Opportunities inbox: GET /api/audits/opportunities
 * reads the GA page opportunities, site pages, audits and pins/exclusions,
 * adds each page's AI visits, and PUT /api/audits/opportunities/prefs pins,
 * excludes or clears pages.
 */

let tables;
let rpcCalls;
let writes;
let server;
let baseUrl;

function query(table) {
  const filters = {};
  let write = null;
  const builder = {
    select: () => builder,
    eq: (col, val) => {
      filters[col] = val;
      return builder;
    },
    is: () => builder,
    in: (col, vals) => {
      filters[col] = vals;
      return builder;
    },
    order: () => builder,
    range: (from, to) => {
      filters.range = [from, to];
      return builder;
    },
    limit: () => builder,
    maybeSingle: () => {
      builder.single = true;
      return builder;
    },
    upsert: (rows, opts) => {
      write = { op: 'upsert', rows, opts };
      return builder;
    },
    delete: () => {
      write = { op: 'delete' };
      return builder;
    },
    then: (resolve) => {
      if (write) {
        writes.push({ table, ...write, filters: { ...filters } });
        return resolve({ data: null, error: null });
      }
      let data = (tables[table] ?? []).filter(
        (r) => !r.brand_id || r.brand_id === filters.brand_id,
      );
      // PostgREST's max_rows: a read without a range stops at 1000 rows.
      data = filters.range
        ? data.slice(filters.range[0], filters.range[1] + 1)
        : data.slice(0, 1000);
      if (table === 'brands') data = (tables.brands ?? []).find((b) => b.id === filters.id) ?? null;
      else if (builder.single) data = data[0] ?? null;
      return resolve({ data, error: null });
    },
  };
  return builder;
}

async function startApp() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({
    default: {
      from: (t) => query(t),
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        if (name === 'audit_competitor_cited_prompts') {
          if (tables.competitorPromptsMissing) {
            return { data: null, error: { code: 'PGRST202', message: 'not found' } };
          }
          return { data: tables.competitorPrompts ?? [], error: null };
        }
        return {
          data: {
            analytics: [{ page: args.p_pages[0], platform: 'chatgpt', cur_sessions: 7 }],
            snippet: [],
          },
          error: null,
        };
      },
    },
  }));
  vi.doMock('../lib/access.js', () => ({ assertBrandAccess: async () => ({ orgId: 'org-1' }) }));
  vi.doMock('../lib/plan-guard.js', () => ({
    requireFeature: () => (req, res, next) => next(),
    enforceSiteAuditQuota: vi.fn(),
    getSiteAuditQuotaStatus: vi.fn(),
    getOrgIdForUser: vi.fn(),
    PlanLimitError: class PlanLimitError extends Error {},
  }));
  vi.doMock('../lib/audit/context.js', () => ({ buildAuditContext: vi.fn() }));
  vi.doMock('../lib/audit/engine.js', () => ({ runSignals: vi.fn() }));
  vi.doMock('../lib/audit/llm-signals.js', () => ({ evaluateLlmSignals: vi.fn() }));
  vi.doMock('../lib/audit/external-signals.js', () => ({ evaluateBrandEntity: vi.fn() }));
  vi.doMock('../lib/audit/recommendations.js', () => ({
    brandFactsFor: vi.fn(),
    generateRecommendations: vi.fn(),
  }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { default: logger, logger };
  });

  const { default: router } = await import('./audits.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/audits', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/audits`;
}

const brandId = '33333333-3333-3333-3333-333333333333';

beforeEach(async () => {
  rpcCalls = [];
  writes = [];
  tables = {
    brands: [{ id: brandId, ga_property_id: 'properties/1' }],
    brand_domains: [{ brand_id: brandId, domain: 'www.acme.com', is_primary: true }],
    page_opportunities: [
      {
        brand_id: brandId,
        landing_page: '/pricing',
        value_signal: 'revenue',
        value_percentile: 96,
        sessions: 800,
        citation_state: 'not_targeted',
        citations: 0,
      },
    ],
    site_pages: [
      {
        brand_id: brandId,
        url: 'https://acme.com/blog',
        title: 'Blog',
        ga_sessions: 30,
        ai_citations: 2,
      },
    ],
    site_audits: [],
    ai_traffic_logs: [],
    site_audit_page_prefs: [
      {
        brand_id: brandId,
        page_key: 'acme.com/blog',
        url: 'https://acme.com/blog',
        state: 'excluded',
      },
    ],
  };
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  vi.doUnmock('../config/supabase.js');
});

describe('GET /api/audits/opportunities', () => {
  it("lists the brand's opportunities with their AI visits, and the excluded pages apart", async () => {
    const res = await fetch(`${baseUrl}/opportunities?brandId=${brandId}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.opportunities).toEqual([
      expect.objectContaining({
        url: 'https://acme.com/pricing',
        path: '/pricing',
        aiVisits: 7,
        reasons: [expect.objectContaining({ type: 'no_ai_traffic', percentile: 96 })],
      }),
    ]);
    expect(body.excluded.map((e) => e.path)).toEqual(['/blog']);
    expect(body.staleDays).toBe(90);

    // AI visits over the last 30 days, for the listed pages.
    const { name, args } = rpcCalls.find((c) => c.name === 'ae_page_traffic_evidence');
    expect(name).toBe('ae_page_traffic_evidence');
    expect(args.p_pages).toEqual(['https://acme.com/pricing']);
  });

  it('reads every GA page past the first 1000', async () => {
    tables.page_opportunities = Array.from({ length: 1200 }, (_, i) => ({
      brand_id: brandId,
      landing_page: `/p${i}`,
      value_signal: 'engagement',
      value_percentile: 75,
      sessions: 20,
      citation_state: null,
      citations: 0,
    }));
    const body = await (await fetch(`${baseUrl}/opportunities?brandId=${brandId}`)).json();
    expect(body.opportunities).toHaveLength(1200);
  });

  it('leaves AI visits unknown for a brand with neither Analytics nor the snippet', async () => {
    tables.brands = [{ id: brandId, ga_property_id: null }];
    const body = await (await fetch(`${baseUrl}/opportunities?brandId=${brandId}`)).json();
    expect(body.opportunities[0].aiVisits).toBeNull();
    expect(rpcCalls.map((c) => c.name)).not.toContain('ae_page_traffic_evidence');
  });

  it("adds the pages closest to the prompts a competitor wins and the brand doesn't", async () => {
    tables.competitors = [
      { brand_id: brandId, name: 'Crema Club', domain: 'https://www.Crema.example/' },
      { brand_id: brandId, name: 'No domain', domain: '' },
    ];
    tables.site_pages.push({
      brand_id: brandId,
      url: 'https://acme.com/subscriptions',
      title: 'Coffee subscription plans',
      h1: 'Coffee subscriptions',
      description: null,
      ga_sessions: 5,
      ai_citations: 0,
    });
    tables.competitorPrompts = [
      {
        prompt_id: 'p1',
        prompt_text: 'best coffee subscription plans',
        results: 6,
        competitor_results: 4,
        own_results: 0,
        competitor_domains: ['crema.example'],
      },
      // Cited on this one too: not a gap.
      {
        prompt_id: 'p2',
        prompt_text: 'coffee subscription plans for offices',
        results: 6,
        competitor_results: 2,
        own_results: 1,
        competitor_domains: ['crema.example'],
      },
    ];
    tables.prompt_target_urls = [];

    const body = await (await fetch(`${baseUrl}/opportunities?brandId=${brandId}`)).json();
    const page = body.opportunities.find((o) => o.path === '/subscriptions');
    expect(page.reasons).toContainEqual({
      type: 'competitor_cited',
      prompts: 1,
      competitors: ['Crema Club'],
    });

    const { args } = rpcCalls.find((c) => c.name === 'audit_competitor_cited_prompts');
    expect(args).toMatchObject({
      p_brand_id: brandId,
      p_own_domains: ['acme.com'],
      p_competitor_domains: ['crema.example'],
    });
  });

  it('lists the other sources on a database without migration 00166', async () => {
    tables.competitors = [{ brand_id: brandId, name: 'Crema Club', domain: 'crema.example' }];
    tables.competitorPromptsMissing = true;
    const res = await fetch(`${baseUrl}/opportunities?brandId=${brandId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).opportunities.map((o) => o.path)).toEqual(['/pricing']);
  });

  it('asks for no citations without competitor domains', async () => {
    await fetch(`${baseUrl}/opportunities?brandId=${brandId}`);
    expect(rpcCalls.map((c) => c.name)).not.toContain('audit_competitor_cited_prompts');
  });

  it('needs a brand', async () => {
    expect((await fetch(`${baseUrl}/opportunities`)).status).toBe(400);
  });
});

describe('PUT /api/audits/opportunities/prefs', () => {
  const put = (body) =>
    fetch(`${baseUrl}/opportunities/prefs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('pins or excludes pages once per page, by their page key', async () => {
    const res = await put({
      brandId,
      urls: ['https://www.acme.com/Pricing/', 'https://acme.com/pricing', 'https://acme.com/blog'],
      state: 'pinned',
    });
    expect(res.status).toBe(200);
    const [write] = writes;
    expect(write).toMatchObject({
      table: 'site_audit_page_prefs',
      op: 'upsert',
      opts: { onConflict: 'brand_id,page_key' },
    });
    expect(write.rows.map((r) => [r.page_key, r.url, r.state, r.created_by])).toEqual([
      ['acme.com/pricing', 'https://acme.com/pricing', 'pinned', 'u1'],
      ['acme.com/blog', 'https://acme.com/blog', 'pinned', 'u1'],
    ]);
  });

  it('clears pages with a null state', async () => {
    await put({ brandId, urls: ['https://acme.com/blog'], state: null });
    expect(writes).toEqual([
      expect.objectContaining({
        op: 'delete',
        filters: { brand_id: brandId, page_key: ['acme.com/blog'] },
      }),
    ]);
  });

  it('refuses an unknown state, no URLs or something that is not a URL', async () => {
    expect((await put({ brandId, urls: ['https://acme.com/'], state: 'starred' })).status).toBe(
      400,
    );
    expect((await put({ brandId, urls: [], state: 'pinned' })).status).toBe(400);
    expect((await put({ brandId, urls: ['nope'], state: 'pinned' })).status).toBe(400);
    expect(writes).toEqual([]);
  });
});
