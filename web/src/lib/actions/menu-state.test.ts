// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOT_AREAS, type DotArea } from '@/lib/menu-dots';

/**
 * The menu's one read per brand (SIMPLE_NAV, PR 13): a handful of indexed
 * single-row reads as the person, each only for an area the menu shows, the
 * Actions tab's own count, and the person's visits. A part that fails is
 * null and lights nothing; nothing throws.
 */

const USER = '99999999-9999-4999-8999-999999999999';
const BRAND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORG = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type Answer = { data: unknown; error: { message: string } | null; count?: number };

const db = vi.hoisted(() => ({
  user: { id: '99999999-9999-4999-8999-999999999999' } as { id: string } | null,
  answers: {} as Record<
    string,
    { data: unknown; error: { message: string } | null; count?: number }
  >,
  calls: {} as Record<string, [string, ...unknown[]][]>,
  /** Answers given in turn, before `answers`, for a table read more than once. */
  queue: {} as Record<string, { data: unknown; error: { message: string } | null }[]>,
  count: vi.fn(async () => 4),
}));

vi.mock('@/lib/actions/action-center-counts', () => ({ getMyOpenActionCount: db.count }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => {
      const calls: [string, ...unknown[]][] = [];
      // A table read again in one call keeps each: tracking_runs, then tracking_runs#2.
      let key = table;
      for (let n = 2; db.calls[key]; n++) key = `${table}#${n}`;
      db.calls[key] = calls;
      const answer = () =>
        db.queue[table]?.shift() ?? db.answers[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of [
        'select',
        'eq',
        'is',
        'not',
        'or',
        'order',
        'limit',
        'in',
        'gt',
        'gte',
      ]) {
        chain[method] = (...args: unknown[]) => (calls.push([method, ...args]), chain);
      }
      chain.maybeSingle = async () => (calls.push(['maybeSingle']), answer());
      chain.then = (resolve: (value: Answer) => unknown) => resolve(answer());
      return chain;
    },
  }),
}));

const { getMenuState } = await import('./menu-state');

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.user = { id: USER };
  db.calls = {};
  db.queue = {};
  db.count.mockClear();
  db.answers = {
    tracking_runs: { data: { completed_at: '2026-11-11T03:10:00+00:00' }, error: null },
    prompt_suggestions: { data: { generated_at: '2026-11-10T22:00:00Z' }, error: null },
    actions: { data: { created_at: '2026-11-11T04:00:00Z' }, error: null },
    content_opportunities: { data: { created_at: '2026-11-11T05:00:00Z' }, error: null },
    ai_traffic_logs: { data: null, error: null },
    brands: { data: { organization_id: ORG, ga_property_id: null }, error: null },
    integration_connections: { data: [], error: null },
    user_brand_state: {
      data: { nav_seen: { insights: '2026-11-10T09:00:00Z', nope: 'x' } },
      error: null,
    },
  };
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorLog.mockRestore());

const everything = { areas: [...DOT_AREAS], count: true };

