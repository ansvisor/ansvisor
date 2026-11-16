// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Chat's direct lookups (the owner's plan of 2026-11-16, item 2: "what is
 * X?" never depends on X being on the first page of a list). A signal by
 * its code or id, a prompt by its words or id (and its performance), a
 * cited domain or page by its address, an opportunity, draft or report by
 * its title words or id: found past the first page, in every status, every
 * one asked either in the result or in not_found with a note that says so
 * plainly, and never a row of another brand or workspace. The MCP server's
 * list tools read them the same, through Chat's reads.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const data = await import('./data');
const content = await import('./content');
const { listSignalsPageFor, lookUpSignalsFor } = await import('./signal-page');
const lookup = await import('./lookup');
const { createMcpServer } = await import('./server');

const ORG = 'org-1';
const BRAND = 'b1000000-0000-4000-8000-000000000001';
/** Another brand of the same organization: its rows are never this brand's. */
const SISTER = 'b1000000-0000-4000-8000-000000000002';
/** A brand of another organization. */
const FOREIGN = 'b1000000-0000-4000-8000-000000000003';

const ALL: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: ORG,
  role: 'manager',
  apiKeyId: 'agent-internal',
  brandAccess: 'all',
};
/** A Selected-brands person this brand wasn't shared with. */
const SELECTED: McpAuthContext = { ...ALL, brandAccess: [SISTER] };

const uuid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAY = 24 * 60 * 60 * 1000;
const dayAt = (n: number) => new Date(Date.UTC(2026, 7, 1) + n * DAY).toISOString();
/** The tables a lookup read, after the brand check. */
const tablesRead = () => [...new Set(db.log.map(([table]) => table))];

/**
 * An MCP tool's answer to a client of the server, as `auth`: its JSON, or
 * its error's text. The lookups over MCP (the owner's approval of
 * 2026-11-16) answer from Chat's reads, so each is checked against them.
 */
async function callMcp(name: string, args: Record<string, unknown>, auth: McpAuthContext = ALL) {
  const server = createMcpServer(auth);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0].text;
  return {
    isError: Boolean(result.isError),
    text,
    json: result.isError ? null : JSON.parse(text),
  };
}

/** A brand of another workspace, and one not shared with the key: not found over MCP, nothing of it read. */
async function refusedOverMcp(name: string, args: Record<string, unknown>) {
  const refusals: [McpAuthContext, string][] = [
    [ALL, FOREIGN],
    [SELECTED, BRAND],
    [{ ...ALL, organizationId: null }, BRAND],
  ];
  for (const [auth, brandId] of refusals) {
    db.log = [];
    const refused = await callMcp(name, { ...args, brand_id: brandId }, auth);
    expect(refused, `${name} for ${brandId}`).toMatchObject({
      isError: true,
      text: 'Brand not found',
    });
    expect(
      db.log.filter(([table]) => table !== 'brands'),
      name,
    ).toEqual([]);
  }
}

const promptSets = (brandId: string) => ({
  brand_id: brandId,
  brands: {
    organization_id: brandId === FOREIGN ? 'org-2' : ORG,
  },
});

beforeEach(() => {
  db.tables = {
    brands: [
      { id: BRAND, organization_id: ORG, name: 'Brewline' },
      { id: SISTER, organization_id: ORG, name: 'Sister' },
      { id: FOREIGN, organization_id: 'org-2', name: 'Elsewhere' },
    ],
  };
  db.rpcs = { content_draft_last_deliveries: () => [] };
  db.log = [];
});

// ─── Signals ────────────────────────────────────────────────────────────────

/** Signal n of a brand: S-n, detected on day n, so the newest has the highest code. */
const signal = (n: number, over: Record<string, unknown> = {}) => ({
  id: uuid('5a000000', n),
  brand_id: BRAND,
  brand_no: n,
  category: 'visibility',
  kind: 'sharp_drop',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detected_at: dayAt(n),
  last_detected_at: dayAt(n),
  resolved_at: null,
  previous_value: 62,
  current_value: 41,
  change_value: -21,
  payload: {},
  kpi_keys: [],
  action_id: null,
  ...over,
});

