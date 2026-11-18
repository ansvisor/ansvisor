// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * The page's search with the page's filters (the maintainer's review of
 * 2026-11-17): on Content and on Tracked Prompts the app fills the read's
 * `search` from the page's search box, and the search reads the list as the
 * page lists it (as_listed): its status, impact, type, topic and active
 * state, archived set aside, in its sort; never the lookup's every status.
 * What the app says it took (scopeRead's `used.page`, the model's
 * `from_page.took`) is what the read applied. /dashboard/prompts is the
 * Tracked Prompts page (page-route.ts), so its search reaches list_prompts
 * too, and the order line says the app applies a search only where it does.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { CHAT_TOOLS } = await import('./registry/tools');
const { scopeRead } = await import('./scope');
const { AS_LISTED, pageFilterInputs, pageScopeOf } = await import('./page-scope');
const { pageOrderLine, pageOrderOf } = await import('./page-order');

const ORG = 'org-1';
const BRAND = 'b1000000-0000-4000-8000-000000000001';
const TOPIC = 'c1000000-0000-4000-8000-000000000001';
const OTHER_TOPIC = 'c1000000-0000-4000-8000-000000000002';
const AUTH: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: ORG,
  role: 'analyst',
  apiKeyId: 'agent-internal',
  brandAccess: 'all',
};
type Row = Record<string, unknown>;
const uuid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tool = (name: string) => CHAT_TOOLS.find((t) => t.name === name)!;
const at = (daysAgo: number) => new Date(Date.UTC(2026, 10, 16 - daysAgo)).toISOString();

/** A page's context as the side panel posts it: its chips, and its view's search. */
const pageOf = (route: string, filters: [string, string][], search?: string) =>
  pageScopeOf({
    route,
    chips: [
      { key: 'brand', label: 'Brewline', value: BRAND },
      ...filters.map(([key, value]) => ({ key: `filter:${key}`, label: value, value })),
    ],
    ...(search ? { view: { search } } : {}),
  });

/** The read as Chat makes it: the server's scope over the model's input, then the read. */
async function read(
  name: string,
  raw: Row,
  page: ReturnType<typeof pageOf>,
  question = 'Which ones are these?',
) {
  const scoped = await scopeRead(
    tool(name),
    { brand_id: BRAND, ...raw },
    { question, limits: null, planName: 'Growth', page, now: new Date('2026-11-16T12:00:00Z') },
  );
  if (scoped.kind !== 'read') throw new Error(scoped.kind);
  const result = (await tool(name).run(
    AUTH as never,
    tool(name).inputSchema.parse(scoped.input) as never,
  )) as Row;
  return { input: scoped.input, took: scoped.used.page ?? [], result };
}

beforeEach(() => {
  db.tables = { brands: [{ id: BRAND, organization_id: ORG, name: 'Brewline' }] };
});

// ─── Content Opportunities ──────────────────────────────────────────────────

interface Opp {
  n: number;
  title: string;
  status: string;
  impact: string;
  type: string;
  daysAgo: number;
  score: number;
}

const OPPS: Opp[] = [
  {
    n: 1,
    title: 'Espresso grinder guide',
    status: 'new',
    impact: 'high',
    type: 'owned',
    daysAgo: 3,
    score: 90,
  },
  {
    n: 2,
    title: 'The espresso grinder FAQ',
    status: 'new',
    impact: 'high',
    type: 'owned',
    daysAgo: 1,
    score: 40,
  },
  {
    n: 3,
    title: 'Grinder for espresso at home',
    status: 'new',
    impact: 'high',
    type: 'owned',
    daysAgo: 2,
    score: 70,
  },
  // Each misses one of the page's filters, or is archived: not on the page.
  {
    n: 4,
    title: 'Espresso grinder reviews',
    status: 'reviewed',
    impact: 'high',
    type: 'owned',
    daysAgo: 0,
    score: 99,
  },
  {
    n: 5,
    title: 'Espresso grinder deals',
    status: 'new',
    impact: 'low',
    type: 'owned',
    daysAgo: 0,
    score: 98,
  },
  {
    n: 6,
    title: 'Espresso grinder outreach',
    status: 'new',
    impact: 'high',
    type: 'earned',
    daysAgo: 0,
    score: 97,
  },
  {
    n: 7,
    title: 'Espresso grinder backlog',
    status: 'archived',
    impact: 'high',
    type: 'owned',
    daysAgo: 0,
    score: 96,
  },
  // Not the search's words.
  {
    n: 8,
    title: 'Pour-over kettles',
    status: 'new',
    impact: 'high',
    type: 'owned',
    daysAgo: 0,
    score: 95,
  },
];