describe('getMenuState, red and grey', () => {
  const now = () => new Date().toISOString();
  const status = ['traffic', 'audit', 'content/library', 'agents', 'content/editor'] as DotArea[];

  it('reads what broke only when asked for red, and each only for its area', async () => {
    db.answers.site_audits = {
      data: { id: 'a1', status: 'completed', created_at: now() },
      error: null,
    };
    const member = await getMenuState(BRAND, { areas: status, count: false });
    const read = Object.keys(db.calls);
    for (const table of ['site_audits', 'chat_agent_runs', 'content_agent_runs'])
      expect(read).toContain(table);
    for (const table of ['brand_integrations', 'audit_signal_results', 'content_draft_deliveries'])
      expect(read).not.toContain(table);
    expect(member?.broken).toBeUndefined();

    db.calls = {};
    await getMenuState(BRAND, { areas: ['mentions'], count: false, red: true });
    expect(Object.keys(db.calls).sort()).toEqual(['tracking_runs', 'user_brand_state']);
  });

  it('lights red from the stored signals, for admins and managers', async () => {
    db.answers.brand_integrations = {
      data: [
        { provider: 'google-search-console', account: { id: 's', status: 'disconnected' } },
        { provider: 'google-analytics', account: { id: 'g', status: 'connected' } },
      ],
      error: null,
    };
    db.answers.site_audits = {
      data: { id: 'a1', status: 'completed', created_at: now() },
      error: null,
    };
    db.answers.audit_signal_results = { data: { status: 'fail' }, error: null };
    db.queue.content_draft_deliveries = [
      { data: { draft_id: 'd1', created_at: '2026-11-10T08:00:00Z' }, error: null },
      { data: null, error: null },
    ];
    db.queue.chat_agent_runs = [
      { data: null, error: null },
      {
        data: [
          { agent_id: 'x', status: 'done' },
          { agent_id: 'y', status: 'failed' },
          { agent_id: 'x', status: 'failed' },
        ],
        error: null,
      },
    ];
    const state = await getMenuState(BRAND, { areas: status, count: false, red: true });
    expect(state?.broken).toEqual({
      traffic: 'searchConsole',
      audit: 'aiBotsBlocked',
      'content/library': 'publishFailed',
      agents: 'agentFailed',
    });
    expect(state?.working).toBeUndefined();
    expect(db.calls.audit_signal_results).toContainEqual(['eq', 'signal_key', 'ai-bot-access']);
    expect(db.calls['chat_agent_runs#2']).toContainEqual(['eq', 'chat_agents.owner_id', USER]);
    // A later send that went through, and an agent's later run that did, clear them.
    db.queue.content_draft_deliveries = [
      { data: { draft_id: 'd1', created_at: '2026-11-10T08:00:00Z' }, error: null },
      { data: { id: 'later' }, error: null },
    ];
    db.queue.chat_agent_runs = [
      { data: null, error: null },
      {
        data: [
          { agent_id: 'x', status: 'done' },
          { agent_id: 'x', status: 'failed' },
        ],
        error: null,
      },
    ];
    db.answers.audit_signal_results = { data: { status: 'warn' }, error: null };
    db.answers.brand_integrations = { data: [], error: null };
    expect((await getMenuState(BRAND, { areas: status, count: false, red: true }))?.broken).toEqual(
      {},
    );
  });

  it('lights grey while a job runs, and not for a run left open for hours', async () => {
    db.queue.tracking_runs = [
      { data: { completed_at: '2026-11-11T03:10:00Z' }, error: null },
      { data: { started_at: now(), completed_at: null }, error: null },
    ];
    db.answers.site_audits = {
      data: { id: 'a1', status: 'running', created_at: now() },
      error: null,
    };
    db.answers.chat_agent_runs = { data: { id: 'r1' }, error: null };
    db.answers.content_agent_runs = { data: { id: 'c1' }, error: null };
    const state = await getMenuState(BRAND, {
      areas: ['insights', 'agents', 'content/editor', 'audit'],
      count: false,
    });
    expect(state?.working).toEqual({
      insights: 'trackingRunning',
      'prompts/tracked': 'trackingRunning',
      agents: 'agentRunning',
      'content/editor': 'writing',
      audit: 'auditRunning',
    });
    expect(db.calls.content_agent_runs).toContainEqual(['in', 'kind', ['write', 'rewrite']]);
    expect(db.calls['tracking_runs#2']).toEqual([
      ['select', 'started_at, completed_at'],
      ['eq', 'brand_id', BRAND],
      ['order', 'started_at', { ascending: false }],
      ['limit', 1],
      ['maybeSingle'],
    ]);
    db.answers.site_audits = {
      data: { id: 'a1', status: 'running', created_at: '2026-01-01T00:00:00Z' },
      error: null,
    };
    // Once the run completed (the answer's completed_at), the grey goes.
    const later = await getMenuState(BRAND, { areas: ['insights', 'audit'], count: false });
    expect(later?.working).toBeUndefined();
  });
});

