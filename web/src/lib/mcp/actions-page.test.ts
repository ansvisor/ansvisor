// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Chat's read of the brand's actions (list_action_center_tasks), from the
 * owner's report of 2026-11-14: "what are the most important actions?" on a
 * brand with 53 was judged from the first 10. Every open action is counted
 * and ranked on the server, a page holds 50 compact rows with the total and
 * a note saying how many it shows, the rest come by offset, and only the
 * caller's brand of their organization is ever read. The actions of the
 * codes a person names are read the same for Chat and MCP's list_actions.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
// The module's other reads (KPIs, Getting started) aren't read here.
vi.mock('@/lib/actions/kpis', () => ({ getKpiSnapshots: vi.fn() }));
vi.mock('@/lib/actions/getting-started', () => ({ getGettingStarted: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({ getTrackingWindow: vi.fn() }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { ACTIONS_PAGE_MAX, actionsPageNote, listActionsByCodeFor, listActionsPageFor } =
  await import('./action-center-reads');
const { ACTION_CODES_MAX, ACTION_CODES_NOTE_END } =
  await import('@/lib/action-center/action-codes');
const { createMcpServer } = await import('./server');
const { readBudget, resultCharsFor } = await import('@/lib/chat/run-limits');

const ORG = 'org-1';
const BRAND = 'b1000000-0000-4000-8000-000000000001';
/** Another brand of the same organization: its actions are never this brand's. */
const SISTER = 'b1000000-0000-4000-8000-000000000002';
/** A brand of another organization. */
const FOREIGN = 'b1000000-0000-4000-8000-000000000003';
const ASSIGNEE = 'u2000000-0000-4000-8000-000000000001';

const ALL: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: ORG,
  role: 'manager',
  apiKeyId: 'agent-internal',
  brandAccess: 'all',
};

const idOf = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** An action of the brand; its number is 100 + n, its title "Finding n". */
const action = (n: number, over: Record<string, unknown> = {}) => ({
  id: idOf(n),
  brand_id: BRAND,
  action_no: 100 + n,
  kind: 'chat_finding',
  category: 'recover',
  status: 'new',
  assignee_id: null,
  due_date: null,
  created_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-11-10T09:00:00Z',
  priority_score: n,
  priority_level: 'medium',
  stale_at: null,
  deleted_at: null,
  payload: { title: `Finding ${n}` },
  ...over,
});

/** 53 open actions scored 1–53, read in no order, one not scored yet: 54 in all. */
const OPEN = [
  ...Array.from({ length: 27 }, (_, i) => action(2 * i + 1)),
  ...Array.from({ length: 26 }, (_, i) => action(52 - 2 * i)),
  action(60, { priority_score: null, priority_level: null }),
];

beforeEach(() => {
  db.tables = {
    brands: [
      { id: BRAND, organization_id: ORG, name: 'Brewline' },
      { id: SISTER, organization_id: ORG, name: 'Sister' },
      { id: FOREIGN, organization_id: 'org-2', name: 'Elsewhere' },
    ],
    profiles: [{ id: ASSIGNEE, full_name: 'Ayşe Demir' }],
    actions: [
      ...OPEN,
      // Higher scores, never on the brand's open page: closed, deleted or another brand's.
      action(91, { status: 'completed', priority_score: 99 }),
      action(92, { status: 'dismissed', priority_score: 98 }),
      action(93, { deleted_at: '2026-11-01T00:00:00Z', priority_score: 97 }),
      action(94, { brand_id: SISTER, priority_score: 96 }),
      action(95, { brand_id: FOREIGN, priority_score: 95 }),
    ],
    action_tasks: [],
  };
  db.rpcs = {};
  db.log = [];
});

const scores = (from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, i) => from - i);

describe('a page of the brand’s actions', () => {
  it('reads every open action, highest Priority Score first, 50 to a page with the total', async () => {
    const page = await listActionsPageFor(ALL, { brandId: BRAND });
    expect(ACTIONS_PAGE_MAX).toBe(50);
    expect(page).toMatchObject({
      status: 'open',
      category: null,
      sort: 'priority',
      total: 54,
      offset: 0,
      next_offset: 50,
    });
    // More than the 10 it used to read, ranked over all 54, not over the first rows read.
    expect(page!.actions).toHaveLength(50);
    expect(page!.actions.map((a) => a.priority)).toEqual(scores(53, 4));
    expect(page!.actions.every((a) => a.status === 'new')).toBe(true);
  });

  it('says it shows 50 of 54, and how to read the rest', async () => {
    const page = await listActionsPageFor(ALL, { brandId: BRAND });
    expect(page!.note).toBe(
      'Showing 1–50 of 54 open actions, highest Priority Score first. 4 more not shown: read them with offset 50, or say the answer covers the top 50 of 54. Name each by its title, with its ref.',
    );
    const small = await listActionsPageFor(ALL, { brandId: BRAND, limit: 10 });
    expect(small!.actions.map((a) => a.priority)).toEqual(scores(53, 44));
    expect(small!.note).toContain('Showing 1–10 of 54 open actions');
    expect(small!.note).toContain('44 more not shown: read them with offset 10');
  });

  it('pages on from next_offset, without a gap or a repeat, unscored last', async () => {
    const first = await listActionsPageFor(ALL, { brandId: BRAND });
    const next = await listActionsPageFor(ALL, { brandId: BRAND, offset: first!.next_offset! });
    expect(next).toMatchObject({ total: 54, offset: 50, next_offset: null });
    expect(next!.actions.map((a) => a.priority)).toEqual([3, 2, 1, null]);
    expect(next!.note).toBe(
      'Showing 51–54 of 54 open actions, highest Priority Score first. The first 50 were on earlier pages. Name each by its title, with its ref.',
    );
    const ids = [...first!.actions, ...next!.actions].map((a) => a.id);
    expect(new Set(ids).size).toBe(54);
    expect(new Set(ids)).toEqual(new Set(OPEN.map((a) => a.id)));
    // A page in the middle.
    const middle = await listActionsPageFor(ALL, { brandId: BRAND, offset: 10, limit: 5 });
    expect(middle!.actions.map((a) => a.priority)).toEqual(scores(43, 39));
    expect(middle!.next_offset).toBe(15);
  });

  it('answers past the last page with no rows and the total, also when the database refuses the range', async () => {
    const past = await listActionsPageFor(ALL, { brandId: BRAND, offset: 80 });
    expect(past).toMatchObject({ total: 54, offset: 80, next_offset: null, actions: [] });
    expect(past!.note).toBe('No open actions past offset 80: there are 54 in all.');

    // PostgREST answers an offset past the rows it counted with 416 (PGRST103).
    const from = db.from.bind(db);
    let refused = false;
    const spy = vi.spyOn(db, 'from').mockImplementation((table: string) => {
      const builder = from(table);
      if (table !== 'actions' || refused) return builder;
      refused = true;
      return Object.assign(builder, {
        range: () => ({
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              count: null,
              error: { code: 'PGRST103', message: 'Requested range not satisfiable' },
            }).then(resolve),
        }),
      });
    });
    const refusedPage = await listActionsPageFor(ALL, { brandId: BRAND, offset: 80 });
    spy.mockRestore();
    expect(refusedPage).toMatchObject({ total: 54, next_offset: null, actions: [] });
  });

  it('lists the most recently changed first when asked, and one status or category', async () => {
    db.tables.actions = [
      action(1, { updated_at: '2026-11-01T09:00:00Z', priority_score: 90 }),
      action(2, { updated_at: '2026-11-12T09:00:00Z', priority_score: 10 }),
      action(3, { status: 'in_progress', category: 'fix', priority_score: 50 }),
      action(4, { status: 'completed', priority_score: 70 }),
    ];
    const updated = await listActionsPageFor(ALL, { brandId: BRAND, sort: 'updated' });
    expect(updated!.actions.map((a) => a.ref)).toEqual(['AC-102', 'AC-103', 'AC-101']);
    expect(updated!.note).toBe(
      'All 3 open actions, most recently updated first. Name each by its title, with its ref.',
    );
    const completed = await listActionsPageFor(ALL, { brandId: BRAND, status: 'completed' });
    expect(completed).toMatchObject({ status: 'completed', total: 1 });
    expect(completed!.actions.map((a) => a.ref)).toEqual(['AC-104']);
    const fixes = await listActionsPageFor(ALL, { brandId: BRAND, category: 'fix' });
    expect(fixes!.actions.map((a) => a.ref)).toEqual(['AC-103']);
    expect(fixes!.note).toBe('The only open action in fix. Name it by its title, with its ref.');
    db.tables.actions = [];
    const none = await listActionsPageFor(ALL, { brandId: BRAND });
    expect(none).toMatchObject({ total: 0, next_offset: null, actions: [] });
    expect(none!.note).toBe('No open actions.');
  });

  it('gives each action compact: its number, title, score, status, stale, due, assignee, tasks and day', async () => {
    db.tables.actions = [
      action(7, {
        priority_score: 94,
        priority_level: 'critical',
        stale_at: '2026-11-03T03:00:00Z',
        due_date: '2026-11-20',
        assignee_id: ASSIGNEE,
        payload: { title: 'Recover lost citations on 3 prompts' },
      }),
      // Only a New action is stale.
      action(8, {
        status: 'in_progress',
        stale_at: '2026-11-03T03:00:00Z',
        priority_score: 40,
        kind: 'business_hub_setup',
        payload: {},
      }),
    ];
    db.tables.action_tasks = [
      { id: 't1', action_id: idOf(7), status: 'completed' },
      { id: 't2', action_id: idOf(7), status: 'completed' },
      { id: 't3', action_id: idOf(7), status: 'todo' },
      // A skipped task isn't outstanding work: it leaves the count.
      { id: 't4', action_id: idOf(7), status: 'skipped' },
    ];
    const page = await listActionsPageFor(ALL, { brandId: BRAND });
    expect(page!.actions).toEqual([
      {
        id: idOf(7),
        ref: 'AC-107',
        title: 'Recover lost citations on 3 prompts',
        category: 'recover',
        status: 'new',
        priority: 94,
        priority_level: 'critical',
        stale_since: '2026-11-03',
        due: '2026-11-20',
        assignee: 'Ayşe Demir',
        tasks: '2/3',
        updated: '2026-11-10',
      },
      {
        id: idOf(8),
        ref: 'AC-108',
        title: 'Set up your ChatGPT Business Hub profile',
        category: 'recover',
        status: 'in_progress',
        priority: 40,
        priority_level: 'medium',
        tasks: '0/0',
        updated: '2026-11-10',
      },
    ]);
    // 50 rows with long titles, every field set, stay within the read's share of a run
    // (run-limits.ts), with room for the scope the engine puts first: the model sees all 50.
    db.tables.actions = Array.from({ length: 50 }, (_, i) =>
      action(i + 1, {
        stale_at: '2026-11-03T03:00:00Z',
        due_date: '2026-11-20',
        assignee_id: ASSIGNEE,
        payload: {
          title: `Win back citations on the 2026 coffee subscriptions buying guide, part ${i + 1} of 50`,
        },
      }),
    );
    const full = await listActionsPageFor(ALL, { brandId: BRAND });
    expect(full!.actions).toHaveLength(50);
    expect(JSON.stringify(full).length).toBeLessThan(
      resultCharsFor(readBudget('normal'), 'list_action_center_tasks') - 1_000,
    );
  });

  it('names an action with what is left of its targets, as the Actions list does', async () => {
    db.tables.actions = [
      action(9, {
        kind: 'recover_visibility',
        payload: { targetEntity: 'prompts', targetCount: 13 },
      }),
    ];
    db.rpcs.action_entity_counts = () => [
      { action_id: idOf(9), entity_type: 'prompts', total: 13, removed: 1, removed_labels: ['x'] },
    ];
    const page = await listActionsPageFor(ALL, { brandId: BRAND });
    expect(page!.actions[0].title).toBe('Recover visibility across 12 prompts');
  });
});