describe('signals by their codes and ids', () => {
  beforeEach(() => {
    db.tables.signals = [
      ...Array.from({ length: 60 }, (_, i) => signal(i + 1)),
      // S-07 of the workspace's other brand, and of another workspace.
      signal(107, { brand_id: SISTER, brand_no: 7 }),
      signal(207, { brand_id: FOREIGN, brand_no: 7 }),
    ];
    db.tables.signals[6] = signal(7, { status: 'resolved', resolved_at: dayAt(9) });
    db.tables.prompts = [];
  });

  it('finds a code however it is written, past the first page, in every status and date', async () => {
    const page = await listSignalsPageFor(ALL, { brandId: BRAND });
    expect(page).toMatchObject({ total: 60, next_offset: 50 });
    const codes = page!.signals.map((s) => s.code);
    expect(codes.slice(0, 2)).toEqual(['S-60', 'S-59']);
    expect(codes).not.toContain('S-07');

    const found = await lookUpSignalsFor(ALL, {
      brandId: BRAND,
      codes: ['S-07', 's 12', 's3', '#45', '60', 'S-012'],
    });
    expect(found!.signals.map((s) => [s.asked, s.code, s.matched])).toEqual([
      ['S-07', 'S-07', 'its code'],
      ['s 12', 'S-12', 'its code'],
      ['s3', 'S-03', 'its code'],
      ['#45', 'S-45', 'its code'],
      ['60', 'S-60', 'its code'],
    ]);
    expect(found!.signals[0]).toMatchObject({
      id: uuid('5a000000', 7),
      title: 'Visibility dropped sharply',
      status: 'resolved',
      detected: '2026-08-08',
    });
    expect(found!.not_found).toEqual([]);
    expect(found!.note).toContain('S-07: one signal, by its code.');
    expect(found!.note).toContain(
      "Looked in this brand's signals, every status and every date. Name each signal by its title, with its code.",
    );
  });

  it('finds a signal by its id, whatever its case', async () => {
    const found = await lookUpSignalsFor(ALL, {
      brandId: BRAND,
      ids: [uuid('5a000000', 33).toUpperCase()],
    });
    expect(found!.signals.map((s) => [s.code, s.matched])).toEqual([['S-33', 'its id']]);
  });

  it("never reads another brand's signal, of the workspace or another one", async () => {
    const found = await lookUpSignalsFor(ALL, {
      brandId: BRAND,
      codes: ['S-07'],
      ids: [uuid('5a000000', 107), uuid('5a000000', 207)],
    });
    expect(found!.signals.map((s) => s.id)).toEqual([uuid('5a000000', 7)]);
    expect(found!.not_found).toEqual([uuid('5a000000', 107), uuid('5a000000', 207)]);
    // A brand id of another workspace: not found, nothing of it read.
    db.log = [];
    expect(await lookUpSignalsFor(ALL, { brandId: FOREIGN, codes: ['S-07'] })).toBeNull();
    expect(tablesRead()).toEqual(['brands']);
  });

  it('says a code it has not is not found, plainly, and never offers others', async () => {
    const found = await lookUpSignalsFor(ALL, { brandId: BRAND, codes: ['S-99', 'hello'] });
    expect(found).toMatchObject({ signals: [], not_found: ['S-99', 'hello'] });
    expect(found!.note).toContain(
      'S-99: no signal of this brand has this code (codes are per brand).',
    );
    expect(found!.note).toContain('"hello" is not a signal code.');
    expect(found!.note).toContain(
      'say plainly that this brand has no such signal, and where you looked; never offer other signals as the closest or similar.',
    );
  });

  it('returns every signal a code names, never one picked', async () => {
    db.tables.signals.push(signal(70, { brand_no: 7 }));
    const found = await lookUpSignalsFor(ALL, { brandId: BRAND, codes: ['S-07'] });
    expect(found!.signals.map((s) => s.id)).toEqual([uuid('5a000000', 7), uuid('5a000000', 70)]);
    expect(found!.note).toContain(
      'S-07 names 2 signals: name each and say which is which; never pick one.',
    );
  });

  it('reads nothing of a brand not shared with the person', async () => {
    expect(await lookUpSignalsFor(SELECTED, { brandId: BRAND, codes: ['S-07'] })).toBeNull();
    expect(tablesRead()).toEqual(['brands']);
  });

  it("names a signal's actions by the codes the app shows", async () => {
    const action = uuid('ac000000', 1);
    db.tables.signals[6] = signal(7, { action_id: action });
    db.tables.action_signals = [
      {
        signal_id: uuid('5a000000', 7),
        linked_at: dayAt(8),
        actions: {
          id: action,
          action_no: 1497,
          brand_no: 3,
          kind: 'chat_finding',
          status: 'new',
          brand_id: BRAND,
          deleted_at: null,
        },
      },
    ];
    const found = await lookUpSignalsFor(ALL, { brandId: BRAND, codes: ['S-07'] });
    expect(found!.signals[0].actions).toEqual(['AC-03']);
  });

  // MCP's list_signals reads codes and ids as Chat does.
  describe('over MCP list_signals', () => {
    it('finds codes and ids past the first page, whatever status, kind or limit it is given', async () => {
      const list = await callMcp('list_signals', { brand_id: BRAND });
      expect(list.json).toHaveLength(50);
      expect(list.json.map((s: { id: string }) => s.id)).not.toContain(uuid('5a000000', 7));

      const asked = { codes: ['S-07', 's 12', '#45'], ids: [uuid('5a000000', 33)] };
      const found = await callMcp('list_signals', {
        brand_id: BRAND,
        ...asked,
        status: 'dismissed',
        kind: 'competitor_gain',
        limit: 1,
      });
      expect(found.json).toEqual(await lookUpSignalsFor(ALL, { brandId: BRAND, ...asked }));
      expect(
        found.json.signals.map((s: Record<string, string>) => [
          s.asked,
          s.code,
          s.status,
          s.matched,
        ]),
      ).toEqual([
        ['S-07', 'S-07', 'resolved', 'its code'],
        ['s 12', 'S-12', 'new', 'its code'],
        ['#45', 'S-45', 'new', 'its code'],
        [uuid('5a000000', 33), 'S-33', 'new', 'its id'],
      ]);
      // S-07 of this brand, never the workspace's other brand's or another workspace's.
      expect(found.json.signals[0].id).toBe(uuid('5a000000', 7));
      expect(found.json.not_found).toEqual([]);
    });

    it("says what it didn't find plainly, and never reads another brand's signal", async () => {
      const found = await callMcp('list_signals', {
        brand_id: BRAND,
        codes: ['S-99'],
        ids: [uuid('5a000000', 107), uuid('5a000000', 207)],
      });
      expect(found.json).toMatchObject({
        signals: [],
        not_found: ['S-99', uuid('5a000000', 107), uuid('5a000000', 207)],
      });
      expect(found.json.note).toContain(
        'S-99: no signal of this brand has this code (codes are per brand).',
      );
      expect(found.json.note).toContain('never offer other signals as the closest or similar.');
    });

    it('answers a brand of another workspace, or one not shared, as not found', async () => {
      await refusedOverMcp('list_signals', { codes: ['S-07'], ids: [uuid('5a000000', 7)] });
    });
  });
});

// ─── Prompts ────────────────────────────────────────────────────────────────

const prompt = (n: number, text: string, over: Record<string, unknown> = {}) => ({
  id: uuid('a1000000', n),
  text,
  topic_id: null,
  platforms: ['chatgpt'],
  models: [],
  regions: ['US'],
  is_active: true,
  created_at: dayAt(n),
  prompt_sets: promptSets(BRAND),
  topics: null,
  ...over,
});

const SKIP = 'Which coffee subscription lets you skip a month?';

