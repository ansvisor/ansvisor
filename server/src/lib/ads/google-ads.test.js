import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ads Phase 1's Google Ads reads (G1) through Composio's GOOGLEADS_* tools:
 * the queries are built from checked ids and dates, only SELECTs are sent,
 * every page is read, and Google's rows become ads_campaign_daily and
 * ads_search_term_daily rows.
 */

const executeGoogleAdsTool = vi.fn();
vi.mock('../composio.js', () => ({
  executeGoogleAdsTool: (...args) => executeGoogleAdsTool(...args),
}));

const {
  campaignDays,
  customerIdOf,
  customerInfo,
  dateRange,
  listAccessibleCustomers,
  parseToolData,
  searchPage,
  searchTermDays,
} = await import('./google-ads.js');

const connection = { entityId: 'org_o1', accountId: 'ca_1' };
const range = { since: '2026-11-01', until: '2026-11-07' };

beforeEach(() => executeGoogleAdsTool.mockReset());

describe('customerIdOf', () => {
  it('keeps 10 digits from any of the forms Google writes, and refuses the rest', () => {
    expect(customerIdOf('customers/7967533946')).toBe('7967533946');
    expect(customerIdOf('796-753-3946')).toBe('7967533946');
    expect(customerIdOf('796 753 3946')).toBe('7967533946');
    expect(customerIdOf('12345')).toBeNull();
    expect(customerIdOf("1' OR '1'='1")).toBeNull();
    expect(customerIdOf(null)).toBeNull();
  });
});

