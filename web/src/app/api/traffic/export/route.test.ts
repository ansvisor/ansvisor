import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { SourceState } from '@/lib/actions/integrations';

/**
 * GET /api/traffic/export (AT-015): the page as a file, built on the server
 * for a signed-in member of the brand's organization.
 */

const auth = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  brand: { id: 'b1', name: 'Acme Coffee', slug: 'acme-coffee' } as Record<string, string> | null,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: auth.user } }) },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: auth.brand, error: null }),
      };
      return builder;
    },
  }),
}));

const loaders = vi.hoisted(() => ({
  getTrafficSummary: vi.fn(),
  getTrafficTrend: vi.fn(),
  getTrafficVisitsForExport: vi.fn(),
  getTrafficSources: vi.fn(),
  getPageOpportunities: vi.fn(),
}));
vi.mock('@/lib/actions/traffic', () => loaders);

const { GET } = await import('./route');

const BRAND = '33333333-3333-3333-3333-333333333333';
const ga = (over: Partial<SourceState> = {}): SourceState => ({
  configured: true,
  connected: true,
  mapped: true,
  firstDataAt: '2026-09-01T06:00:00Z',
  lastDataAt: '2026-10-18T06:00:00Z',
  property: '123',
  ...over,
});

function get(params: Record<string, string>) {
  const query = new URLSearchParams({ brandId: BRAND, rangeLabel: 'last 7 days', ...params });
  return GET(new Request(`http://localhost/api/traffic/export?${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u1' };
  auth.brand = { id: BRAND, name: 'Acme Coffee', slug: 'acme-coffee' };
  loaders.getTrafficSummary.mockResolvedValue({
    totalVisits: 2,
    totalVisitsPrev: 1,
    totalPageviews: 4,
    hasPreviousPeriod: true,
    platformBreakdown: [{ platform: 'gemini.google.com', visits: 2, visitsPrev: 1 }],
    topPages: [{ url: '/menu', visits: 2, visitsPrev: 1 }],
    hasAnyData: true,
  });
  loaders.getTrafficTrend.mockResolvedValue([{ date: '2026-10-17', 'gemini.google.com': 2 }]);
  loaders.getTrafficVisitsForExport.mockResolvedValue([
    {
      id: 'v1',
      brandId: BRAND,
      url: 'https://acme.example/menu',
      referrer: null,
      sourcePlatform: 'gemini.google.com',
      country: 'TR',
      language: null,
      screen: null,
      createdAt: '2026-10-17T09:30:00Z',
      pageviews: 3,
    },
  ]);
  loaders.getTrafficSources.mockResolvedValue({
    snippetLastVisitAt: '2026-10-17T09:30:00Z',
    ga: ga(),
    gsc: ga({ connected: false }),
  });
  loaders.getPageOpportunities.mockResolvedValue({ pages: 8, rows: [] });
});

const WINDOW = { dateFrom: '2026-10-11T09:00:00.000Z' };

// TextDecoder (and so res.text()) drops a leading byte order mark; read bytes.
const BOM = [0xef, 0xbb, 0xbf];
const startsWithBom = (bytes: Uint8Array) => BOM.every((b, i) => bytes[i] === b);
async function csvOf(res: Response) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bom: startsWithBom(bytes), text: strFromU8(bytes.subarray(3)) };
}

describe('GET /api/traffic/export', () => {
  it('builds the whole page as Excel, one sheet per section after Filters', async () => {
    const res = await get({ format: 'xlsx', from: WINDOW.dateFrom });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="ansvisor-ai-traffic-acme-coffee-2026-10-11_\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    const workbook = strFromU8(
      unzipSync(new Uint8Array(await res.arrayBuffer()))['xl/workbook.xml'],
    );
    const sheets = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
    expect(sheets).toEqual([
      'Filters',
      'KPIs',
      'Trend',
      'Platforms',
      'Top landing pages',
      'Pages without AI traffic',
      'Visits',
    ]);

    // The page's range; every landing page; every visit, with the list's filters.
    expect(loaders.getTrafficSummary).toHaveBeenCalledWith(BRAND, WINDOW, {
      topPages: Number.MAX_SAFE_INTEGER,
    });
    expect(loaders.getTrafficVisitsForExport).toHaveBeenCalledWith(BRAND, {
      ...WINDOW,
      dateTo: undefined,
      platform: undefined,
      search: undefined,
      max: 100_000,
    });
    expect(loaders.getPageOpportunities).toHaveBeenCalledWith(
      BRAND,
      { ...WINDOW, dateTo: undefined },
      {
        limit: 1000,
      },
    );
  });

  it('zips one CSV per section, each with a byte order mark', async () => {
    const res = await get({ format: 'zip', platform: 'gemini.google.com', search: 'menu' });

    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(res.headers.get('Content-Disposition')).toMatch(/all-time_\d{4}-\d{2}-\d{2}\.zip"$/);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files)).toEqual([
      'filters.csv',
      'kpis.csv',
      'trend.csv',
      'platforms.csv',
      'top-landing-pages.csv',
      'pages-without-ai-traffic.csv',
      'visits.csv',
    ]);
    for (const file of Object.values(files)) expect(startsWithBom(file)).toBe(true);
    const visits = strFromU8(files['visits.csv']);
    expect(visits).toContain('2026-10-17 09:30,Gemini,/menu,https://acme.example/menu,,TR,3');
    expect(strFromU8(files['filters.csv'])).toContain('Search,menu');
    expect(loaders.getTrafficVisitsForExport).toHaveBeenCalledWith(
      BRAND,
      expect.objectContaining({ platform: 'gemini.google.com', search: 'menu' }),
    );
  });

  it('reads only what one table needs, and names the file after it', async () => {
    const res = await get({ format: 'csv', section: 'platforms' });

    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toContain('acme-coffee-platforms-all-time_');
    const csv = await csvOf(res);
    expect(csv.bom).toBe(true);
    expect(csv.text).toBe(
      [
        'Platform,Visits,"Visits, previous period",Change (%),Share (%),Engaged (%),Key events,Note',
        'Gemini,2,1,,100,,,Low sample: fewer than 30 visits in this period or the one before',
      ].join('\n'),
    );
    expect(loaders.getTrafficTrend).not.toHaveBeenCalled();
    expect(loaders.getTrafficVisitsForExport).not.toHaveBeenCalled();
    expect(loaders.getTrafficSources).not.toHaveBeenCalled();
  });

  it('says why Analytics has no rows instead of reading them', async () => {
    loaders.getTrafficSources.mockResolvedValue({
      snippetLastVisitAt: null,
      ga: ga({ connected: false, mapped: false }),
      gsc: ga({ connected: false }),
    });
    const res = await get({ format: 'csv', section: 'opportunities' });

    const csv = await csvOf(res);
    expect(csv).toEqual({ bom: true, text: 'Note\nNeeds Google Analytics: not connected' });
    expect(loaders.getPageOpportunities).not.toHaveBeenCalled();
  });

  it("notes Analytics findings it couldn't read, rather than failing the export", async () => {
    loaders.getPageOpportunities.mockRejectedValue(new Error('Server error: 500'));
    const res = await get({ format: 'csv', section: 'opportunities' });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("couldn't be read");
  });

  it('refuses more visits than an export built on request should hold', async () => {
    loaders.getTrafficVisitsForExport.mockResolvedValue(null);
    const res = await get({ format: 'xlsx' });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too_large' });
  });

  it('refuses a request that asks for the wrong shape', async () => {
    const wrong: Record<string, string>[] = [
      { format: 'zip', section: 'visits' },
      { format: 'csv' },
      { format: 'pdf' },
      { format: 'xlsx', section: 'everything' },
      { format: 'xlsx', brandId: 'not-a-brand' },
    ];
    for (const params of wrong) {
      const res = await get(params);
      expect(res.status).toBe(400);
    }
  });

  it('needs a signed-in member who can see the brand', async () => {
    auth.user = null;
    expect((await get({ format: 'xlsx' })).status).toBe(401);
    auth.user = { id: 'u1' };
    auth.brand = null;
    expect((await get({ format: 'xlsx' })).status).toBe(404);
  });

  it('reports a failed read as an error, not as an empty file', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loaders.getTrafficSummary.mockRejectedValue(new Error('timeout'));
    const res = await get({ format: 'xlsx' });
    expect(res.status).toBe(500);
    error.mockRestore();
  });
});