describe('prompts by their words and ids', () => {
  beforeEach(() => {
    const special = new Map(
      [
        // Old, paused and in a topic: past the list's first page of the newest 50.
        prompt(5, SKIP, { is_active: false, topic_id: uuid('70000000', 1) }),
        prompt(6, '100% organic_beans for cold brew'),
        prompt(8, '100% organicXbeans for espresso'),
      ].map((row) => [row.id, row]),
    );
    db.tables.prompts = [
      ...Array.from(
        { length: 120 },
        (_, i) =>
          special.get(uuid('a1000000', i + 1)) ??
          prompt(i + 1, `Best coffee beans number ${i + 1}`),
      ),
      prompt(301, SKIP, { prompt_sets: promptSets(SISTER) }),
      prompt(302, SKIP, { prompt_sets: promptSets(FOREIGN) }),
    ];
  });

  it('finds one by a few of its words, in any order and case, past the first page, paused too', async () => {
    const page = await data.promptsPageFor(ALL, { brandId: BRAND, limit: 50 });
    expect(page!.rows.map((p) => p.id)).not.toContain(uuid('a1000000', 5));

    const found = await data.lookUpPromptsFor(ALL, {
      brandId: BRAND,
      search: 'SKIP subscription month?',
    });
    expect(found).toMatchObject({
      total: 1,
      offset: 0,
      next_offset: null,
      not_found: [],
      prompts: [{ id: uuid('a1000000', 5), text: SKIP, is_active: false }],
    });
    expect(found!.note).toContain(
      `1 prompt in this brand's tracked prompts, active and paused, in every topic has all of these words: "SKIP", "subscription", "month".`,
    );
  });

  it('reads % and _ as text, and never sends a * that PostgREST would read as a wildcard', async () => {
    const found = await data.lookUpPromptsFor(ALL, { brandId: BRAND, search: 'organic_beans' });
    expect(found!.prompts.map((p) => p.id)).toEqual([uuid('a1000000', 6)]);
    expect(lookup.containsPattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
    expect(lookup.searchWords('cof*fee  "skip," SKIP a*')).toEqual(['cof', 'fee', 'skip', 'a']);
    // Only a wildcard: no words, nothing read but the brand, and the search is not found.
    db.log = [];
    const none = await data.lookUpPromptsFor(ALL, { brandId: BRAND, search: '**' });
    expect(none).toMatchObject({ prompts: [], total: 0, not_found: ['**'] });
    expect(tablesRead()).toEqual(['brands']);
  });

  it('caps a search at its first 200 characters and 8 words', () => {
    expect(
      lookup.searchWords(Array.from({ length: 12 }, (_, i) => `w${i}`).join(' ')),
    ).toHaveLength(lookup.SEARCH_MAX_WORDS);
    expect(lookup.searchWords(`${'x'.repeat(250)} tail`)).toEqual(['x'.repeat(200)]);
  });

  it("finds one by its id, never another brand's, and says what it didn't find", async () => {
    const found = await data.lookUpPromptsFor(ALL, {
      brandId: BRAND,
      ids: [uuid('a1000000', 7).toUpperCase(), uuid('a1000000', 301), uuid('a1000000', 302)],
    });
    expect(found!.prompts.map((p) => [p.id, (p as { matched?: string }).matched])).toEqual([
      [uuid('a1000000', 7), 'its id'],
    ]);
    expect(found!.not_found).toEqual([uuid('a1000000', 301), uuid('a1000000', 302)]);
    expect(found!.note).toContain(`${uuid('a1000000', 301)}: no prompt of this brand has this id.`);
  });

  it('reads ids and words together, each prompt once, the ids first', async () => {
    const found = await data.lookUpPromptsFor(ALL, {
      brandId: BRAND,
      ids: [uuid('a1000000', 5), uuid('a1000000', 9)],
      search: 'skip a month',
    });
    expect(found!.prompts.map((p) => p.id)).toEqual([uuid('a1000000', 5), uuid('a1000000', 9)]);
    expect(found).toMatchObject({ total: 1, not_found: [] });
  });

  it('pages a search with more matches than a page, never cut by a smaller limit', async () => {
    // 117 of the 120 are "Best coffee beans number n".
    const first = await data.lookUpPromptsFor(ALL, { brandId: BRAND, search: 'coffee beans' });
    expect(first).toMatchObject({ total: 117, offset: 0, next_offset: 50 });
    expect(first!.prompts).toHaveLength(50);
    expect(first!.note).toContain('This page shows 1–50. Read the next page with offset 50.');
    const last = await data.lookUpPromptsFor(ALL, {
      brandId: BRAND,
      search: 'coffee beans',
      offset: 100,
    });
    expect(last).toMatchObject({ total: 117, offset: 100, next_offset: null });
    expect(last!.prompts).toHaveLength(17);
    expect(last!.note).toContain('This page shows 101–117. This is the last page.');
  });

  it('says plainly when no prompt has the words, after trying fewer', async () => {
    const found = await data.lookUpPromptsFor(ALL, { brandId: BRAND, search: 'cold brew tonic' });
    expect(found).toMatchObject({ prompts: [], total: 0, not_found: ['cold brew tonic'] });
    expect(found!.note).toContain('search again with fewer or shorter words');
    expect(found!.note).toContain('Never offer other prompts as the closest or similar.');
  });

  it('reads nothing of a brand not shared with the person', async () => {
    expect(await data.lookUpPromptsFor(SELECTED, { brandId: BRAND, search: 'skip' })).toBeNull();
    expect(tablesRead()).toEqual(['brands']);
  });

  // MCP's list_prompts reads words and ids as Chat does.
  describe('over MCP list_prompts', () => {
    it('finds one by its words past the first page, whatever topic, state or limit it is given', async () => {
      const list = await callMcp('list_prompts', { brand_id: BRAND });
      expect(list.json).toHaveLength(100);
      expect(list.json.map((p: { id: string }) => p.id)).not.toContain(uuid('a1000000', 5));

      const asked = {
        search: 'SKIP subscription month?',
        ids: [uuid('a1000000', 7), uuid('a1000000', 301), uuid('a1000000', 302)],
      };
      const found = await callMcp('list_prompts', {
        brand_id: BRAND,
        ...asked,
        topic_id: uuid('70000000', 9),
        is_active: true,
        limit: 1,
      });
      expect(found.json).toEqual(await data.lookUpPromptsFor(ALL, { brandId: BRAND, ...asked }));
      expect(found.json.prompts.map((p: { id: string }) => p.id)).toEqual([
        uuid('a1000000', 7),
        uuid('a1000000', 5),
      ]);
      expect(found.json.prompts[1]).toMatchObject({ text: SKIP, is_active: false });
      // Another brand's prompt, of the workspace or another one, is not found.
      expect(found.json.not_found).toEqual([uuid('a1000000', 301), uuid('a1000000', 302)]);
    });

    it('pages a search by offset, never cut by limit', async () => {
      const last = await callMcp('list_prompts', {
        brand_id: BRAND,
        search: 'coffee beans',
        offset: 100,
        limit: 5,
      });
      expect(last.json).toEqual(
        await data.lookUpPromptsFor(ALL, { brandId: BRAND, search: 'coffee beans', offset: 100 }),
      );
      expect(last.json).toMatchObject({ total: 117, offset: 100, next_offset: null });
      expect(last.json.prompts).toHaveLength(17);
    });

    it('says plainly when no prompt has the words', async () => {
      const found = await callMcp('list_prompts', { brand_id: BRAND, search: 'cold brew tonic' });
      expect(found.json).toMatchObject({ prompts: [], total: 0, not_found: ['cold brew tonic'] });
      expect(found.json.note).toContain('Never offer other prompts as the closest or similar.');
    });

    it('answers a brand of another workspace, or one not shared, as not found', async () => {
      await refusedOverMcp('list_prompts', { search: 'skip', ids: [uuid('a1000000', 5)] });
    });
  });
});

describe("a prompt's performance by its id", () => {
  const rpcArgs: Record<string, unknown>[] = [];
  beforeEach(() => {
    rpcArgs.length = 0;
    db.tables.prompts = [
      ...Array.from({ length: 12 }, (_, i) => prompt(i + 1, `Prompt ${i + 1}`)),
      prompt(301, 'Sister prompt', { prompt_sets: promptSets(SISTER) }),
    ];
    // Prompts 1–10 have answers in the window; 11 and 12 none.
    db.rpcs.prompt_performance_aggregates = (args) => {
      rpcArgs.push(args);
      return Array.from({ length: 10 }, (_, i) => ({
        prompt_id: uuid('a1000000', i + 1),
        prompt_text: `Prompt ${i + 1}`,
        topic_name: null,
        result_count: 4,
        sum_visibility: 40 * (i + 1),
        total_mentions: i,
        total_citations: i,
        comp_sum_visibility: 0,
        comp_count: 0,
      }));
    };
  });

  it('reads every prompt named, whatever its topic or the page, and says which had no answers', async () => {
    const found = await data.lookUpPromptPerformanceFor(ALL, {
      brandId: BRAND,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      promptIds: [uuid('a1000000', 2), uuid('a1000000', 11), uuid('a1000000', 301)],
    });
    expect(rpcArgs[0]).toMatchObject({ p_brand_id: BRAND, p_topic_id: null });
    expect(found!.prompts.map((p) => [p.prompt_id, p.avg_visibility])).toEqual([
      [uuid('a1000000', 2), 20],
    ]);
    expect(found!.no_results).toEqual([
      { prompt_id: uuid('a1000000', 11), prompt_text: 'Prompt 11' },
    ]);
    expect(found!.not_found).toEqual([uuid('a1000000', 301)]);
    expect(found!.note).toContain('One prompt has no answers in this period');
  });

  it('is never cut to a page or a limit', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => uuid('a1000000', i + 1));
    const read = await data.getPromptPerformanceFor(ALL, {
      brandId: BRAND,
      promptIds: ids,
      topicId: uuid('70000000', 1),
      limit: 1,
      offset: 5,
    });
    expect(read!.prompts).toHaveLength(10);
    expect(rpcArgs[0]).toMatchObject({ p_topic_id: null });
  });

  it('over MCP get_prompt_performance: reads the prompts named, whatever topic, sort or limit, as Chat does', async () => {
    const period = { date_from: '2026-10-01', date_to: '2026-10-31' };
    const promptIds = [uuid('a1000000', 2), uuid('a1000000', 11), uuid('a1000000', 301)];
    const found = await callMcp('get_prompt_performance', {
      brand_id: BRAND,
      ...period,
      prompt_ids: promptIds,
      topic_id: uuid('70000000', 1),
      sort_by: 'mentions',
      order: 'asc',
      limit: 1,
    });
    expect(rpcArgs[0]).toMatchObject({ p_brand_id: BRAND, p_topic_id: null });
    expect(found.json).toEqual(
      await data.lookUpPromptPerformanceFor(ALL, {
        brandId: BRAND,
        dateFrom: period.date_from,
        dateTo: period.date_to,
        promptIds,
      }),
    );
    expect(found.json.prompts.map((p: { prompt_id: string }) => p.prompt_id)).toEqual([
      uuid('a1000000', 2),
    ]);
    expect(found.json.no_results).toEqual([
      { prompt_id: uuid('a1000000', 11), prompt_text: 'Prompt 11' },
    ]);
    expect(found.json.not_found).toEqual([uuid('a1000000', 301)]);
    expect(found.json.note).toContain('never offer other prompts as the closest or similar');
    await refusedOverMcp('get_prompt_performance', { prompt_ids: [uuid('a1000000', 2)] });
  });
});