describe('parseToolData and searchPage', () => {
  it("reads Composio's string data, an object, or nothing", () => {
    expect(parseToolData('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolData({ a: 1 })).toEqual({ a: 1 });
    expect(parseToolData(null)).toEqual({});
    expect(() => parseToolData('<html>')).toThrow(/not JSON/);
  });

  it('finds rows and the next page in either key style', () => {
    expect(searchPage('{"results":[1],"nextPageToken":"t"}')).toEqual({
      rows: [1],
      nextPageToken: 't',
    });
    expect(searchPage({ response: { results: [2], next_page_token: 'u' } })).toEqual({
      rows: [2],
      nextPageToken: 'u',
    });
    expect(searchPage({})).toEqual({ rows: [], nextPageToken: null });
  });
});

describe('dateRange', () => {
  it('takes two YYYY-MM-DD days in order and refuses anything else', () => {
    expect(dateRange(range)).toEqual(range);
    expect(() => dateRange({ since: '2026-11-08', until: '2026-11-07' })).toThrow();
    expect(() => dateRange({ since: "2026-11-01' OR 1=1 --", until: '2026-11-07' })).toThrow();
    expect(() => dateRange({})).toThrow();
  });
});

describe('listAccessibleCustomers', () => {
  it("returns the sign-in's customer ids, each once", async () => {
    executeGoogleAdsTool.mockResolvedValueOnce(
      JSON.stringify({
        resourceNames: ['customers/7967533946', 'customers/1884418333', 'customers/7967533946'],
      }),
    );
    await expect(listAccessibleCustomers(connection)).resolves.toEqual([
      '7967533946',
      '1884418333',
    ]);
    expect(executeGoogleAdsTool).toHaveBeenCalledWith(
      'GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS',
      connection,
      {},
    );
  });
});

describe('customerInfo', () => {
  it("describes the customer, and says when it's a manager or a test account", async () => {
    executeGoogleAdsTool.mockResolvedValueOnce({
      results: [
        {
          customer: {
            id: '7967533946',
            descriptiveName: 'Empler',
            currencyCode: 'USD',
            timeZone: 'Europe/Istanbul',
            manager: true,
          },
        },
      ],
    });
    await expect(customerInfo(connection, '796-753-3946')).resolves.toEqual({
      id: '7967533946',
      name: 'Empler',
      currencyCode: 'USD',
      timeZone: 'Europe/Istanbul',
      manager: true,
      testAccount: false,
    });
    const [slug, , args] = executeGoogleAdsTool.mock.calls[0];
    expect(slug).toBe('GOOGLEADS_SEARCH_GAQL');
    expect(args.customer_id).toBe('7967533946');
    expect(args.query).toMatch(/^SELECT .* FROM customer LIMIT 1$/);
  });

  it('refuses a customer id that is not 10 digits, before any call', async () => {
    await expect(customerInfo(connection, '1; DROP')).rejects.toThrow(/10 digits/);
    expect(executeGoogleAdsTool).not.toHaveBeenCalled();
  });
});

describe('campaignDays', () => {
  it('reads every page of the range and shapes ads_campaign_daily rows', async () => {
    executeGoogleAdsTool
      .mockResolvedValueOnce({
        results: [
          {
            campaign: { id: '11', name: 'Brand', status: 'ENABLED' },
            segments: { date: '2026-11-01' },
            metrics: {
              impressions: '120',
              clicks: '7',
              costMicros: '4560000',
              conversions: 1.5,
              conversionsValue: 99.999,
            },
          },
        ],
        nextPageToken: 'p2',
      })
      .mockResolvedValueOnce({
        results: [{ campaign: { id: '12' }, segments: { date: '2026-11-02' }, metrics: {} }],
      });

    const rows = await campaignDays(connection, '7967533946', range);
    expect(rows).toEqual([
      {
        campaign_id: '11',
        day: '2026-11-01',
        campaign_name: 'Brand',
        campaign_status: 'ENABLED',
        impressions: 120,
        clicks: 7,
        cost_micros: 4560000,
        conversions: 1.5,
        conversion_value: 100,
      },
      {
        campaign_id: '12',
        day: '2026-11-02',
        campaign_name: null,
        campaign_status: null,
        impressions: 0,
        clicks: 0,
        cost_micros: 0,
        conversions: 0,
        conversion_value: 0,
      },
    ]);
    const [first, second] = executeGoogleAdsTool.mock.calls;
    expect(first[2].query).toContain("WHERE segments.date BETWEEN '2026-11-01' AND '2026-11-07'");
    expect(first[2].query.startsWith('SELECT ')).toBe(true);
    expect(first[2]).not.toHaveProperty('page_token');
    expect(second[2].page_token).toBe('p2');
  });

  it('stops instead of reading forever when Google keeps answering with a next page', async () => {
    executeGoogleAdsTool.mockResolvedValue({ results: [], nextPageToken: 'again' });
    await expect(campaignDays(connection, '7967533946', range)).rejects.toThrow(/stopped after/);
  });

  it('refuses a bad range before any call', async () => {
    await expect(
      campaignDays(connection, '7967533946', { since: 'yesterday', until: 'today' }),
    ).rejects.toThrow(/YYYY-MM-DD/);
    expect(executeGoogleAdsTool).not.toHaveBeenCalled();
  });
});

describe('searchTermDays', () => {
  it('shapes ads_search_term_daily rows and skips rows without a term', async () => {
    executeGoogleAdsTool.mockResolvedValueOnce({
      results: [
        {
          campaign: { id: '11' },
          searchTermView: { searchTerm: 'best ai visibility tool' },
          segments: { date: '2026-11-03' },
          metrics: { impressions: '40', clicks: '3', costMicros: '1200000', conversions: 0 },
        },
        { campaign: { id: '11' }, segments: { date: '2026-11-03' }, metrics: {} },
      ],
    });
    await expect(searchTermDays(connection, '7967533946', range)).resolves.toEqual([
      {
        campaign_id: '11',
        search_term: 'best ai visibility tool',
        day: '2026-11-03',
        impressions: 40,
        clicks: 3,
        cost_micros: 1200000,
        conversions: 0,
      },
    ]);
    expect(executeGoogleAdsTool.mock.calls[0][2].query).toContain('FROM search_term_view');
  });

  it('adds up one term shown by two ad groups of a campaign on one day', async () => {
    const shown = (metrics) => ({
      campaign: { id: '11' },
      searchTermView: { searchTerm: 'best crm' },
      segments: { date: '2026-11-03' },
      metrics,
    });
    executeGoogleAdsTool.mockResolvedValueOnce({
      results: [
        shown({ impressions: '10', clicks: '2', costMicros: '1500000', conversions: 0.5 }),
        shown({ impressions: '5', clicks: '1', costMicros: '700000', conversions: 1.25 }),
        { ...shown({ clicks: '4' }), campaign: { id: '12' } },
      ],
    });
    await expect(searchTermDays(connection, '7967533946', range)).resolves.toEqual([
      {
        campaign_id: '11',
        search_term: 'best crm',
        day: '2026-11-03',
        impressions: 15,
        clicks: 3,
        cost_micros: 2200000,
        conversions: 1.75,
      },
      {
        campaign_id: '12',
        search_term: 'best crm',
        day: '2026-11-03',
        impressions: 0,
        clicks: 4,
        cost_micros: 0,
        conversions: 0,
      },
    ]);
  });
});
