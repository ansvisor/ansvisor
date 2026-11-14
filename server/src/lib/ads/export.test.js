import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ads' Google Ads Editor CSV (ADS-01 §3.2, §7a rules 11 and 16): a fixed
 * input gives this exact file; a final URL off the brand's domains is left
 * out; the export is logged by the real log, with no personal data; reads
 * stay within the brand and its organization.
 */

let db;
const inserts = [];
const at = (row, path) => path.split('.').reduce((v, k) => v?.[k], row);
function from(table) {
  let rows = db[table] ?? [];
  const q = {
    select: () => q,
    eq: (col, v) => ((rows = rows.filter((r) => at(r, col) === v)), q),
    order: (col, { ascending }) => (
      (rows = [...rows].sort((a, b) => (ascending ? 1 : -1) * (a[col] - b[col]))),
      q
    ),
    insert: (row) => {
      inserts.push({ table, row });
      return { select: () => ({ single: async () => ({ data: { id: 'l1' }, error: null }) }) };
    },
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return q;
}
vi.mock('../../config/supabase.js', () => ({ default: { from: (table) => from(table) } }));
const reads = { readOpportunities: vi.fn(), readOpportunity: vi.fn(), readCompetitors: vi.fn() };
vi.mock('./opportunities.js', () => ({
  readOpportunities: (...a) => reads.readOpportunities(...a),
}));
vi.mock('./opportunity.js', () => ({ readOpportunity: (...a) => reads.readOpportunity(...a) }));
vi.mock('./drafts.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readCompetitors: (...a) => reads.readCompetitors(...a),
}));

const { exportEditor, exportOpportunity } = await import('./export.js');