// ─── Citations ──────────────────────────────────────────────────────────────

describe('cited domains and pages by their address', () => {
  /** An answer of a brand's prompt in October, citing these addresses. */
  const answer = (n: number, urls: string[], over: Record<string, unknown> = {}) => ({
    id: uuid('e0000000', n),
    brand_id: BRAND,
    prompt_id: uuid('a1000000', 5),
    platform: 'chatgpt',
    model_used: 'gpt',
    region: 'US',
    created_at: '2026-10-10T10:00:00.000Z',
    citations: urls.map((url) => ({ url, title: `Title of ${url}` })),
    citation_count: urls.length,
    ...over,
  });

  beforeEach(() => {
    db.tables.brand_domains = [{ brand_id: BRAND, domain: 'brewline.example' }];
    db.tables.competitors = [{ brand_id: BRAND, domain: 'northbound.example' }];
    db.tables.prompts = [prompt(5, SKIP), prompt(6, 'Freshest whole bean coffee delivered')];
    // 60 domains cited more than beanbulletin.example: it is past the first page of 50.
    db.tables.prompt_results = [
      ...Array.from({ length: 60 }, (_, i) =>
        answer(
          i + 1,
          Array.from({ length: 3 }, (_, k) => `https://site${i + 1}.example/page-${k}`),
          { prompt_id: uuid('a1000000', 6) },
        ),
      ),
      answer(101, [
        'https://www.beanbulletin.example/best-coffee-subscriptions/?utm=x',
        'https://northbound.example/guide',
      ]),
      answer(102, ['https://beanbulletin.example/best-coffee-subscriptions']),
      answer(103, ['https://blog.beanbulletin.example/roasters'], {
        prompt_id: uuid('a1000000', 6),
      }),
      // Another brand's answers, and one outside the window: never counted.
      ...Array.from({ length: 5 }, (_, i) =>
        answer(200 + i, ['https://beanbulletin.example/best-coffee-subscriptions'], {
          brand_id: SISTER,
        }),
      ),
      answer(300, ['https://beanbulletin.example/best-coffee-subscriptions'], {
        created_at: '2026-09-01T10:00:00.000Z',
      }),
    ];
  });

  /**
   * The Citations page's daily functions (00118) over these answers, as the
   * rollups add them up: by domain (its host, "www." aside), the brand's
   * answers of the days only, chatgpt-shopping aside, most cited first.
   */
  beforeEach(() => {
    type Answer = ReturnType<typeof answer>;
    const ofDays = (args: Record<string, unknown>) =>
      ((db.tables.prompt_results ?? []) as Answer[]).filter((row) => {
        const day = row.created_at.slice(0, 10);
        return (
          row.brand_id === args.p_brand_id &&
          row.platform !== 'chatgpt-shopping' &&
          (!args.p_day_from || day >= String(args.p_day_from)) &&
          (!args.p_day_to || day <= String(args.p_day_to))
        );
      });
    db.rpcs.citations_window_stats_daily = (args) => [
      { results: ofDays(args).length, regions: [] },
    ];
    db.rpcs.citations_domains_daily = (args) => {
      const by = new Map<string, { total: number; results: Set<string>; models: Set<string> }>();
      for (const row of ofDays(args)) {
        for (const cite of row.citations) {
          const domain = new URL(cite.url).hostname.toLowerCase().replace(/^www\./, '');
          const agg = by.get(domain) ?? { total: 0, results: new Set(), models: new Set() };
          agg.total += 1;
          agg.results.add(row.id);
          agg.models.add(row.model_used);
          by.set(domain, agg);
        }
      }
      return [...by]
        .map(([domain, agg]) => ({
          domain,
          total_citations: agg.total,
          results_citing: agg.results.size,
          models: [...agg.models],
        }))
        .sort((a, b) => b.total_citations - a.total_citations);
    };
  });

  const window = { brandId: BRAND, dateFrom: '2026-10-01', dateTo: '2026-10-31' };
  /** The answers a citations read selected: one bounded request, whatever it found. */
  const answerReads = () =>
    db.log.filter(([table, kind]) => table === 'prompt_results' && kind === 'select').length;

  it('finds a domain however it is written, past the first page, with its subdomains, pages and prompts', async () => {
    const page = await data.listCitationsFor(ALL, { ...window, limit: 50 });
    expect(page!.totals.domains).toBe(63);
    expect(page!.top_domains.map((d) => d.domain)).not.toContain('beanbulletin.example');

    const found = await data.lookUpCitationsFor(ALL, {
      ...window,
      domains: ['https://www.BeanBulletin.example/', 'beanbulletin.example'],
    });
    expect(found!.domains.map((d) => [d.asked, d.domain, d.matched, d.total_citations])).toEqual([
      ['https://www.BeanBulletin.example/', 'beanbulletin.example', 'the domain', 2],
      ['https://www.BeanBulletin.example/', 'blog.beanbulletin.example', 'a subdomain', 1],
    ]);
    expect(found!.domains[0]).toMatchObject({
      category: 'other',
      results_citing: 2,
      // The page cited with and without "www.", as the Citations page lists it.
      pages_total: 2,
      top_pages: [
        { url: 'https://www.beanbulletin.example/best-coffee-subscriptions', total_citations: 1 },
        { url: 'https://beanbulletin.example/best-coffee-subscriptions', total_citations: 1 },
      ],
      prompts: [{ prompt_id: uuid('a1000000', 5), text: SKIP, answers: 2 }],
      prompts_total: 1,
    });
    expect(found!.not_found).toEqual([]);
    // The domains from the page's rollups, the pages and prompts from one read of the answers.
    expect(answerReads()).toBe(2);
    expect(db.log.filter(([, kind]) => kind === 'rpc').map(([fn]) => fn)).toEqual([
      'citations_domains_daily',
      'citations_window_stats_daily',
      'citations_domains_daily',
      'citations_window_stats_daily',
    ]);
    expect(found!.period).toEqual({ date_from: '2026-10-01', date_to: '2026-10-31' });
    expect(found!.note).toContain(
      "Looked in this brand's AI answers from 2026-10-01 to 2026-10-31, every source type",
    );
  });

  it('finds a page by its address with or without its scheme, www and trailing slash', async () => {
    const found = await data.lookUpCitationsFor(ALL, {
      ...window,
      urls: [
        'beanbulletin.example/best-coffee-subscriptions',
        'http://www.beanbulletin.example/best-coffee-subscriptions/',
      ],
    });
    // Two ways of writing one page: one lookup, finding both addresses it was cited by.
    expect(found!.urls.map((u) => [u.asked, u.url, u.total_citations])).toEqual([
      [
        'beanbulletin.example/best-coffee-subscriptions',
        'https://www.beanbulletin.example/best-coffee-subscriptions',
        1,
      ],
      [
        'beanbulletin.example/best-coffee-subscriptions',
        'https://beanbulletin.example/best-coffee-subscriptions',
        1,
      ],
    ]);
    expect(found!.note).toContain(
      'beanbulletin.example/best-coffee-subscriptions: cited, as 2 addresses.',
    );
    expect(found!.urls[0].prompts).toEqual([
      { prompt_id: uuid('a1000000', 5), text: SKIP, answers: 1 },
    ]);
  });

  it('reads every source type, whatever filter the list had', async () => {
    const found = await data.lookUpCitationsFor(ALL, {
      ...window,
      domains: ['northbound.example', 'site3.example'],
    });
    expect(found!.domains.map((d) => [d.domain, d.category])).toEqual([
      ['northbound.example', 'competitor'],
      ['site3.example', 'other'],
    ]);
  });

  it("says what isn't cited in the period, plainly, with whether its domain is", async () => {
    const found = await data.lookUpCitationsFor(ALL, {
      ...window,
      domains: ['nowhere.example', 'not a domain'],
      urls: ['https://beanbulletin.example/other', 'https://nowhere.example/x'],
    });
    expect(found).toMatchObject({
      domains: [],
      urls: [],
      not_found: [
        'nowhere.example',
        'not a domain',
        'https://beanbulletin.example/other',
        'https://nowhere.example/x',
      ],
    });
    expect(found!.note).toContain('nowhere.example: not cited in these answers.');
    expect(found!.note).toContain('"not a domain" is not a domain.');
    expect(found!.note).toContain(
      'https://beanbulletin.example/other: this page is not cited in these answers; its domain beanbulletin.example is, 2 times, on other pages.',
    );
    expect(found!.note).toContain(
      'https://nowhere.example/x: not cited in these answers, nor is its domain nowhere.example.',
    );
    expect(found!.note).toContain('never offer other domains or pages as the closest or similar');
  });

  it('reads nothing of a brand not shared with the person', async () => {
    expect(
      await data.lookUpCitationsFor(SELECTED, { ...window, domains: ['beanbulletin.example'] }),
    ).toBeNull();
    expect(tablesRead()).toEqual(['brands']);
  });

  it('keys a domain and an address as the citations read does', () => {
    for (const text of [
      'example.com',
      'WWW.Example.com',
      'https://www.example.com/',
      'http://example.com/a?b=1',
    ]) {
      expect(lookup.citedDomainKey(text), text).toBe('example.com');
    }
    expect(lookup.citedDomainKey('localhost')).toBeNull();
    expect(lookup.citedDomainKey('two words.com')).toBeNull();
    expect(lookup.citedUrlKey('www.example.com/a/b/?x=1#y')).toBe('example.com/a/b');
    expect(lookup.citedUrlKey('https://example.com')).toBe('example.com');
    expect(lookup.citedUrlKey('nonsense')).toBeNull();
  });

  // MCP's list_citations reads domains and addresses as Chat does.
  describe('over MCP list_citations', () => {
    const mcpWindow = { brand_id: BRAND, date_from: '2026-10-01', date_to: '2026-10-31' };

    it('finds a domain and a page past the top ones, whatever source filter or limit it is given', async () => {
      const list = await callMcp('list_citations', { ...mcpWindow, limit: 50 });
      expect(list.json.top_domains.map((d: { domain: string }) => d.domain)).not.toContain(
        'beanbulletin.example',
      );

      const asked = {
        domains: ['https://www.BeanBulletin.example/'],
        urls: ['beanbulletin.example/best-coffee-subscriptions'],
      };
      const found = await callMcp('list_citations', {
        ...mcpWindow,
        ...asked,
        source_filter: 'owned',
        limit: 1,
      });
      expect(found.json).toEqual(await data.lookUpCitationsFor(ALL, { ...window, ...asked }));
      expect(found.json.domains.map((d: { domain: string }) => d.domain)).toEqual([
        'beanbulletin.example',
        'blog.beanbulletin.example',
      ]);
      // Two pages for one address, the other brand's and September's answers never counted.
      expect(
        found.json.urls.map((u: { url: string; total_citations: number }) => [
          u.url,
          u.total_citations,
        ]),
      ).toEqual([
        ['https://www.beanbulletin.example/best-coffee-subscriptions', 1],
        ['https://beanbulletin.example/best-coffee-subscriptions', 1],
      ]);
      expect(found.json.not_found).toEqual([]);
    });

    it("says what isn't cited in the period, plainly", async () => {
      const found = await callMcp('list_citations', {
        ...mcpWindow,
        domains: ['nowhere.example'],
        urls: ['https://beanbulletin.example/other'],
      });
      expect(found.json).toMatchObject({
        domains: [],
        urls: [],
        not_found: ['nowhere.example', 'https://beanbulletin.example/other'],
      });
      expect(found.json.note).toContain(
        'never offer other domains or pages as the closest or similar',
      );
    });

    it('answers a brand of another workspace, or one not shared, as not found', async () => {
      await refusedOverMcp('list_citations', {
        domains: ['beanbulletin.example'],
        urls: ['https://beanbulletin.example/best-coffee-subscriptions'],
      });
    });
  });
});

