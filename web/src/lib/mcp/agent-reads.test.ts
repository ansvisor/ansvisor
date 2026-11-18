// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';
import { BRAND, ORG, OTHER_ORG, PEOPLE, seedWorkspace } from '@/lib/chat/testing/chat-fixtures';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * Chat's reads of Action Center › Agents (plan step 6b): the agents the page
 * lists for the person, in its tab and order, and an agent's runs as its Runs
 * tab lists them, held to the brand asked about. Read through the page's own
 * functions (listAgents, runsOf, runViews) on the same rows the page reads:
 * another person's private agent is never shown, nor another workspace's.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/mcp/account', () => ({
  getAiUsageFor: vi.fn(async () => ({ active_plan: true, unlimited: false, percent_used: 10 })),
}));
vi.mock('@/lib/chat/own-key-cap', () => ({
  ownKeyCapReached: vi.fn(async () => null),
  readOwnKeyCap: vi.fn(async () => null),
}));
vi.mock('@/lib/chat/key', () => ({
  resolveChatModelKey: vi.fn(async () => ({ source: 'ansvisor' })),
  failingOwnKey: vi.fn(async () => null),
}));
vi.mock('@/lib/chat/agent-shares', () => ({ readAgentShares: vi.fn(async () => null) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const agents = await import('@/lib/chat/agents');
const { createAgentInput } = await import('@/lib/chat/agent-rules');
const { listAgentRunsFor, listMyAgentsFor } = await import('./agent-reads');

const NOW = new Date('2026-10-29T12:00:00.000Z');
const BRAND_2 = '33333333-3333-4333-8333-333333333333';
const FOREIGN = '77777777-7777-4777-8777-777777777777';

const authOf = (userId: string, role: McpAuthContext['role']): McpAuthContext => ({
  userId,
  email: null,
  organizationId: ORG,
  role,
  apiKeyId: 'agent-internal',
  brandAccess: 'all',
});
const MANAGER = authOf(PEOPLE.manager, 'manager');
const OTHER = authOf(PEOPLE.otherManager, 'manager');
const ANALYST = authOf(PEOPLE.analyst, 'analyst');

const ctxOf = async (userId: string) =>
  (await agents.readAgentContext({ userId, email: null, organizationId: ORG }))!;

async function create(userId: string, over: Record<string, unknown> = {}) {
  const result = await agents.createAgent(
    await ctxOf(userId),
    createAgentInput.parse({
      name: 'Visibility Watch',
      skills: ['winback'],
      scope: { brand_ids: [BRAND, BRAND_2] },
      ...over,
    }),
    NOW,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.refusal));
  return result.value;
}

const run = (agentId: string, n: number, over: Record<string, unknown> = {}) => ({
  id: `dddddddd-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  organization_id: ORG,
  agent_id: agentId,
  agent_version: 1,
  brand_id: BRAND,
  trigger_kind: 'schedule',
  acting_user_id: PEOPLE.manager,
  status: 'done',
  max_share: 0.1,
  usage_share: 0.02,
  outcome: 'improved',
  queued_at: `2026-10-${String(n).padStart(2, '0')}T08:00:00.000Z`,
  ...over,
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seedWorkspace(db);
  db.unique = {
    ...db.unique,
    chat_agents: [['organization_id', 'name']],
    chat_agent_versions: [['agent_id', 'version']],
  };
  const iso = () => NOW.toISOString();
  db.defaults = {
    ...db.defaults,
    chat_agents: () => ({
      created_at: iso(),
      updated_at: iso(),
      activated_at: null,
      archived_at: null,
      paused_reason: null,
      max_month_share: null,
    }),
    chat_agent_versions: () => ({ created_at: iso() }),
    chat_agent_triggers: () => ({ created_at: iso(), last_fired_at: null }),
  };
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false },
    { id: BRAND_2, organization_id: ORG, name: 'Brand B', is_demo: false },
    { id: FOREIGN, organization_id: OTHER_ORG, name: 'Theirs', is_demo: false },
  ];
  db.tables.profiles = db.tables.profiles.map((p) => ({ ...p, full_name: 'Sam Lee' }));
  db.tables.chat_agents = [];
  db.tables.chat_agent_versions = [];
  db.tables.chat_agent_triggers = [];
  db.tables.chat_agent_runs = [];
  db.tables.chat_conversations = [];
});

afterEach(() => vi.unstubAllEnvs());

describe('list_my_agents', () => {
  it("lists the page's agents for the person, in the page's tab and order", async () => {
    await create(PEOPLE.manager, { name: 'Visibility Watch' });
    await create(PEOPLE.manager, { name: 'Citation Fixer', visibility: 'workspace' });
    await create(PEOPLE.otherManager, { name: 'Shared by another', visibility: 'workspace' });

    for (const view of ['mine', 'workspace'] as const) {
      const page = await agents.listAgents(await ctxOf(PEOPLE.manager), { view });
      const read = await listMyAgentsFor(MANAGER, { view });
      expect(read?.agents.map((a) => [a.id, a.name, a.status, a.mode])).toEqual(
        page.agents.map((a) => [a.id, a.name, a.status, a.mode]),
      );
      expect(read?.tabs).toEqual(page.counts);
    }
    // Mine first for those who make agents, as the page opens.
    expect((await listMyAgentsFor(MANAGER, {}))?.view).toBe('mine');
    expect((await listMyAgentsFor(MANAGER, {}))?.agents.map((a) => a.name).sort()).toEqual([
      'Citation Fixer',
      'Visibility Watch',
    ]);
  });

  it("never shows another person's private agent, and opens on Workspace for those who only read", async () => {
    await create(PEOPLE.otherManager, { name: 'Their private' });
    await create(PEOPLE.otherManager, { name: 'Their shared', visibility: 'workspace' });

    const names = async (auth: McpAuthContext) => {
      const seen: string[] = [];
      for (const view of ['mine', 'workspace', 'paused', 'archived'] as const) {
        seen.push(...((await listMyAgentsFor(auth, { view }))?.agents.map((a) => a.name) ?? []));
      }
      return seen;
    };
    expect(await names(MANAGER)).toEqual(['Their shared']);
    expect(await names(OTHER)).toEqual(expect.arrayContaining(['Their private', 'Their shared']));
    const analyst = await listMyAgentsFor(ANALYST, {});
    expect(analyst?.view).toBe('workspace');
    expect(analyst?.agents.map((a) => a.name)).toEqual(['Their shared']);
    // Someone of another workspace reads none of them.
    expect(await listMyAgentsFor({ ...MANAGER, organizationId: OTHER_ORG }, {})).toBeNull();
  });

  it('pages them, with the total and where the next page starts, and finds one by its name', async () => {
    for (const name of ['One', 'Two', 'Three']) await create(PEOPLE.manager, { name });
    const first = await listMyAgentsFor(MANAGER, { limit: 2 });
    expect(first).toMatchObject({ total: 3, offset: 0, next_offset: 2 });
    expect(first?.agents).toHaveLength(2);
    const next = await listMyAgentsFor(MANAGER, { limit: 2, offset: 2 });
    expect(next).toMatchObject({ total: 3, offset: 2, next_offset: null });
    expect([...first!.agents, ...next!.agents].map((a) => a.name).sort()).toEqual([
      'One',
      'Three',
      'Two',
    ]);
    expect((await listMyAgentsFor(MANAGER, { search: 'thr' }))?.agents.map((a) => a.name)).toEqual([
      'Three',
    ]);
  });

  it('says what each card says: its last run, whether it waits on the person, and its page', async () => {
    const { id } = await create(PEOPLE.manager, { visibility: 'workspace' });
    db.tables.chat_agent_runs.push(run(id, 1), run(id, 2, { status: 'needs_you', outcome: null }));
    const [agent] = (await listMyAgentsFor(MANAGER, {}))!.agents;
    expect(agent).toMatchObject({
      name: 'Visibility Watch',
      mine: true,
      visibility: 'workspace',
      skills: ['winback'],
      brands: ['Brand A', 'Brand B'],
      last_run: { status: 'needs_you', waits_on_you: true },
      open: `/dashboard/agents/${id}`,
    });
  });
});

describe('list_agent_runs', () => {
  it("lists the Runs tab's runs on this brand, newest first, and what waits on the person", async () => {
    const { id } = await create(PEOPLE.manager, { visibility: 'workspace' });
    db.tables.chat_agent_runs.push(
      run(id, 1),
      run(id, 2, { brand_id: BRAND_2 }),
      run(id, 3, { status: 'needs_you', outcome: null }),
      run(id, 4, { status: 'failed', stop_reason: 'error', outcome: null }),
    );
    const tab = await agents.listAgentRuns(await ctxOf(PEOPLE.manager), id, 50);
    const read = await listAgentRunsFor(MANAGER, { brandId: BRAND, agentId: id });
    // The page's runs, on this brand only.
    expect(read?.runs.map((r) => [r.status, r.queued])).toEqual(
      tab!.filter((r) => r.brand === 'Brand A').map((r) => [r.status, r.queuedAt]),
    );
    expect(read?.runs.map((r) => r.queued.slice(0, 10))).toEqual([
      '2026-10-04',
      '2026-10-03',
      '2026-10-01',
    ]);
    expect(read?.runs[1]).toMatchObject({ status: 'needs_you', waits_on_you: true });
    expect(read).toMatchObject({ total: 3, offset: 0, next_offset: null });
    expect(read?.agent).toMatchObject({ name: 'Visibility Watch' });

    const waiting = await listAgentRunsFor(MANAGER, {
      brandId: BRAND,
      agentId: id,
      status: 'needs_you',
    });
    expect(waiting?.runs.map((r) => r.status)).toEqual(['needs_you']);
    const paged = await listAgentRunsFor(MANAGER, { brandId: BRAND, agentId: id, limit: 1 });
    expect(paged).toMatchObject({ total: 3, next_offset: 1 });
    expect(paged?.runs).toHaveLength(1);
  });

  it('links the agents a run started, and never names one the person can’t see', async () => {
    const caller = await create(PEOPLE.manager, { name: 'AEO Operator', visibility: 'workspace' });
    const shared = await create(PEOPLE.manager, { name: 'FAQ writer', visibility: 'workspace' });
    const theirs = await create(PEOPLE.otherManager, { name: 'Their private' });
    const hiddenCaller = await create(PEOPLE.otherManager, { name: 'Their Operator' });
    const parent = run(caller.id, 1).id;
    db.tables.chat_agent_runs.push(
      run(caller.id, 1),
      run(shared.id, 2, { trigger_kind: 'agent', called_by_run_id: parent }),
      run(theirs.id, 3, { trigger_kind: 'agent', called_by_run_id: parent }),
      // A run of the shared agent someone's private agent started.
      run(hiddenCaller.id, 4, { acting_user_id: PEOPLE.otherManager }),
      run(shared.id, 5, { trigger_kind: 'agent', called_by_run_id: run(hiddenCaller.id, 4).id }),
    );
    db.tables.chat_conversations.push(
      {
        id: 'cccccccc-0000-4000-8000-000000000002',
        organization_id: ORG,
        agent_run_id: run(shared.id, 2).id,
        user_id: PEOPLE.manager,
        shared_at: null,
        deleted_at: null,
      },
      {
        id: 'cccccccc-0000-4000-8000-000000000003',
        organization_id: ORG,
        agent_run_id: run(theirs.id, 3).id,
        user_id: PEOPLE.manager,
        shared_at: null,
        deleted_at: null,
      },
    );

    const read = await listAgentRunsFor(MANAGER, { brandId: BRAND, agentId: caller.id });
    expect(read?.runs[0].ran_agents).toEqual([
      {
        agent: 'FAQ writer',
        status: 'done',
        open: '/dashboard/chat/cccccccc-0000-4000-8000-000000000002',
        agent_page: `/dashboard/agents/${shared.id}`,
      },
      { agent: 'An agent you can’t see', status: 'done' },
    ]);
    const body = JSON.stringify(read);
    expect(body).not.toContain('Their private');
    expect(body).not.toContain(theirs.id);
    expect(body).not.toContain('cccccccc-0000-4000-8000-000000000003');

    // Called by: the agent's name when the person sees it, nothing otherwise.
    const sharedRuns = await listAgentRunsFor(MANAGER, { brandId: BRAND, agentId: shared.id });
    expect(sharedRuns?.runs.map((r) => [r.trigger, r.called_by])).toEqual([
      ['agent', undefined],
      ['agent', 'AEO Operator'],
    ]);
    expect(JSON.stringify(sharedRuns)).not.toContain('Their Operator');

    // The private agent's owner sees it by name, its page too.
    const owner = await listAgentRunsFor(OTHER, { brandId: BRAND, agentId: caller.id });
    expect(owner?.runs[0].ran_agents).toEqual([
      {
        agent: 'FAQ writer',
        status: 'done',
        open: null,
        agent_page: `/dashboard/agents/${shared.id}`,
      },
      {
        agent: 'Their private',
        status: 'done',
        open: null,
        agent_page: `/dashboard/agents/${theirs.id}`,
      },
    ]);
  });

  it("is not found for another person's private agent, or a brand of another workspace", async () => {
    const { id } = await create(PEOPLE.otherManager, { name: 'Their private' });
    db.tables.chat_agent_runs.push(run(id, 1, { acting_user_id: PEOPLE.otherManager }));
    expect(await listAgentRunsFor(MANAGER, { brandId: BRAND, agentId: id })).toBeNull();
    expect((await listAgentRunsFor(OTHER, { brandId: BRAND, agentId: id }))?.runs).toHaveLength(1);
    expect(await listAgentRunsFor(OTHER, { brandId: FOREIGN, agentId: id })).toBeNull();
    // A brand not shared with the person: not found either.
    expect(
      await listAgentRunsFor({ ...OTHER, brandAccess: [BRAND_2] }, { brandId: BRAND, agentId: id }),
    ).toBeNull();
  });
});