describe('what a page may read', () => {
  it("never reads another brand's actions, of the organization or not", async () => {
    const page = await listActionsPageFor(ALL, { brandId: BRAND });
    const next = await listActionsPageFor(ALL, { brandId: BRAND, offset: 50 });
    const refs = [...page!.actions, ...next!.actions].map((a) => a.ref);
    expect(refs).not.toContain('AC-194');
    expect(refs).not.toContain('AC-195');
    const sister = await listActionsPageFor(ALL, { brandId: SISTER });
    expect(sister!.actions.map((a) => a.ref)).toEqual(['AC-194']);
  });

  it('reads nothing of a brand outside the organization, or one not shared with the person', async () => {
    await expect(listActionsPageFor(ALL, { brandId: FOREIGN })).resolves.toBeNull();
    await expect(
      listActionsPageFor({ ...ALL, brandAccess: [SISTER] }, { brandId: BRAND }),
    ).resolves.toBeNull();
    await expect(
      listActionsPageFor({ ...ALL, organizationId: null }, { brandId: BRAND }),
    ).resolves.toBeNull();
    // Only the brand was looked up: none of its actions, tasks or counts.
    expect(db.log.filter(([table]) => table !== 'brands')).toEqual([]);
  });
});

describe('the note', () => {
  it('says how much of the whole a page is, in words the answer can repeat', () => {
    const note = (over: Partial<Parameters<typeof actionsPageNote>[0]>) =>
      actionsPageNote({
        status: 'open',
        category: null,
        sort: 'priority',
        total: 53,
        offset: 0,
        shown: 50,
        ...over,
      });
    expect(note({})).toMatch(/^Showing 1–50 of 53 open actions/);
    expect(note({})).toContain('or say the answer covers the top 50 of 53');
    expect(note({ total: 12, shown: 12 })).toBe(
      'All 12 open actions, highest Priority Score first. Name each by its title, with its ref.',
    );
    expect(note({ status: 'new', total: 0, shown: 0 })).toBe('No New actions.');
    expect(note({ offset: 20, shown: 10, total: 53 })).toContain(
      '23 more not shown: read them with offset 30, or say the answer covers 21–30 of 53.',
    );
  });
});