// ─── Opportunities, drafts and reports ──────────────────────────────────────

describe('content opportunities by their title words and ids', () => {
  const opportunity = (n: number, title: string, over: Record<string, unknown> = {}) => ({
    id: uuid('aa000000', n),
    brand_id: BRAND,
    title,
    description: null,
    type: 'owned',
    impact: 'medium',
    opportunity_score: 200 - n,
    status: 'new',
    prompt_id: null,
    created_at: dayAt(n),
    updated_at: dayAt(n),
    brief: null,
    prompts: null,
    ...over,
  });

  beforeEach(() => {
    db.tables.content_opportunities = [
      ...Array.from({ length: 80 }, (_, i) => opportunity(i + 1, `Answer page ${i + 1}`)),
      // Lowest score and archived: never on the list's pages.
      opportunity(150, 'Coffee storage guide refresh 2024', { status: 'archived' }),
      opportunity(151, '50% off_cold brew page'),
      opportunity(152, '50% offXcold brew page'),
      opportunity(301, 'Coffee storage guide refresh 2024', { brand_id: SISTER }),
      opportunity(302, 'Coffee storage guide refresh 2024', { brand_id: FOREIGN }),
    ];
  });

  it('finds one by its title words past the first page, archived too, a year aside', async () => {
    const page = await data.contentOpportunitiesPageFor(ALL, { brandId: BRAND, limit: 50 });
    expect(page!.rows.map((o) => o.id)).not.toContain(uuid('aa000000', 150));

    const found = await data.lookUpOpportunitiesFor(ALL, {
      brandId: BRAND,
      search: 'STORAGE guide 2026',
    });
    expect(found).toMatchObject({
      total: 1,
      not_found: [],
      opportunities: [{ id: uuid('aa000000', 150), status: 'archived' }],
    });
    const escaped = await data.lookUpOpportunitiesFor(ALL, { brandId: BRAND, search: 'off_cold' });
    expect(escaped!.opportunities.map((o) => o.id)).toEqual([uuid('aa000000', 151)]);
  });

  it("finds one by its id, never another brand's", async () => {
    const found = await data.lookUpOpportunitiesFor(ALL, {
      brandId: BRAND,
      ids: [uuid('aa000000', 150), uuid('aa000000', 301), uuid('aa000000', 302)],
    });
    expect(found!.opportunities.map((o) => o.id)).toEqual([uuid('aa000000', 150)]);
    expect(found!.not_found).toEqual([uuid('aa000000', 301), uuid('aa000000', 302)]);
    expect(found!.note).toContain(
      "Looked in this brand's content opportunities, every status, archived included.",
    );
  });

  it('reads nothing of a brand not shared with the person', async () => {
    expect(await data.lookUpOpportunitiesFor(SELECTED, { brandId: BRAND, search: 'x' })).toBeNull();
    expect(tablesRead()).toEqual(['brands']);
  });

  it('over MCP list_content_opportunities: finds one past the first page, archived too, whatever filter or limit, as Chat does', async () => {
    const list = await callMcp('list_content_opportunities', { brand_id: BRAND });
    expect(list.json.map((o: { id: string }) => o.id)).not.toContain(uuid('aa000000', 150));

    const asked = {
      search: 'STORAGE guide 2026',
      ids: [uuid('aa000000', 3), uuid('aa000000', 301), uuid('aa000000', 302)],
    };
    const found = await callMcp('list_content_opportunities', {
      brand_id: BRAND,
      ...asked,
      status: 'new',
      impact: 'high',
      type: 'earned',
      limit: 1,
    });
    expect(found.json).toEqual(
      await data.lookUpOpportunitiesFor(ALL, { brandId: BRAND, ...asked }),
    );
    expect(
      found.json.opportunities.map((o: { id: string; status: string }) => [o.id, o.status]),
    ).toEqual([
      [uuid('aa000000', 3), 'new'],
      [uuid('aa000000', 150), 'archived'],
    ]);
    expect(found.json.not_found).toEqual([uuid('aa000000', 301), uuid('aa000000', 302)]);
    expect(found.json.note).toContain('never offer other opportunities as the closest or similar.');
    await refusedOverMcp('list_content_opportunities', { search: 'storage guide' });
  });
});

