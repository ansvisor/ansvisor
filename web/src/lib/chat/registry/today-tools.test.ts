// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/config/plans';

/**
 * Chat's reads of Today, Agents, History and the Signals summary (plan step
 * 6b): each row matches its page, hands the page's read what the person
 * asked, pages its list and takes the run's period as the other dated reads
 * do, and the reader knows "what to do first" on Today is its first card.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: vi.fn() } }));
const reads = vi.hoisted(() => ({
  getTodayFor: vi.fn(async () => ({ from: 'today' })),
  getSignalsSummaryFor: vi.fn(async () => ({ from: 'summary' })),
  historyPageFor: vi.fn(async () => ({ from: 'history' })),
  listMyAgentsFor: vi.fn(async () => ({ from: 'agents' })),
  listAgentRunsFor: vi.fn(async () => ({ from: 'runs' })),
}));
vi.mock('@/lib/mcp/today-reads', () => ({
  getTodayFor: reads.getTodayFor,
  getSignalsSummaryFor: reads.getSignalsSummaryFor,
  historyPageFor: reads.historyPageFor,
}));
vi.mock('@/lib/mcp/agent-reads', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listMyAgentsFor: reads.listMyAgentsFor,
  listAgentRunsFor: reads.listAgentRunsFor,
}));

const { chatTool, listedTools } = await import('./tools');
const { ROW_CAP, pagedRead, scopeRead } = await import('../scope');
const { READ_ON_RULES } = await import('../rules');
const { TRUSTED_READS, taintsRun } = await import('../untrusted');

const BRAND = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-17T12:00:00.000Z');
const ctx = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'agent-internal',
  brandAccess: 'all' as const,
  role: 'manager' as const,
  timezone: 'Europe/Istanbul',
};
const facts = {
  question: 'Ne değişti?',
  limits: PLANS.growth.limits,
  planName: 'Growth',
  now: NOW,
};
const row = (name: string) => {
  const tool = chatTool(name);
  if (!tool) throw new Error(`no ${name}`);
  return tool;
};
const run = (name: string, input: Record<string, unknown>) =>
  row(name).run(ctx, row(name).inputSchema.parse(input));

beforeEach(() => {
  for (const fn of Object.values(reads)) fn.mockClear();
});

describe('the rows for Today, Agents, History and the Signals summary', () => {
  it('are listed on every install, each for the page it matches', () => {
    const listed = listedTools().map((tool) => tool.name);
    expect(
      Object.fromEntries(
        [
          'get_today',
          'list_my_agents',
          'list_agent_runs',
          'get_action_history',
          'get_signals_summary',
        ].map((name) => [name, listed.includes(name) ? row(name).route : null]),
      ),
    ).toEqual({
      get_today: '/dashboard/action-center/today',
      list_my_agents: '/dashboard/agents',
      list_agent_runs: '/dashboard/agents',
      get_action_history: '/dashboard/action-center/history',
      get_signals_summary: '/dashboard/action-center/signals',
    });
    expect(row('get_today').description).toContain('Action Center › Today');
    expect(row('list_my_agents').description).toContain('Action Center › Agents');
    expect(row('list_agent_runs').description).toContain('Runs tab');
    expect(row('get_action_history').description).toContain('Action Center › History');
    expect(row('get_signals_summary').description).toContain("The Signals page's summary cards");
  });

  it('says on Today that the first action is the first card of its focus', () => {
    expect(row('get_today').description).toContain(
      '"The first action", "what should I do first" or "my first card" asked on Today means the first card of its focus (focus.cards[0])',
    );
    expect(READ_ON_RULES).toContain(
      'Asked on Today (/dashboard/action-center/today) for "the first action" or "what to do first": that is the first card of Today\'s focus. Read get_today',
    );
    // The rest of the priority rules stay: elsewhere, the Priority Score's order.
    expect(READ_ON_RULES).toContain("what matters most is the actions' Priority Score order");
  });

  it("hands the pages' reads what the person asked, as the pages pass it", async () => {
    expect(await run('get_today', { brand_id: BRAND })).toEqual({ from: 'today' });
    // The run's time zone is the person's, as Today reads it from their browser.
    expect(reads.getTodayFor).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      timezone: 'Europe/Istanbul',
    });
    await run('get_action_history', {
      brand_id: BRAND,
      date_from: '2026-10-18',
      date_to: '2026-11-17',
      status: 'completed',
      category: 'growth',
      priority: 'high',
      source: 'gsc',
      search: 'AC-12',
      sort: 'oldest',
      offset: 50,
    });
    expect(reads.historyPageFor).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      dateFrom: '2026-10-18',
      dateTo: '2026-11-17',
      status: 'completed',
      category: 'growth',
      priority: 'high',
      source: 'gsc',
      search: 'AC-12',
      sort: 'oldest',
      limit: undefined,
      offset: 50,
    });
    await run('list_my_agents', { view: 'workspace', search: 'watch' });
    expect(reads.listMyAgentsFor).toHaveBeenCalledWith(ctx, {
      view: 'workspace',
      search: 'watch',
      limit: undefined,
      offset: undefined,
    });
    await run('list_agent_runs', { brand_id: BRAND, agent_id: AGENT, status: 'needs_you' });
    expect(reads.listAgentRunsFor).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      agentId: AGENT,
      status: 'needs_you',
      limit: undefined,
      offset: undefined,
    });
    await run('get_signals_summary', { brand_id: BRAND, date_from: '2026-11-01' });
    expect(reads.getSignalsSummaryFor).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      dateFrom: '2026-11-01',
      dateTo: undefined,
    });
  });

  it.each(['list_my_agents', 'list_agent_runs', 'get_action_history'])(
    'pages %s: 50 by default, its offset kept, no extra row',
    async (name) => {
      const tool = row(name);
      expect(pagedRead(tool)).toBe(true);
      expect(tool.description).toContain('next_offset');
      expect(await scopeRead(tool, { ...tool.fixture.input }, facts)).toMatchObject({
        input: { limit: ROW_CAP },
        cap: { rows: ROW_CAP, probe: null },
      });
      expect(
        await scopeRead(tool, { ...tool.fixture.input, limit: 200, offset: 100 }, facts),
      ).toMatchObject({ input: { limit: ROW_CAP, offset: 100 }, cap: { probe: null } });
    },
  );

  it("reads History and the Signals summary over the run's period, and Today as it is now", async () => {
    for (const name of ['get_action_history', 'get_signals_summary']) {
      const tool = row(name);
      expect(await scopeRead(tool, { brand_id: BRAND }, { ...facts, range: '7d' })).toMatchObject({
        input: { date_from: '2026-11-11', date_to: '2026-11-17' },
        used: { dates: 'default', range: '7d' },
      });
      // A period the person named is theirs; all time lifts the window.
      expect(
        await scopeRead(tool, { brand_id: BRAND }, { ...facts, question: 'Tüm zamanlar' }),
      ).toMatchObject({ used: { dates: 'all_time' } });
    }
    expect(await scopeRead(row('get_today'), { brand_id: BRAND }, facts)).toMatchObject({
      input: { brand_id: BRAND },
      used: { dates: 'none' },
    });
  });

  it("names its inputs as the other reads do, so a page's filters map by name", () => {
    const fields = (name: string) => Object.keys(row(name).inputSchema.shape).sort();
    expect(fields('get_action_history')).toEqual(
      [
        'brand_id',
        'category',
        'date_from',
        'date_to',
        'limit',
        'offset',
        'priority',
        'search',
        'sort',
        'source',
        'status',
      ].sort(),
    );
    expect(fields('get_signals_summary')).toEqual(['brand_id', 'date_from', 'date_to']);
    expect(fields('list_agent_runs')).toEqual([
      'agent_id',
      'brand_id',
      'limit',
      'offset',
      'status',
    ]);
    expect(fields('list_my_agents')).toEqual(['limit', 'offset', 'search', 'view']);
    // A brand's reads take its brand; Your agents are the workspace's, as the page lists them.
    expect(row('list_my_agents').brandOf).toBeNull();
    for (const name of ['get_today', 'list_agent_runs', 'get_signals_summary']) {
      expect(row(name).brandOf).toEqual({ input: 'brand_id' });
    }
  });

  it('reads outside text as untrusted, and the counts and agents as the workspace’s own', () => {
    // Today's actions and signals carry outside text (prompts, competitors, AI answers).
    expect(taintsRun('get_today')).toBe(true);
    expect(taintsRun('get_action_history')).toBe(true);
    expect(TRUSTED_READS.has('get_signals_summary')).toBe(true);
    expect(taintsRun('list_my_agents')).toBe(false);
    expect(taintsRun('list_agent_runs')).toBe(false);
  });
});
