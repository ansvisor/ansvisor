// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '../testing/fake-supabase';
import { BRAND, ORG, OTHER_ORG, PEOPLE, seedWorkspace } from '../testing/chat-fixtures';

/**
 * The AEO Operator's tools (AEO Operator plan §4.2 steps 4–6, §4.5):
 * run_agent_plan's row (a card in every mode, Growth and up, Admins and
 * Managers, approved from Slack too) and its card read from the plan's row
 * only; its Approve, from the app or Slack, starts the plan's agents once,
 * even when retried; Skip declines the plan; get_agent_plan reads the run's
 * plan as the workspace's own data. With an in-memory database; the dispatch
 * itself is agent-children.test.ts's.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('../testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
const dispatch = vi.hoisted(() => ({ children: vi.fn() }));
vi.mock('../agent-children', async (original) => ({
  ...(await original<typeof import('../agent-children')>()),
  dispatchChildren: dispatch.children,
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { chatTool, CHAT_TOOLS } = await import('./tools');
const { runsWithoutSession } = await import('./define-tool');
const { WORKSPACE_READS, taintsRun } = await import('../untrusted');
const { runLoggedWrite } = await import('../write');
const { isOperatorRun, approvePlanFor, readAgentPlanFor } = await import('../operator/approve');
const { itemLine, planTarget } = await import('../operator/plan-card');

const OPERATOR = 'abababab-0000-4000-8000-0000000000f1';
const WINBACK = 'abababab-0000-4000-8000-0000000000a1';
const RIVALS = 'abababab-0000-4000-8000-0000000000a2';
const FAQ = 'abababab-0000-4000-8000-0000000000a3';
const REPORT = 'abababab-0000-4000-8000-0000000000a4';
const RUN = 'eeeeeeee-0000-4000-8000-0000000000f1';
const PLAN = 'f0f0f0f0-0000-4000-8000-000000000001';
const DEMO = '77777777-7777-4777-8777-777777777777';

const tool = () => chatTool('run_agent_plan')!;
const read = () => chatTool('get_agent_plan')!;
const input = { plan_id: PLAN, brand_id: BRAND };
const planRow = () => db.tables.chat_agent_plans[0];

function seed() {
  seedWorkspace(db);
  db.unique = { ...db.unique, chat_idempotency_keys: [['organization_id', 'key']] };
  db.tables.member_brands = [];
  // can_access_brand (00388): a brand of the person's organization, with All brands or shared.
  db.rpcs = {
    ...db.rpcs,
    can_access_brand: ({ p_brand_id, p_user_id }) => {
      const person = db.tables.profiles.find((p) => p.id === p_user_id);
      const brand = db.tables.brands.find((b) => b.id === p_brand_id);
      if (!person || !brand || brand.organization_id !== person.organization_id) return false;
      return (
        person.brand_scope === 'all' ||
        db.tables.member_brands.some((m) => m.user_id === p_user_id && m.brand_id === p_brand_id)
      );
    },
  };
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false },
    { id: DEMO, organization_id: ORG, name: 'Demo', is_demo: true },
  ];
  const agent = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    id,
    organization_id: ORG,
    name,
    status: 'active',
    owner_id: PEOPLE.manager,
    visibility: 'private',
    version: 1,
    max_run_share: 0.1,
    kind: 'agent',
    ...over,
  });
  db.tables.chat_agents = [
    agent(OPERATOR, 'AEO Operator', { kind: 'operator', max_run_share: 0.05 }),
    agent(WINBACK, 'Citation Win-back'),
    agent(RIVALS, 'Competitor Watch'),
    agent(FAQ, 'FAQ Builder'),
    agent(REPORT, 'Weekly Report'),
  ];
  db.tables.chat_agent_runs = [
    {
      id: RUN,
      organization_id: ORG,
      agent_id: OPERATOR,
      brand_id: BRAND,
      acting_user_id: PEOPLE.manager,
      status: 'needs_you',
    },
  ];
  const item = (agentId: string, share: number, cost: number, reasons: unknown[]) => ({
    agent_id: agentId,
    share,
    cost,
    value: 3,
    reasons,
    child_run_id: null,
  });
  db.tables.chat_agent_plans = [
    {
      id: PLAN,
      organization_id: ORG,
      agent_id: OPERATOR,
      run_id: RUN,
      brand_id: BRAND,
      plan_day: '2026-11-02',
      status: 'proposed',
      budget_share: 0.05,
      planned_share: 0.05,
      items: [
        item(WINBACK, 0.02, 0.012, [
          { code: 'open_actions', category: 'recover', count: 3 },
          { code: 'new_signals', category: 'citation', count: 2 },
          { code: 'improved', count: 1 },
          { code: 'kpi_off_track', kpi: 'citations' },
          { code: 'last_ran', days: 9 },
        ]),
        item(RIVALS, 0.01, 0.008, [
          { code: 'open_actions', category: 'compete', count: 1 },
          { code: 'never_ran' },
        ]),
        item(FAQ, 0.01, 0.006, [{ code: 'focus', count: 2 }]),
        item(REPORT, 0.01, 0.005, [{ code: 'overdue', days: 4 }]),
      ],
      passed: [{ agent_id: 'abababab-0000-4000-8000-0000000000a9', reason: 'ran_recently' }],
      decided_at: null,
      created_at: '2026-11-02T04:00:00.000Z',
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_OPERATOR', 'true');
  seed();
  dispatch.children.mockImplementation(
    async (_actor, _run, _plan, items: { agent_id: string }[]) => ({
      ok: true,
      repeated: false,
      children: items.map((item, i) =>
        i === items.length - 1
          ? {
              agent_id: item.agent_id,
              status: 'skipped',
              run_id: null,
              share: null,
              reason: 'busy',
              message: 'It already has a run waiting or working on this brand.',
            }
          : { agent_id: item.agent_id, status: 'queued', run_id: `child-${i}`, share: 0.01 },
      ),
    }),
  );
});

afterEach(() => vi.unstubAllEnvs());

describe('run_agent_plan’s row', () => {
  it('is a card in every mode, Growth and up, Admins and Managers, on the plan’s brand', () => {
    expect(tool()).toMatchObject({
      class: 'write',
      defaultPolicy: 'ask',
      maxPolicy: 'ask',
      flags: { alwaysCard: true },
      minRole: 'manager',
      planGate: { minPlan: 'growth' },
      brandOf: { input: 'brand_id' },
      sessionFree: true,
      area: 'agents',
      mcpTool: null,
    });
    // Its answer is codes and statuses: nothing to taint the run with.
    expect(tool().taintsRun).toBeUndefined();
    // Its input is ids only.
    expect(Object.keys(tool().inputSchema.shape).sort()).toEqual(['brand_id', 'plan_id']);
    expect(tool().inputSchema.safeParse({ ...input, agents: [WINBACK] }).data).toEqual(input);
    expect(tool().inputSchema.safeParse({ plan_id: 'today', brand_id: BRAND }).success).toBe(false);
  });

  it('works from Slack: a write that runs without its person’s session (slack-approval.ts fromSlack)', () => {
    // fromSlack = a card (ask) on a write whose change runs with no session.
    expect(tool().class === 'write' && runsWithoutSession(tool())).toBe(true);
    expect(tool().runFor).toBeTypeOf('function');
  });

  it('is offered only in an AEO Operator’s run; get_agent_plan too', async () => {
    for (const row of [tool(), read()]) {
      expect(await row.offerIn!({ agentRunId: RUN })).toBe(true);
      expect(await row.offerIn!({ agentRunId: null })).toBe(false);
    }
    db.tables.chat_agents[0].kind = 'agent';
    expect(await tool().offerIn!({ agentRunId: RUN })).toBe(false);
    expect(await isOperatorRun(RUN)).toBe(false);
    // Only the Operator's own workspace's agent counts.
    db.tables.chat_agents[0].kind = 'operator';
    db.tables.chat_agents[0].organization_id = OTHER_ORG;
    expect(await isOperatorRun(RUN)).toBe(false);
  });

  it('reads get_agent_plan as the workspace’s own data: in its labelled block, never tainting', () => {
    expect(WORKSPACE_READS.has('get_agent_plan')).toBe(true);
    expect(taintsRun('get_agent_plan')).toBe(false);
    expect(read().class).toBe('read');
    expect(CHAT_TOOLS.filter((t) => t.name.includes('agent_plan')).map((t) => t.name)).toEqual([
      'get_agent_plan',
      'run_agent_plan',
    ]);
  });
});

describe('the plan’s card', () => {
  it('lists each agent by its name, why in words from the plan’s codes, and about what it costs', async () => {
    const details = await tool().cardDetails!(input, { organizationId: ORG });
    expect(details.items).toEqual([
      {
        title: 'Citation Win-back',
        detail:
          '3 open Recover actions · 2 new Citation signals · last ran 9 days ago · about 1.2%',
      },
      {
        title: 'Competitor Watch',
        detail: '1 open Compete action · it hasn’t run before · about 0.8%',
      },
      { title: 'FAQ Builder', detail: '2 focus actions on Today · about 0.6%' },
      { title: 'Weekly Report', detail: '4 days overdue · about 0.5%' },
    ]);
    expect(details.goal).toBe('Within your 5% daily budget');
    expect(details.why).toMatch(/^Picked by the app from Brand A’s own numbers today/);
    expect(details.why).toMatch(/1 other agent waits for another day\.$/);
    expect(details.targets).toEqual([
      { kind: 'aiUse', values: ['Up to 5% of the monthly AI limit'] },
    ]);
  });

  it('says what Slack shows as its line: two names, how many more, and the budget', async () => {
    expect(await tool().target!(input, { organizationId: ORG })).toBe(
      'Citation Win-back, Competitor Watch +2 · up to 5%',
    );
    // Paced below its daily budget: today's, said so.
    planRow().budget_share = 0.03;
    const paced = await tool().cardDetails!(input, { organizationId: ORG });
    expect(paced.goal).toBe(
      'Within today’s 3%, paced to the month’s AI limit (your daily budget is 5%)',
    );
    // Nothing metered (self-hosted): no AI line, the count instead.
    planRow().budget_share = null;
    planRow().items = (planRow().items as unknown[]).slice(0, 2);
    expect(await tool().target!(input, { organizationId: ORG })).toBe(
      'Citation Win-back, Competitor Watch',
    );
    const count = await tool().cardDetails!(input, { organizationId: ORG });
    expect(count.goal).toBe('At most 2 agents today');
    expect(count.targets).toBeUndefined();
  });

  it('is read from the plan’s row only, in the run’s workspace and the plan’s brand', async () => {
    expect(await tool().target!(input, { organizationId: OTHER_ORG })).toBeNull();
    expect(await tool().cardDetails!(input, { organizationId: OTHER_ORG })).toEqual({});
    expect(await tool().target!({ ...input, brand_id: DEMO }, { organizationId: ORG })).toBeNull();
    // An agent's name comes from its row, never from the call.
    db.tables.chat_agents[1].name = 'Renamed';
    expect(await tool().target!(input, { organizationId: ORG })).toMatch(/^Renamed, /);
  });

  it('words a line without reasons, and an agent gone since, plainly', () => {
    expect(itemLine({ reasons: [], cost: 0.01 })).toBe('about 1%');
    expect(itemLine({ reasons: [{ code: 'never_ran' }], cost: null })).toBe('it hasn’t run before');
    const view = {
      budgetShare: 0.05,
      items: [{ agent_id: 'gone' }],
    } as unknown as Parameters<typeof planTarget>[0];
    expect(planTarget(view, new Map())).toBe('An agent · up to 5%');
  });
});

describe('approving the plan', () => {
  const ctx = (userId: string) => ({
    userId,
    email: null,
    organizationId: ORG,
    role: 'manager' as const,
    apiKeyId: 'agent-internal',
    brandAccess: 'all' as const,
    chat: {
      conversationId: 'chat-1',
      runId: 'run-1',
      agentRunId: RUN,
      approvalKey: 'step-1',
      executionMode: 'assisted' as const,
    },
  });

  it('from Slack (runFor): starts the plan’s agents as the run’s person, and answers codes only', async () => {
    const answer = await tool().runFor!(ctx(PEOPLE.manager), input);
    expect(dispatch.children).toHaveBeenCalledTimes(1);
    expect(dispatch.children).toHaveBeenCalledWith(
      PEOPLE.manager,
      RUN,
      PLAN,
      [WINBACK, RIVALS, FAQ, REPORT].map((agent_id) => ({ agent_id })),
      {},
    );
    expect(answer).toEqual({
      ok: true,
      plan_id: PLAN,
      repeated: false,
      started: 3,
      skipped: 1,
      children: [
        { agent_id: WINBACK, status: 'queued' },
        { agent_id: RIVALS, status: 'queued' },
        { agent_id: FAQ, status: 'queued' },
        { agent_id: REPORT, status: 'skipped', reason: 'busy' },
      ],
    });
    expect(JSON.stringify(answer)).not.toMatch(/Citation Win-back|It already has a run/);
    expect(tool().doneStep!(input, answer)).toEqual({
      label: '3 agents started',
      detail: '1 skipped',
    });
  });

  it('from Slack, checks the person as their session would be: writable, not the demo, a Manager, their brand', async () => {
    const refusal = async (userId: string, over: Partial<typeof input> = {}) => {
      const answer = await approvePlanFor(
        { userId, organizationId: ORG },
        { ...input, ...over },
        RUN,
      );
      return answer.ok ? 'ok' : answer.reason;
    };
    expect(await refusal(PEOPLE.analyst)).toBe('forbidden');
    expect(await refusal(PEOPLE.manager, { brand_id: DEMO })).toBe('demo_brand');
    db.tables.organizations.find((o) => o.id === ORG)!.subscription_status = 'canceled';
    expect(await refusal(PEOPLE.manager)).toBe('read_only');
    db.tables.organizations.find((o) => o.id === ORG)!.subscription_status = 'active';
    // A brand not shared with them (Selected brands).
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.brand_scope = 'selected';
    db.tables.member_brands = [];
    expect(await refusal(PEOPLE.manager)).toBe('not_found');
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.brand_scope = 'all';
    // Another workspace's brand, or a plan that isn't this run's.
    expect(
      await refusal(PEOPLE.manager, { brand_id: '88888888-8888-4888-8888-888888888888' }),
    ).toBe('not_found');
    planRow().run_id = 'eeeeeeee-0000-4000-8000-000000000009';
    expect(await refusal(PEOPLE.manager)).toBe('not_found');
    expect(dispatch.children).not.toHaveBeenCalled();
    // Outside an Operator's run: nothing.
    planRow().run_id = RUN;
    const none = await approvePlanFor({ userId: PEOPLE.manager, organizationId: ORG }, input, null);
    expect(none).toMatchObject({ ok: false, reason: 'not_operator' });
    // The dispatch's own refusal is passed on with its words.
    dispatch.children.mockResolvedValueOnce({
      ok: false,
      reason: 'not_yours',
      message: 'Only the person this run acts as can start its plan.',
    });
    expect(await approvePlanFor({ userId: PEOPLE.admin, organizationId: ORG }, input, RUN)).toEqual(
      {
        ok: false,
        reason: 'not_yours',
        message: 'Only the person this run acts as can start its plan.',
      },
    );
  });

  it('starts the agents once, even when the approval is retried (the approval’s key)', async () => {
    const approve = () =>
      runLoggedWrite({
        tool: tool(),
        input,
        ctx: ctx(PEOPLE.manager),
        organizationId: ORG,
        userId: PEOPLE.manager,
        brandId: BRAND,
        surface: 'chat',
        mode: 'auto',
        approval: { kind: 'ask', via: 'slack' },
        place: { conversationId: 'chat-1', runId: 'run-1', stepId: 'step-1', agentRunId: RUN },
        approvalKey: 'step-1',
        withoutSession: true,
      });
    const first = await approve();
    const again = await approve();
    expect(first).toMatchObject({ code: 'ok', repeated: false });
    expect(again).toMatchObject({
      code: 'ok',
      repeated: true,
      output: first.code === 'ok' ? first.output : null,
    });
    expect(dispatch.children).toHaveBeenCalledTimes(1);
  });
});

describe('skipping the plan', () => {
  it('declines it, as the person who skipped it; nothing starts', async () => {
    await tool().onSkip!({ userId: PEOPLE.manager, organizationId: ORG, agentRunId: RUN }, input);
    expect(planRow()).toMatchObject({ status: 'declined', decided_by: PEOPLE.manager });
    expect(dispatch.children).not.toHaveBeenCalled();
  });

  it('leaves a plan no longer proposed, another run’s or another workspace’s as it is', async () => {
    planRow().status = 'dispatched';
    await tool().onSkip!({ userId: PEOPLE.manager, organizationId: ORG, agentRunId: RUN }, input);
    expect(planRow().status).toBe('dispatched');
    planRow().status = 'proposed';
    await tool().onSkip!(
      {
        userId: PEOPLE.manager,
        organizationId: ORG,
        agentRunId: 'eeeeeeee-0000-4000-8000-000000000009',
      },
      input,
    );
    await tool().onSkip!(
      { userId: PEOPLE.manager, organizationId: OTHER_ORG, agentRunId: RUN },
      input,
    );
    expect(planRow().status).toBe('proposed');
  });
});

describe('get_agent_plan', () => {
  it('reads this run’s plan: ids, codes, shares, and its agents’ names', async () => {
    const plan = await readAgentPlanFor(ORG, RUN);
    expect(plan).toMatchObject({
      ok: true,
      plan_id: PLAN,
      brand_id: BRAND,
      day: '2026-11-02',
      status: 'proposed',
      budget_share: 0.05,
      passed_over: 1,
    });
    expect((plan.agents as { name: string }[]).map((a) => a.name)).toEqual([
      'Citation Win-back',
      'Competitor Watch',
      'FAQ Builder',
      'Weekly Report',
    ]);
    expect(await readAgentPlanFor(ORG, null)).toEqual({ ok: false, code: 'not_operator' });
    expect(await readAgentPlanFor(OTHER_ORG, RUN)).toEqual({ ok: false, code: 'no_plan' });
  });
});