describe('drafts by their title words and ids', () => {
  const draft = (n: number, title: string, over: Record<string, unknown> = {}) => ({
    id: uuid('a4000000', n),
    brand_id: BRAND,
    title,
    status: 'draft',
    method: 'create',
    page_type: null,
    author: 'Chat',
    source_url: null,
    updated_at: dayAt(n),
    archived_at: null,
    shopping_path: null,
    content_shopping_checks: [],
    ...over,
  });

  beforeEach(() => {
    db.tables.content_drafts = [
      ...Array.from({ length: 60 }, (_, i) => draft(i + 1, `Guide ${i + 1}`)),
      draft(0, 'Coffee gift boxes for the holidays', { archived_at: dayAt(70), status: 'ready' }),
      draft(301, 'Coffee gift boxes for the holidays', { brand_id: SISTER }),
    ];
    db.tables.content_draft_suggestions = [];
  });

  it('finds one by its title words, an archived one marked, its join left out', async () => {
    const page = await content.contentDraftsPageFor(ALL, BRAND, undefined, {});
    expect(page!.rows.map((d) => d.id)).not.toContain(uuid('a4000000', 0));

    const found = await content.lookUpDraftsFor(ALL, { brandId: BRAND, search: 'GIFT boxes' });
    expect(found).toMatchObject({ total: 1, not_found: [] });
    expect(found!.drafts).toEqual([
      expect.objectContaining({ id: uuid('a4000000', 0), status: 'ready', archived: true }),
    ]);
    expect(found!.drafts[0]).not.toHaveProperty('brands');
    expect(found!.drafts[0]).not.toHaveProperty('archived_at');
    // A page of the Library keeps its rows as they were.
    expect(page!.rows[0]).not.toHaveProperty('archived');
  });

  it("finds one by its id, never another brand's", async () => {
    const found = await content.lookUpDraftsFor(ALL, {
      brandId: BRAND,
      ids: [uuid('a4000000', 12), uuid('a4000000', 301)],
    });
    expect(found!.drafts.map((d) => d.id)).toEqual([uuid('a4000000', 12)]);
    expect(found!.not_found).toEqual([uuid('a4000000', 301)]);
  });

  it('reads nothing of a brand not shared with the person', async () => {
    expect(
      await content.lookUpDraftsFor(SELECTED, { brandId: BRAND, ids: [uuid('a4000000', 1)] }),
    ).toBeNull();
    expect(tablesRead()).toEqual(['brands']);
  });

  it('over MCP list_content_drafts: finds one past the first page, archived too, whatever status, as Chat does', async () => {
    const list = await callMcp('list_content_drafts', { brand_id: BRAND });
    expect(list.json.map((d: { id: string }) => d.id)).not.toContain(uuid('a4000000', 0));

    const asked = { search: 'GIFT boxes', ids: [uuid('a4000000', 12), uuid('a4000000', 301)] };
    const found = await callMcp('list_content_drafts', {
      brand_id: BRAND,
      ...asked,
      status: 'published',
    });
    expect(found.json).toEqual(await content.lookUpDraftsFor(ALL, { brandId: BRAND, ...asked }));
    expect(found.json.drafts.map((d: { id: string }) => d.id)).toEqual([
      uuid('a4000000', 12),
      uuid('a4000000', 0),
    ]);
    expect(found.json.drafts[1]).toMatchObject({ status: 'ready', archived: true });
    expect(found.json.not_found).toEqual([uuid('a4000000', 301)]);
    await refusedOverMcp('list_content_drafts', { search: 'gift boxes' });
  });
});