// The owner's report (2026-11-16): "AC 481 ve AC-63 nedir" with AC-481 on the screen got "there
// is no AC-481" and the closest others: Chat read a page of the list, which didn't hold it.
describe('the brand’s actions by their codes', () => {
  const byCode = (codes: string[], auth: McpAuthContext = ALL, brandId = BRAND) =>
    listActionsByCodeFor(auth, { brandId, codes });

  it('finds a code however it is written', async () => {
    db.tables.actions = [
      action(381),
      action(1, { brand_no: 7, action_no: 900, payload: { title: 'Fix the pricing page' } }),
    ];
    for (const code of ['AC-481', 'AC 481', 'ac481', 'ac-481', '#481', '481']) {
      const found = await byCode([code]);
      expect(
        found!.actions.map((a) => [a.ref, a.asked, a.matched]),
        code,
      ).toEqual([['AC-481', code, 'its code']]);
      expect(found!.not_found, code).toEqual([]);
    }
    for (const code of ['AC-07', 'AC-7', 'ac 7', '#07', '7']) {
      const found = await byCode([code]);
      expect(
        found!.actions.map((a) => [a.ref, a.title]),
        code,
      ).toEqual([['AC-07', 'Fix the pricing page']]);
    }
  });

  it('answers every code of a message from one read, each once', async () => {
    db.tables.actions = [action(381), action(63, { brand_no: 63, action_no: 777 })];
    const found = await byCode(['AC 481', 'AC-63', '#481', 'AC-999']);
    expect(found!.actions.map((a) => [a.asked, a.ref])).toEqual([
      ['AC 481', 'AC-481'],
      ['AC-63', 'AC-63'],
    ]);
    expect(found!.not_found).toEqual(['AC-999']);
    expect(db.log.filter(([table]) => table === 'actions')).toHaveLength(1);
    const many = await byCode(Array.from({ length: 12 }, (_, i) => `AC-${i + 1}`));
    expect(many!.not_found).toHaveLength(ACTION_CODES_MAX);
  });

  it("matches the brand's number, and the old global number as its previous code", async () => {
    db.tables.actions = [
      action(5, { brand_no: 3, action_no: 648, payload: { title: 'Recover lost citations' } }),
    ];
    const byBrandNo = await byCode(['AC-03']);
    expect(byBrandNo!.actions).toEqual([
      expect.objectContaining({
        ref: 'AC-03',
        matched: 'its code',
        previous_ref: 'AC-648',
        title: 'Recover lost citations',
      }),
    ]);
    expect(byBrandNo!.note).toMatch(/^AC-03: one action, by its code\./);
    const byOldNo = await byCode(['AC-648']);
    expect(byOldNo!.actions).toEqual([
      expect.objectContaining({ ref: 'AC-03', matched: 'its previous code' }),
    ]);
    expect(byOldNo!.note).toMatch(
      /^AC-648: one action, by its previous code; its code now is AC-03\./,
    );
  });

  it('returns both actions a code names, and says never to pick one', async () => {
    db.tables.actions = [
      action(6, { brand_no: 12, action_no: 59, payload: { title: 'Old 59' } }),
      action(7, { brand_no: 59, action_no: 700, payload: { title: 'Brand 59' } }),
    ];
    const found = await byCode(['AC-59']);
    expect(found!.actions.map((a) => [a.ref, a.title, a.matched])).toEqual([
      ['AC-59', 'Brand 59', 'its code'],
      ['AC-12', 'Old 59', 'its previous code'],
    ]);
    expect(found!.note).toContain(
      'AC-59 names 2 different actions (AC-59 by its code, AC-12 by its previous code): name each, say which is which, and never pick one.',
    );
  });

  it('finds a Completed or Dismissed action, never a deleted one', async () => {
    const found = await byCode(['AC-191', 'AC-192', 'AC-193']);
    expect(found!.actions.map((a) => [a.ref, a.status])).toEqual([
      ['AC-191', 'completed'],
      ['AC-192', 'dismissed'],
    ]);
    expect(found!.not_found).toEqual(['AC-193']);
    expect(found!.note).toContain(
      'AC-193: no action of this brand has this code, now or before (codes are per brand). Say so plainly; never offer other actions in its place.',
    );
  });

  it('finds an action past the first page of the list', async () => {
    const page = await listActionsPageFor(ALL, { brandId: BRAND });
    expect(page!.actions.map((a) => a.ref)).not.toContain('AC-101');
    const found = await byCode(['AC-101']);
    expect(found!.actions).toEqual([
      expect.objectContaining({ ref: 'AC-101', title: 'Finding 1', priority: 1 }),
    ]);
  });

  it("never reads another brand's action, of the workspace or another one", async () => {
    // AC-194 is the sister brand's, AC-195 another workspace's: not found on this brand.
    const found = await byCode(['AC-194', 'AC-195']);
    expect(found).toMatchObject({ actions: [], not_found: ['AC-194', 'AC-195'] });
    expect((await byCode(['AC-194'], ALL, SISTER))!.actions.map((a) => a.ref)).toEqual(['AC-194']);
    db.log = [];
    await expect(byCode(['AC-195'], ALL, FOREIGN)).resolves.toBeNull();
    await expect(byCode(['AC-101'], { ...ALL, brandAccess: [SISTER] })).resolves.toBeNull();
    await expect(byCode(['AC-101'], { ...ALL, organizationId: null })).resolves.toBeNull();
    expect(db.log.filter(([table]) => table !== 'brands')).toEqual([]);
  });

  it('reads nothing for words that are no code, and says so', async () => {
    db.log = [];
    const found = await byCode(['citations']);
    expect(found).toMatchObject({ actions: [], not_found: [] });
    expect(found!.note).toMatch(/^"citations" is not an action code\./);
    expect(db.log.filter(([table]) => table === 'actions')).toEqual([]);
  });
});