const opportunityRows = () =>
  OPPS.map((o) => ({
    id: uuid('0c000000', o.n),
    brand_id: BRAND,
    title: o.title,
    description: null,
    type: o.type,
    impact: o.impact,
    opportunity_score: o.score,
    status: o.status,
    prompt_id: null,
    created_at: at(o.daysAgo),
    updated_at: at(o.daysAgo),
    brief: null,
  }));

const ids = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id);
const opp = (...ns: number[]) => ns.map((n) => uuid('0c000000', n));

describe("Content's search with its filters", () => {
  beforeEach(() => {
    db.tables.content_opportunities = opportunityRows();
  });

  it("reads the page's rows: its status, impact and type, archived set aside, in the page's sort", async () => {
    const page = pageOf(
      '/dashboard/content',
      [
        ['type', 'owned'],
        ['impact', 'high'],
        ['status', 'new'],
      ],
      'espresso grinder',
    );
    // The page's order line tells the model the page's sort: newest first.
    const { input, took, result } = await read(
      'list_content_opportunities',
      { ...pageOrderOf('/dashboard/content')!.input },
      page,
    );
    expect(input).toMatchObject({
      type: 'owned',
      impact: 'high',
      status: 'new',
      search: 'espresso grinder',
      [AS_LISTED]: true,
      sort: 'newest',
    });
    // Only the page's rows, newest first: none of another status, impact or type.
    expect(ids(result.opportunities)).toEqual(opp(2, 3, 1));
    expect(result.total).toBe(3);
    expect(result).not.toHaveProperty('not_found');
    // And what the app says it took is what the read applied.
    expect(took).toEqual(['type', 'impact', 'status', 'search']);
  });

  it('sets archived aside without a status, as the list does, in the sort asked', async () => {
    const page = pageOf('/dashboard/content', [], 'espresso grinder');
    const byScore = await read('list_content_opportunities', { sort: 'score' }, page);
    expect(ids(byScore.result.opportunities)).toEqual(opp(4, 5, 6, 1, 3, 2));
    expect(byScore.took).toEqual(['search']);
    const oldest = await read('list_content_opportunities', { sort: 'oldest' }, page);
    expect(ids(oldest.result.opportunities)).toEqual(opp(1, 3, 2, 4, 5, 6));
    // Archived only when the page (or the model) asks for it by status.
    const archived = await read(
      'list_content_opportunities',
      {},
      pageOf('/dashboard/content', [['status', 'archived']], 'espresso grinder'),
    );
    expect(ids(archived.result.opportunities)).toEqual(opp(7));
    expect(archived.took).toEqual(['status', 'search']);
  });

  it("looks a named one up in every status when the model searches, and takes none of the page's filters", async () => {
    const page = pageOf('/dashboard/content', [['status', 'new']]);
    const { input, took, result } = await read(
      'list_content_opportunities',
      { search: 'grinder backlog' },
      page,
    );
    expect(input).not.toHaveProperty('status');
    expect(input).not.toHaveProperty(AS_LISTED);
    // The lookup: the archived one it names, and nothing said of the page's status.
    expect(ids(result.opportunities)).toEqual(opp(7));
    expect(took).toEqual([]);
    // Asked to search the list as listed, the page's filters apply.
    const listed = await read(
      'list_content_opportunities',
      { search: 'espresso', [AS_LISTED]: true, sort: 'newest' },
      page,
    );
    expect(ids(listed.result.opportunities)).toEqual(opp(5, 6, 2, 3, 1));
    expect(listed.took).toEqual(['status']);
  });

  it('leaves the search out for a question that asks for all of them, filters kept', async () => {
    const page = pageOf('/dashboard/content', [['status', 'new']], 'espresso grinder');
    const all = await read(
      'list_content_opportunities',
      { sort: 'newest' },
      page,
      'Show all opportunities',
    );
    expect(all.input).not.toHaveProperty('search');
    expect(all.input).not.toHaveProperty(AS_LISTED);
    expect(all.took).toEqual(['status']);
    expect(ids(all.result.opportunities)).toEqual(opp(5, 6, 8, 2, 3, 1));
  });
});

// ─── Tracked Prompts ────────────────────────────────────────────────────────