describe('reports by their title words and ids', () => {
  const report = (n: number, title: string, over: Record<string, unknown> = {}) => ({
    id: uuid('ae000000', n),
    brand_id: BRAND,
    title,
    template: 'weekly',
    date_from: '2026-10-01',
    date_to: '2026-10-07',
    created_at: dayAt(n),
    ...over,
  });

  beforeEach(() => {
    db.tables.reports = [
      ...Array.from({ length: 60 }, (_, i) => report(i + 1, `Weekly AI visibility ${i + 1}`)),
      report(0, 'Competitor benchmark for Q3', { template: 'competitor_benchmark' }),
      report(301, 'Competitor benchmark for Q3', { brand_id: SISTER }),
    ];
  });

  it('finds one by its title words past the first page, and by its id', async () => {
    const page = await data.reportsPageFor(ALL, BRAND, 50, 0);
    expect(page!.rows.map((r) => r.id)).not.toContain(uuid('ae000000', 0));
    const found = await data.lookUpReportsFor(ALL, {
      brandId: BRAND,
      search: 'benchmark competitor',
      ids: [uuid('ae000000', 3), uuid('ae000000', 301)],
    });
    expect(found!.reports.map((r) => r.id)).toEqual([uuid('ae000000', 3), uuid('ae000000', 0)]);
    expect(found).toMatchObject({ total: 1, not_found: [uuid('ae000000', 301)] });
  });

  it('reads nothing of a brand not shared with the person', async () => {
    expect(await data.lookUpReportsFor(SELECTED, { brandId: BRAND, search: 'x' })).toBeNull();
    expect(tablesRead()).toEqual(['brands']);
  });

  it('over MCP list_reports: finds one past the first page, whatever limit, as Chat does', async () => {
    const list = await callMcp('list_reports', { brand_id: BRAND });
    expect(list.json.map((r: { id: string }) => r.id)).not.toContain(uuid('ae000000', 0));

    const asked = {
      search: 'benchmark competitor',
      ids: [uuid('ae000000', 3), uuid('ae000000', 301)],
    };
    const found = await callMcp('list_reports', { brand_id: BRAND, ...asked, limit: 1 });
    expect(found.json).toEqual(await data.lookUpReportsFor(ALL, { brandId: BRAND, ...asked }));
    expect(found.json.reports.map((r: { id: string }) => r.id)).toEqual([
      uuid('ae000000', 3),
      uuid('ae000000', 0),
    ]);
    expect(found.json).toMatchObject({ total: 1, not_found: [uuid('ae000000', 301)] });
    const none = await callMcp('list_reports', { brand_id: BRAND, search: 'quarterly board' });
    expect(none.json).toMatchObject({ reports: [], not_found: ['quarterly board'] });
    expect(none.json.note).toContain('Never offer other reports as the closest or similar.');
    await refusedOverMcp('list_reports', { ids: [uuid('ae000000', 3)] });
  });
});