describe('getMenuState', () => {
  it('reads each newest time, the count and the person’s visits', async () => {
    expect(await getMenuState(BRAND, everything)).toEqual({
      nightlyRunAt: '2026-11-11T03:10:00.000Z',
      newSuggestionAt: '2026-11-10T22:00:00.000Z',
      newActionAt: '2026-11-11T04:00:00.000Z',
      newOpportunityAt: '2026-11-11T05:00:00.000Z',
      traffic: { connectedAt: null },
      openActions: 4,
      navSeen: { insights: '2026-11-10T09:00:00.000Z' },
    });
    expect(db.count).toHaveBeenCalledWith(BRAND);
  });

  it('asks for single rows on the indexes it names', async () => {
    await getMenuState(BRAND, everything);
    expect(db.calls.tracking_runs).toEqual([
      ['select', 'completed_at'],
      ['eq', 'brand_id', BRAND],
      ['eq', 'source', 'cron'],
      ['not', 'completed_at', 'is', null],
      ['order', 'completed_at', { ascending: false }],
      ['limit', 1],
      ['maybeSingle'],
    ]);
    expect(db.calls.prompt_suggestions).toEqual([
      ['select', 'generated_at'],
      ['eq', 'brand_id', BRAND],
      ['eq', 'status', 'new'],
      ['order', 'generated_at', { ascending: false }],
      ['limit', 1],
      ['maybeSingle'],
    ]);
    expect(db.calls.actions).toEqual([
      ['select', 'created_at'],
      ['eq', 'brand_id', BRAND],
      ['eq', 'status', 'new'],
      ['is', 'deleted_at', null],
      ['or', `assignee_id.is.null,assignee_id.eq.${USER}`],
      ['order', 'created_at', { ascending: false }],
      ['limit', 1],
      ['maybeSingle'],
    ]);
    expect(db.calls.content_opportunities).toContainEqual(['eq', 'status', 'new']);
    expect(db.calls.ai_traffic_logs).toContainEqual(['order', 'created_at', { ascending: true }]);
    expect(db.calls.user_brand_state).toEqual([
      ['select', 'nav_seen'],
      ['eq', 'user_id', USER],
      ['eq', 'brand_id', BRAND],
      ['maybeSingle'],
    ]);
  });

  it('reads only for the areas asked, and the count only when asked', async () => {
    const areas: DotArea[] = ['mentions', 'traffic'];
    const state = await getMenuState(BRAND, { areas, count: false });
    expect(Object.keys(db.calls).sort()).toEqual([
      'ai_traffic_logs',
      'brands',
      'integration_connections',
      'tracking_runs',
      'user_brand_state',
    ]);
    expect(db.count).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      newSuggestionAt: null,
      newActionAt: null,
      newOpportunityAt: null,
      openActions: null,
    });
    db.calls = {};
    await getMenuState(BRAND, { areas: ['content', 'nope' as DotArea], count: false });
    expect(Object.keys(db.calls).sort()).toEqual(['content_opportunities', 'user_brand_state']);
  });

  it('counts traffic connected from the first AI visit or the brand’s Analytics, the earlier', async () => {
    db.answers.ai_traffic_logs = { data: { created_at: '2026-11-09T12:00:00Z' }, error: null };
    expect((await getMenuState(BRAND, everything))?.traffic).toEqual({
      connectedAt: '2026-11-09T12:00:00.000Z',
    });
    db.answers.brands = { data: { organization_id: ORG, ga_property_id: '123' }, error: null };
    db.answers.integration_connections = {
      data: [
        { organization_id: 'other', updated_at: '2026-10-01T00:00:00Z' },
        { organization_id: ORG, updated_at: '2026-11-08T00:00:00Z' },
      ],
      error: null,
    };
    expect((await getMenuState(BRAND, everything))?.traffic).toEqual({
      connectedAt: '2026-11-08T00:00:00.000Z',
    });
    // Analytics connected for the workspace, but no property for this brand.
    db.answers.ai_traffic_logs = { data: null, error: null };
    db.answers.brands = { data: { organization_id: ORG, ga_property_id: ' ' }, error: null };
    expect((await getMenuState(BRAND, everything))?.traffic).toEqual({ connectedAt: null });
  });

  it('leaves out what it couldn’t read, so no dot lights for it', async () => {
    db.answers.tracking_runs = { data: null, error: { message: 'boom' } };
    db.answers.integration_connections = { data: null, error: { message: 'boom' } };
    db.answers.user_brand_state = { data: null, error: { message: 'boom' } };
    const state = await getMenuState(BRAND, everything);
    expect(state?.nightlyRunAt).toBeNull();
    expect(state).not.toHaveProperty('traffic');
    expect(state?.navSeen).toBeNull();
    expect(state?.newActionAt).toBe('2026-11-11T04:00:00.000Z');
  });

  it('counts the prompts waiting for a spot with one head count, only when asked', async () => {
    db.answers.prompts = { data: null, error: null, count: 2 } as Answer;
    expect(await getMenuState(BRAND, everything)).not.toHaveProperty('waitingPrompts');
    expect(db.calls.prompts).toBeUndefined();

    const state = await getMenuState(BRAND, { ...everything, waiting: true });
    expect(state?.waitingPrompts).toBe(2);
    expect(db.calls.prompts).toEqual([
      ['select', 'id, prompt_sets!inner(brand_id)', { count: 'exact', head: true }],
      ['eq', 'prompt_sets.brand_id', BRAND],
      ['not', 'waiting_since', 'is', null],
    ]);

    // Not on the menu: not counted.
    db.calls = {};
    await getMenuState(BRAND, { areas: ['mentions'], count: false, waiting: true });
    expect(db.calls.prompts).toBeUndefined();

    db.answers.prompts = { data: null, error: { message: 'boom' } };
    expect(await getMenuState(BRAND, { ...everything, waiting: true })).not.toHaveProperty(
      'waitingPrompts',
    );
  });

  it('is the empty visit list for a person who has none yet', async () => {
    db.answers.user_brand_state = { data: null, error: null };
    expect((await getMenuState(BRAND, everything))?.navSeen).toEqual({});
  });

  it('reads nothing for a brand id that isn’t one, or signed out', async () => {
    expect(await getMenuState('brand-1', everything)).toBeNull();
    db.user = null;
    expect(await getMenuState(BRAND, everything)).toBeNull();
    expect(db.calls).toEqual({});
  });
});