const PROMPTS = [
  { n: 1, text: 'best espresso beans for beginners', active: true, topic: TOPIC, daysAgo: 3 },
  { n: 2, text: 'espresso beans subscription', active: true, topic: TOPIC, daysAgo: 1 },
  { n: 3, text: 'cheap espresso beans online', active: false, topic: TOPIC, daysAgo: 2 },
  { n: 4, text: 'espresso beans for latte art', active: true, topic: OTHER_TOPIC, daysAgo: 0 },
  { n: 5, text: 'pour-over kettles', active: true, topic: TOPIC, daysAgo: 0 },
];
const promptRows = () =>
  PROMPTS.map((p) => ({
    id: uuid('9a000000', p.n),
    text: p.text,
    topic_id: p.topic,
    platforms: [],
    models: [],
    regions: [],
    is_active: p.active,
    created_at: at(p.daysAgo),
    prompt_sets: { brand_id: BRAND, brands: { organization_id: ORG } },
    topics: { name: p.topic === TOPIC ? 'Beans' : 'Milk' },
  }));
const prompt = (...ns: number[]) => ns.map((n) => uuid('9a000000', n));

describe("Tracked Prompts' search, on both of its routes", () => {
  beforeEach(() => {
    db.tables.prompts = promptRows();
  });

  it.each(['/dashboard/prompts', '/dashboard/prompts/tracked'])(
    "%s: fills list_prompts' search, within the list as filtered",
    async (route) => {
      const page = pageOf(route, [], 'espresso beans');
      const { input, took, result } = await read(
        'list_prompts',
        { is_active: true, topic_id: TOPIC },
        page,
      );
      expect(input).toMatchObject({ search: 'espresso beans', [AS_LISTED]: true });
      // Active ones of the topic only, newest first: never the paused one or another topic's.
      expect(ids(result.prompts)).toEqual(prompt(2, 1));
      expect(result.total).toBe(2);
      expect(took).toEqual(['search']);
      // Without the model's filters: every prompt with the words, as the list reads them.
      const every = await read('list_prompts', {}, page);
      expect(ids(every.result.prompts)).toEqual(prompt(4, 2, 3, 1));
    },
  );

  it("keeps a named prompt's lookup in every topic and state", async () => {
    const page = pageOf('/dashboard/prompts', []);
    const { input, took, result } = await read(
      'list_prompts',
      { search: 'cheap espresso', is_active: true },
      page,
    );
    expect(input).not.toHaveProperty(AS_LISTED);
    // The lookup reads the paused one: is_active doesn't apply to a lookup, as its description says.
    expect(ids(result.prompts)).toEqual(prompt(3));
    expect(took).toEqual([]);
  });
});

// ─── What the order line says ───────────────────────────────────────────────

describe("the order line's word on the page's search", () => {
  /** What the app applies to a read of this name, as the engine asks it. */
  const takesOn = (page: ReturnType<typeof pageOf>, question: string) => (name: string) =>
    pageFilterInputs(tool(name), { brand_id: BRAND }, page, question).applied;

  it('says the app applies it on both Prompts routes, where it does', () => {
    for (const route of ['/dashboard/prompts', '/dashboard/prompts/tracked']) {
      const page = pageOf(route, [], 'espresso beans');
      const line = pageOrderLine(route, [], { search: 'espresso beans' }, takesOn(page, 'Hi'))!;
      expect(line, route).toContain("the app applies that search to list_prompts's search");
    }
  });

  it("doesn't say so where the app doesn't apply it", () => {
    const page = pageOf('/dashboard/prompts', [], 'espresso beans');
    // A question that asks past the search: the read takes none.
    const all = pageOrderLine(
      '/dashboard/prompts',
      [],
      { search: 'espresso beans' },
      takesOn(page, 'List all prompts'),
    )!;
    expect(all).not.toContain('the app applies');
    expect(all).toContain("which the app doesn't apply to this question's reads");
    // A search with no words to search: none either.
    const blank = pageOf('/dashboard/content', [], '!!!');
    expect(
      pageOrderLine('/dashboard/content', [], { search: '!!!' }, takesOn(blank, 'Hi')),
    ).not.toContain('the app applies');
    // And without knowing what the app applies, never.
    expect(pageOrderLine('/dashboard/content', [], { search: 'x' })).not.toContain(
      'the app applies',
    );
  });

  it('leaves out a filter\'s "all" only where the app fills the filter', () => {
    const page = pageOf('/dashboard/action-center/actions', [['status', 'completed']]);
    expect(
      pageOrderLine('/dashboard/action-center/actions', ['status'], null, takesOn(page, 'Hi')),
    ).toContain('read list_action_center_tasks with sort "updated",');
    // Asked for every status, the app leaves the page's status out: the read's "all" says it.
    expect(
      pageOrderLine(
        '/dashboard/action-center/actions',
        ['status'],
        null,
        takesOn(page, 'Show actions in all statuses'),
      ),
    ).toContain('read list_action_center_tasks with status "all" and sort "updated"');
  });
});