// ─── What the MCP tools tell a client ───────────────────────────────────────

describe("the MCP list tools' lookups", () => {
  const LOOKUPS: [tool: string, inputs: string[], first: string][] = [
    ['list_signals', ['codes', 'ids'], 'read that first with `codes` or `ids`'],
    ['list_prompts', ['search', 'ids'], 'read that first with `search`'],
    ['get_prompt_performance', ['prompt_ids'], 'read `prompt_ids` first'],
    ['list_citations', ['domains', 'urls'], 'read that first with `domains`'],
    ['list_content_opportunities', ['search', 'ids'], 'read that first with `search`'],
    ['list_content_drafts', ['search', 'ids'], 'read that first with `search`'],
    ['list_reports', ['search', 'ids'], 'read that first with `search`'],
  ];

  it('tells a client to read what the person names first, and never to answer with the closest', async () => {
    const server = createMcpServer(ALL);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const tool = (name: string) => tools.find((t) => t.name === name)!;

    for (const [name, inputs, first] of LOOKUPS) {
      const { description, inputSchema } = tool(name);
      expect(description, name).toContain(first);
      expect(description, name).toMatch(/never offer (others|other \w+( or \w+)?) as the closest/);
      expect(description, name).toMatch(
        /Never say .+ because (a page of this list|the top domains or URLs) didn't show it\./,
      );
      expect(description, name).toMatch(/don't apply|doesn't apply/);
      const properties = inputSchema.properties as Record<
        string,
        { maxItems?: number; type?: string }
      >;
      for (const input of inputs) {
        expect(properties[input], `${name}.${input}`).toBeDefined();
        if (properties[input].type === 'array') {
          expect(properties[input].maxItems, `${name}.${input}`).toBe(lookup.LOOKUP_MAX);
        }
      }
      // Optional: without them the tool reads as it did.
      expect(inputSchema.required, name).toEqual(['brand_id']);
    }

    // An id from a list says where a named one's id comes from.
    const idOf = (name: string, input: string) =>
      (tool(name).inputSchema.properties as Record<string, { description?: string }>)[input]
        .description;
    expect(idOf('get_report', 'report_id')).toContain('its `search` input');
    expect(idOf('get_content_draft', 'draft_id')).toContain('its `search` input');
    expect(idOf('get_content_opportunity', 'opportunity_id')).toContain('its `search` input');
  });
});