// MCP's list_actions reads codes as Chat does: an MCP client asked "what is AC-481?" could only
// page by priority, and could conclude it doesn't exist when the page didn't hold it.
describe('MCP list_actions by codes', () => {
  async function connect(auth: McpAuthContext) {
    const server = createMcpServer(auth);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    return client;
  }
  async function listActions(
    args: Record<string, unknown>,
    { auth = ALL, brandId = BRAND }: { auth?: McpAuthContext; brandId?: string } = {},
  ) {
    const result = await (
      await connect(auth)
    ).callTool({
      name: 'list_actions',
      arguments: { brand_id: brandId, ...args },
    });
    const text = (result.content as { text: string }[])[0].text;
    return {
      isError: Boolean(result.isError),
      text,
      json: result.isError ? null : JSON.parse(text),
    };
  }
  type Row = { ref: string; title: string; status: string; asked: string; matched: string };
  const rows = (found: { json: { actions: Row[] } }) => found.json.actions;

  it('finds a code however it is written, past the first page of the list', async () => {
    const list = await listActions({});
    expect(list.json).toHaveLength(50);
    expect(list.json.map((a: { code: string }) => a.code)).not.toContain('AC-101');
    for (const code of ['AC-101', 'AC 101', 'ac101', 'ac-101', '#101', '101']) {
      const found = await listActions({ codes: [code] });
      expect(
        rows(found).map((a) => [a.ref, a.title, a.asked, a.matched]),
        code,
      ).toEqual([['AC-101', 'Finding 1', code, 'its code']]);
      expect(found.json.not_found, code).toEqual([]);
    }
  });

  it("matches the brand's number, and the old global number as its previous code", async () => {
    db.tables.actions.push(
      action(70, { brand_no: 7, action_no: 648, payload: { title: 'Fix the pricing page' } }),
    );
    for (const code of ['AC-07', 'AC-7', 'ac 7', '#07', '7']) {
      const found = await listActions({ codes: [code] });
      expect(found.json.actions, code).toEqual([
        expect.objectContaining({
          ref: 'AC-07',
          title: 'Fix the pricing page',
          matched: 'its code',
          previous_ref: 'AC-648',
        }),
      ]);
    }
    const byOldNo = await listActions({ codes: ['AC-648'] });
    expect(rows(byOldNo).map((a) => [a.ref, a.matched])).toEqual([['AC-07', 'its previous code']]);
    expect(byOldNo.json.note).toMatch(
      /^AC-648: one action, by its previous code; its code now is AC-07\./,
    );
  });

  it('returns both actions a code names, whatever limit, status, category or sort it is given', async () => {
    db.tables.actions = [
      action(6, { brand_no: 12, action_no: 59, payload: { title: 'Old 59' } }),
      action(7, { brand_no: 59, action_no: 700, payload: { title: 'Brand 59' } }),
      action(381),
    ];
    const found = await listActions({
      codes: ['AC-59', 'AC-481'],
      limit: 1,
      status: 'completed',
      category: 'growth',
      sort: 'updated',
    });
    expect(rows(found).map((a) => [a.asked, a.ref, a.title, a.matched])).toEqual([
      ['AC-59', 'AC-59', 'Brand 59', 'its code'],
      ['AC-59', 'AC-12', 'Old 59', 'its previous code'],
      ['AC-481', 'AC-481', 'Finding 381', 'its code'],
    ]);
    expect(found.json.note).toContain(
      'AC-59 names 2 different actions (AC-59 by its code, AC-12 by its previous code): name each, say which is which, and never pick one.',
    );
  });

  it('finds a Completed or Dismissed action, never a deleted one, and says what it did not find', async () => {
    const found = await listActions({ codes: ['AC-191', 'AC-192', 'AC-193', 'AC-999'] });
    expect(rows(found).map((a) => [a.ref, a.status])).toEqual([
      ['AC-191', 'completed'],
      ['AC-192', 'dismissed'],
    ]);
    expect(found.json.not_found).toEqual(['AC-193', 'AC-999']);
    expect(found.json.note).toContain(
      'AC-999: no action of this brand has this code, now or before (codes are per brand). Say so plainly; never offer other actions in its place.',
    );
    expect(found.json.note.endsWith(ACTION_CODES_NOTE_END)).toBe(true);
  });

  it("never reads another brand's action, of the workspace or another one", async () => {
    const found = await listActions({ codes: ['AC-194', 'AC-195'] });
    expect(found.json).toMatchObject({ actions: [], not_found: ['AC-194', 'AC-195'] });
    const sister = await listActions({ codes: ['AC-194'] }, { brandId: SISTER });
    expect(rows(sister).map((a) => a.ref)).toEqual(['AC-194']);
    db.log = [];
    const refusals: [McpAuthContext, string][] = [
      [ALL, FOREIGN],
      [{ ...ALL, brandAccess: [SISTER] }, BRAND],
      [{ ...ALL, organizationId: null }, BRAND],
    ];
    for (const [auth, brandId] of refusals) {
      const refused = await listActions({ codes: ['AC-195', 'AC-101'] }, { auth, brandId });
      expect(refused).toMatchObject({ isError: true, text: 'Brand not found' });
    }
    expect(db.log.filter(([table]) => table !== 'brands')).toEqual([]);
  });

  it("answers as Chat's read does, from the same rows and note", async () => {
    db.tables.actions = [action(381), action(63, { brand_no: 63, action_no: 777 })];
    const codes = ['AC 481', 'AC-63', '#481', 'AC-999'];
    const found = await listActions({ codes });
    expect(found.json).toEqual(await listActionsByCodeFor(ALL, { brandId: BRAND, codes }));
    expect(rows(found).map((a) => a.ref)).toEqual(['AC-481', 'AC-63']);
  });

  it('tells an MCP client to read a code first, and never to answer with the closest actions', async () => {
    const { tools } = await (await connect(ALL)).listTools();
    const list = tools.find((tool) => tool.name === 'list_actions')!;
    expect(list.description).toContain('read that code first with `codes`');
    expect(list.description).toContain(
      'this brand has no action with that code (codes are per brand)',
    );
    expect(list.description).toContain('never offer the closest actions instead');
    expect(list.description).toContain(
      "Never say an action doesn't exist because a page of this list didn't show it.",
    );
    const codes = (list.inputSchema.properties as Record<string, { maxItems?: number }>).codes;
    expect(codes.maxItems).toBe(ACTION_CODES_MAX);
    expect(list.inputSchema.required).toEqual(['brand_id']);
    const get = tools.find((tool) => tool.name === 'get_action')!;
    const id = (get.inputSchema.properties as Record<string, { description?: string }>).action_id;
    expect(id.description).toContain('its `codes` input');
  });
});