const NOW = new Date('2026-11-14T12:00:00Z');
const [ORG, OTHER_ORG, B1, USER] = ['1', '2', '3', '4'].map(
  (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`,
);
const BRAND = { id: B1, name: 'Northwind' };
const ROWS = [
  {
    promptId: 'p1',
    text: 'best crm for small teams',
    topic: { name: 'Small teams' },
    decision: 'earn_pay',
  },
  { promptId: 'p2', text: 'crm with outlook sync', topic: null, decision: 'pay' },
  { promptId: 'p3', text: 'what is a crm', topic: { name: 'Basics' }, decision: 'earn' },
];
const draft = (channel, headlines, descriptions) => ({ channel, headlines, descriptions });
const DETAILS = {
  p1: {
    text: 'best crm for small teams',
    keywords: ['best crm', 'Best CRM', 'crm for small teams'],
    fanOuts: [
      { query: 'kestrel crm pricing' },
      { query: 'best crm (2026)?' },
      { query: '+crm +teams' },
    ],
    earn: { page: 'https://shop.northwind.example/small-teams', action: null },
    drafts: [
      draft('chatgpt', ['Not for Editor'], ['A ChatGPT ad']),
      draft(
        'google',
        ['Northwind CRM', 'Built for small teams', 'Try it free'],
        ['Plan, track and close.', 'Set up today.'],
      ),
      draft('microsoft', ['Northwind CRM for teams'], ['One place for every deal.']),
    ],
  },
  p2: {
    text: 'crm with outlook sync',
    keywords: ['@crm tools', '-crm free'],
    fanOuts: [],
    earn: { page: 'https://evil.example/outlook', action: null },
    drafts: [draft('google', ['+ Outlook calendar sync'], ['Your calendar, in your CRM.'])],
  },
  p3: {
    text: 'what is a crm',
    keywords: ['crm meaning'],
    fanOuts: [],
    earn: { page: null },
    drafts: [],
  },
};

beforeEach(() => {
  inserts.length = 0;
  reads.readOpportunities.mockReset().mockResolvedValue({ rows: ROWS });
  reads.readOpportunity.mockReset().mockImplementation(async ({ promptId }) => DETAILS[promptId]);
  reads.readCompetitors
    .mockReset()
    .mockResolvedValue([{ name: 'Kestrel', domain: 'kestrel.example' }]);
  db = {
    brand_domains: [
      {
        brand_id: B1,
        domain: 'shop.northwind.example',
        is_primary: false,
        brands: { organization_id: ORG },
      },
      {
        brand_id: B1,
        domain: 'northwind.example',
        is_primary: true,
        brands: { organization_id: ORG },
      },
      // The same brand id under another organization: never this brand's domain.
      {
        brand_id: B1,
        domain: 'evil.example',
        is_primary: true,
        brands: { organization_id: OTHER_ORG },
      },
    ],
  };
});

const editor = (decision = 'all') =>
  exportEditor({ brand: BRAND, orgId: ORG, userId: USER, decision, period: '30d', now: NOW });

describe('exportEditor', () => {
  it('writes this exact file for this input (golden)', async () => {
    const file = await editor();
    const group1 = 'Small teams,best crm for small teams,Paused';
    const group2 = 'Northwind,crm with outlook sync,Paused';
    expect(file.csv.split('\n')).toEqual([
      'Campaign,Ad group,Status,Keyword,Criterion Type,Headline 1,Headline 2,Headline 3,Description 1,Description 2,Final URL,Ansvisor note',
      'Small teams,,Paused,,,,,,,,,',
      `${group1},,,,,,,,,`,
      `${group1},best crm,Phrase,,,,,,,`,
      `${group1},crm for small teams,Phrase,,,,,,,`,
      `${group1},best crm 2026,Phrase,,,,,,,`,
      `${group1},+crm +teams,Phrase,,,,,,,`,
      `${group1},,,Northwind CRM,Built for small teams,Try it free,"Plan, track and close.",Set up today.,https://shop.northwind.example/small-teams,Google draft`,
      `${group1},,,Northwind CRM for teams,,,One place for every deal.,,https://shop.northwind.example/small-teams,Microsoft draft`,
      'Northwind,,Paused,,,,,,,,,',
      `${group2},,,,,,,,,`,
      `${group2},crm tools,Phrase,,,,,,,`,
      `${group2},crm free,Phrase,,,,,,,`,
      `${group2},,,'+ Outlook calendar sync,,,"Your calendar, in your CRM.",,https://northwind.example/,"Google draft. Final URL left out, not on your domains: https://evil.example/outlook"`,
      'Basics,,Paused,,,,,,,,,',
      'Basics,what is a crm,Paused,,,,,,,,,',
      'Basics,what is a crm,Paused,crm meaning,Phrase,,,,,,,',
    ]);
    expect(file).toMatchObject({
      fileName: 'google-ads-editor-all-2026-11-14.csv',
      rowCount: 16,
      prompts: 3,
      droppedUrls: 1,
    });
    // Only the prompt's own reads, without the drawer's extras.
    expect(reads.readOpportunity).toHaveBeenCalledWith({
      brand: BRAND,
      orgId: ORG,
      promptId: 'p1',
      period: '30d',
      drawer: false,
    });
    expect(reads.readCompetitors).toHaveBeenCalledWith(B1, ORG);
  });

  it('exports only the rows of the decision filter', async () => {
    const file = await editor('earn_pay');
    expect(file.fileName).toBe('google-ads-editor-earn-pay-2026-11-14.csv');
    expect(reads.readOpportunity.mock.calls.map(([a]) => a.promptId)).toEqual(['p1']);
    expect(file.csv).not.toContain('outlook');
  });

  it('logs the export: the person, the file and its rows, no personal data', async () => {
    await editor();
    expect(inserts).toEqual([
      {
        table: 'ads_activity_log',
        row: {
          organization_id: ORG,
          brand_id: B1,
          actor_user_id: USER,
          agent_run_id: null,
          chat_run_id: null,
          event: 'export.editor',
          target: { decision: 'all', period: '30d' },
          before: null,
          after: { prompts: 3, keywords: 7, ads: 3, droppedUrls: 1 },
          row_count: 16,
          file_name: 'google-ads-editor-all-2026-11-14.csv',
        },
      },
    ]);
  });
});

describe('exportOpportunity', () => {
  it("exports one prompt of the brand's, and logs it", async () => {
    const one = await exportOpportunity({
      brand: BRAND,
      orgId: ORG,
      userId: USER,
      promptId: 'p3',
      period: '7d',
      now: NOW,
    });
    expect(one).toMatchObject({
      fileName: 'google-ads-editor-prompt-p3-2026-11-14.csv',
      rowCount: 3,
      prompts: 1,
    });
    expect(inserts.map((i) => [i.row.event, i.row.target])).toEqual([
      ['export.opportunity', { promptId: 'p3', period: '7d' }],
    ]);
  });

  it("answers another brand's prompt as not found, reading and logging nothing of it", async () => {
    const err = await exportOpportunity({
      brand: BRAND,
      orgId: ORG,
      userId: USER,
      promptId: 'p9',
      period: '30d',
      now: NOW,
    }).catch((e) => e);
    expect(err.status).toBe(404);
    expect(reads.readOpportunity).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });
});
