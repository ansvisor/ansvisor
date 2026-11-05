// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import { BRAND, ORG, OTHER_ORG, PEOPLE, seedWorkspace } from './testing/chat-fixtures';

/**
 * "What this agent did" (the agent page's card): the agent's ship events of
 * the last 30 days with their measurements, read as Reports reads them,
 * with Reports' headline (only Medium and High verdicts in Improved X of
 * Y); how each went live and from which run; the drafts its runs made that
 * aren't live, found through each draft's chat; all on the brands the
 * person may see, as the ledger's policy (00424) has it.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/mcp/account', () => ({
  getAiUsageFor: vi.fn(async () => ({ active_plan: true, unlimited: false, percent_used: 10 })),
}));
vi.mock('./key', () => ({
  resolveChatModelKey: vi.fn(async () => ({ source: 'ansvisor' })),
  failingOwnKey: vi.fn(async () => null),
}));
vi.mock('./agent-shares', () => ({ readAgentShares: vi.fn(async () => null) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const agents = await import('./agents');
const { readAgentImpact, shipCredit } = await import('./agent-impact');

const NOW = new Date('2026-11-05T12:00:00.000Z');
const BRAND_2 = '33333333-3333-4333-8333-333333333333';
const DEMO = '66666666-6666-4666-8666-666666666666';
const AGENT = 'abababab-0000-4000-8000-000000000001';
const OTHER_AGENT = 'abababab-0000-4000-8000-000000000002';

let seq = 0;
const id = (prefix: string) => `${prefix}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

async function ctxOf(userId: string) {
  const ctx = await agents.readAgentContext({ userId, email: null, organizationId: ORG });
  if (!ctx) throw new Error('no context');
  return ctx;
}

function seedAgent(
  agentId: string,
  over: { owner?: string; visibility?: string; scope?: Record<string, unknown> } = {},
) {
  db.tables.chat_agents.push({
    id: agentId,
    organization_id: ORG,
    name: `Agent ${agentId.slice(-2)}`,
    status: 'active',
    paused_reason: null,
    owner_id: over.owner ?? PEOPLE.manager,
    visibility: over.visibility ?? 'workspace',
    version: 1,
    max_run_share: 0.1,
    max_month_share: null,
    created_by: over.owner ?? PEOPLE.manager,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    activated_at: '2026-09-01T00:00:00.000Z',
    archived_at: null,
    demo_brand_id: null,
  });
  db.tables.chat_agent_versions.push({
    agent_id: agentId,
    version: 1,
    skill_ids: ['winback'],
    instructions: null,
    mode: 'auto',
    connections: [],
    model: 'auto',
    effort: 'normal',
    scope: over.scope ?? { brand_ids: [BRAND] },
    notify_user_ids: [],
    followup_days: 14,
    can_call: null,
    created_at: '2026-09-01T00:00:00.000Z',
  });
}

/** A measurement as the job keeps it. */
const measured = (outcome: string, confidence: string | null, extra = {}) => ({
  targets: [
    { type: 'prompt', id: 'p1', label: 'best cold brew ratio' },
    { type: 'prompt', id: 'p2', label: 'cold brew at home' },
  ],
  window_json: {},
  metrics: [{ metric: 'visibility', before: 10, after: 16.4, effect: 6.4 }],
  outcome,
  confidence,
  checkpoint: outcome === 'pending' ? null : 'd14',
  checkpoints_json: [],
  not_measurable_reason: outcome === 'not_measurable' ? 'too_few_prompts' : null,
  concurrent_changes: [],
  next_check_at: '2026-11-20T00:00:00.000Z',
  ...extra,
});

function ship(over: Record<string, unknown> = {}) {
  const row = {
    id: id('5e5e5e5e'),
    organization_id: ORG,
    brand_id: BRAND,
    agent_id: AGENT,
    agent_run_id: null,
    content_draft_id: null,
    title: 'Refresh of /guides/cold-brew-ratio',
    kind: 'cms_publish',
    source: 'content_editor',
    shipped_at: '2026-10-28T10:00:00.000Z',
    shipped_by: PEOPLE.manager,
    execution_mode: 'automated',
    url: 'https://brewline.com/guides/cold-brew-ratio',
    actions: null,
    impact_measurements: measured('pending', null),
    ...over,
  };
  db.tables.ship_events.push(row);
  return row;
}

function run(queuedAt: string, over: Record<string, unknown> = {}) {
  const row = {
    id: id('dddddddd'),
    organization_id: ORG,
    agent_id: AGENT,
    agent_version: 1,
    brand_id: BRAND,
    trigger_kind: 'schedule',
    status: 'done',
    queued_at: queuedAt,
    ...over,
  };
  db.tables.chat_agent_runs.push(row);
  return row.id;
}

function chat(agentRunId: string | null, over: Record<string, unknown> = {}) {
  const row = {
    id: id('cccccccc'),
    organization_id: ORG,
    agent_run_id: agentRunId,
    user_id: PEOPLE.manager,
    shared_at: null,
    deleted_at: null,
    ...over,
  };
  db.tables.chat_conversations.push(row);
  return row.id;
}

function draft(conversationId: string | null, over: Record<string, unknown> = {}) {
  const row = {
    id: id('dfdfdfdf'),
    brand_id: BRAND,
    conversation_id: conversationId,
    archived_at: null,
    ...over,
  };
  db.tables.content_drafts.push(row);
  return row.id;
}

/** An Admin narrows the person to these brands (BRAND-ACCESS, 00388). */
const narrow = (userId: string, ...brandIds: string[]) => {
  db.tables.profiles.find((p) => p.id === userId)!.brand_scope = 'selected';
  db.tables.member_brands = brandIds.map((brand_id) => ({
    user_id: userId,
    organization_id: ORG,
    brand_id,
  }));
};

beforeEach(() => {
  seedWorkspace(db);
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false },
    { id: BRAND_2, organization_id: ORG, name: 'Brand B', is_demo: false },
    { id: DEMO, organization_id: ORG, name: 'Demo', is_demo: true },
  ];
  db.tables.profiles = db.tables.profiles.map((p) =>
    p.id === PEOPLE.otherManager ? { ...p, full_name: 'Sam Lee' } : p,
  );
  db.tables.member_brands = [];
  db.tables.chat_agents = [];
  db.tables.chat_agent_versions = [];
  db.tables.chat_agent_runs = [];
  db.tables.chat_conversations = [];
  db.tables.ship_events = [];
  seedAgent(AGENT);
  seedAgent(OTHER_AGENT);
});

describe('readAgentImpact: what the agent shipped', () => {
  it('lists its changes of the last 30 days, newest first, measured as Reports reads them', async () => {
    ship({ title: 'Pending one', shipped_at: '2026-11-01T09:00:00.000Z' });
    ship({
      title: 'Improved one',
      shipped_at: '2026-10-20T09:00:00.000Z',
      impact_measurements: [measured('improved', 'high')],
    });
    ship({
      title: 'Declined, Low',
      shipped_at: '2026-10-10T09:00:00.000Z',
      impact_measurements: measured('declined', 'low'),
    });
    // 31 days ago, another agent's, another workspace's: none of them.
    ship({ title: 'Too old', shipped_at: '2026-10-05T09:00:00.000Z' });
    ship({ title: 'Another agent', agent_id: OTHER_AGENT });
    ship({ title: 'Another workspace', organization_id: OTHER_ORG });

    const impact = await readAgentImpact(await ctxOf(PEOPLE.manager), AGENT, NOW);
    expect(impact?.rows.map((r) => r.title)).toEqual([
      'Pending one',
      'Improved one',
      'Declined, Low',
    ]);
    expect(impact?.rows[1]).toMatchObject({
      outcome: 'improved',
      confidence: 'high',
      checkpoint: 'd14',
      effect: 6.4,
      targetPrompts: 2,
      kind: 'cms_publish',
    });
    // Its next checkpoint, as Reports' strip has it.
    expect(impact?.rows[1].checkpoints.find((m) => m.state === 'due')).toMatchObject({
      checkpoint: 'd7',
    });
    expect(impact?.summary).toEqual({
      shipped: 3,
      previous: null,
      improved: 1,
      judged: 1,
      pending: 1,
    });
    expect(impact?.capped).toBe(false);
    // Nothing that names a ship event or a run leaves.
    expect(JSON.stringify(impact)).not.toMatch(/5e5e5e5e|dddddddd/);
  });

  it('counts only Medium and High verdicts in "Improved X of Y", as Reports does', async () => {
    const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T09:00:00.000Z`;
    ship({ shipped_at: at(10), impact_measurements: measured('improved', 'high') });
    ship({ shipped_at: at(11), impact_measurements: measured('improved', 'medium') });
    ship({ shipped_at: at(12), impact_measurements: measured('improved', 'low') });
    ship({ shipped_at: at(13), impact_measurements: measured('no_meaningful_change', 'medium') });
    ship({ shipped_at: at(14), impact_measurements: measured('declined', 'high') });
    ship({ shipped_at: at(15), impact_measurements: measured('not_measurable', null) });
    ship({ shipped_at: at(16), impact_measurements: measured('pending', null) });
    // A ship event the job hasn't measured yet is Pending.
    ship({ shipped_at: at(17), impact_measurements: null });

    const impact = await readAgentImpact(await ctxOf(PEOPLE.manager), AGENT, NOW);
    expect(impact?.summary).toEqual({
      shipped: 8,
      previous: null,
      improved: 2,
      judged: 4,
      pending: 2,
    });
  });

  it('is empty for an agent that shipped nothing, and null for one the person can’t see', async () => {
    const ctx = await ctxOf(PEOPLE.manager);
    expect(await readAgentImpact(ctx, AGENT, NOW)).toEqual({
      rows: [],
      capped: false,
      summary: { shipped: 0, previous: null, improved: 0, judged: 0, pending: 0 },
      draftsNotLive: 0,
    });
    const hidden = 'abababab-0000-4000-8000-000000000003';
    seedAgent(hidden, { owner: PEOPLE.otherManager, visibility: 'private' });
    ship({ agent_id: hidden });
    expect(await readAgentImpact(ctx, hidden, NOW)).toBeNull();
    expect(await readAgentImpact(ctx, 'abababab-0000-4000-8000-00000000ffff', NOW)).toBeNull();
  });
});

describe('readAgentImpact: how each change went live', () => {
  it('says on its own, you approved, or by a teammate', async () => {
    // The agent's own publish: automated, sent as the person its run acts as.
    ship({ title: 'Own', execution_mode: 'automated', shipped_by: PEOPLE.manager });
    // A person's click on the run's card (ship-credit, 00480): assisted, sent by them.
    ship({ title: 'Mine', execution_mode: 'assisted', shipped_by: PEOPLE.manager });
    ship({ title: 'Sam', execution_mode: 'assisted', shipped_by: PEOPLE.otherManager });
    // Someone who left the workspace, or has no name.
    ship({ title: 'Gone', execution_mode: 'assisted', shipped_by: null });
    ship({ title: 'Nameless', execution_mode: 'assisted', shipped_by: PEOPLE.admin });

    const impact = await readAgentImpact(await ctxOf(PEOPLE.manager), AGENT, NOW);
    const credit = Object.fromEntries((impact?.rows ?? []).map((r) => [r.title, r.credit]));
    expect(credit).toEqual({
      Own: { who: 'own' },
      Mine: { who: 'you' },
      Sam: { who: 'teammate', name: 'Sam Lee' },
      Gone: { who: 'teammate', name: null },
      Nameless: { who: 'teammate', name: null },
    });
    // The same change reads "you approved" to the one who clicked, "by …" to the others.
    const sams = await readAgentImpact(await ctxOf(PEOPLE.otherManager), AGENT, NOW);
    expect(sams?.rows.find((r) => r.title === 'Sam')?.credit).toEqual({ who: 'you' });
  });

  it('shipCredit: automated is the agent’s own, whoever it acted as', () => {
    const by = (who: 'you' | 'teammate' | 'automation', name: string | null = null) => ({
      who,
      name,
    });
    expect(shipCredit({ executionMode: 'automated', by: by('you') })).toEqual({ who: 'own' });
    expect(shipCredit({ executionMode: 'automated', by: by('automation') })).toEqual({
      who: 'own',
    });
    expect(shipCredit({ executionMode: 'assisted', by: by('you') })).toEqual({ who: 'you' });
    expect(shipCredit({ executionMode: 'manual', by: by('teammate', 'Sam Lee') })).toEqual({
      who: 'teammate',
      name: 'Sam Lee',
    });
    expect(shipCredit({ executionMode: 'assisted', by: by('automation') })).toEqual({
      who: 'teammate',
      name: null,
    });
  });

  it('numbers its run among the agent’s runs, and gives the run’s chat when the person may open it', async () => {
    run('2026-09-01T09:00:00.000Z');
    const r2 = run('2026-09-20T09:00:00.000Z');
    const r3 = run('2026-10-15T09:00:00.000Z');
    const r4 = run('2026-10-28T09:00:00.000Z');
    run('2026-10-20T09:00:00.000Z', { agent_id: OTHER_AGENT });
    const own = chat(r3);
    chat(r4, { user_id: PEOPLE.otherManager });
    const shared = chat(r2, { user_id: PEOPLE.otherManager, shared_at: '2026-09-21T00:00:00Z' });
    ship({ title: 'From r3', agent_run_id: r3, shipped_at: '2026-10-16T09:00:00.000Z' });
    ship({ title: 'From r4', agent_run_id: r4, shipped_at: '2026-10-29T09:00:00.000Z' });
    // Approved later from a run before the 30 days.
    ship({ title: 'From r2', agent_run_id: r2, shipped_at: '2026-10-25T09:00:00.000Z' });
    ship({ title: 'No run', agent_run_id: null, shipped_at: '2026-10-26T09:00:00.000Z' });

    const impact = await readAgentImpact(await ctxOf(PEOPLE.manager), AGENT, NOW);
    const runs = Object.fromEntries((impact?.rows ?? []).map((r) => [r.title, r.run]));
    expect(runs).toEqual({
      'From r4': { number: 4, chatId: null },
      'No run': null,
      'From r2': { number: 2, chatId: shared },
      'From r3': { number: 3, chatId: own },
    });

    // A deleted chat isn't opened.
    db.tables.chat_conversations.find((c) => c.id === own)!.deleted_at = '2026-11-01T00:00:00Z';
    const again = await readAgentImpact(await ctxOf(PEOPLE.manager), AGENT, NOW);
    expect(again?.rows.find((r) => r.title === 'From r3')?.run).toEqual({
      number: 3,
      chatId: null,
    });
  });
});

describe('readAgentImpact: drafts that aren’t live', () => {
  it('counts the drafts its runs of the last 30 days made through their chats, without a ship event', async () => {
    const before = run('2026-09-20T09:00:00.000Z');
    const r1 = run('2026-10-15T09:00:00.000Z');
    const r2 = run('2026-10-28T09:00:00.000Z');
    const theirs = run('2026-10-20T09:00:00.000Z', { agent_id: OTHER_AGENT });
    const c1 = chat(r1);
    // A chat moved to the bin still names its run: its drafts are the agent's.
    const c2 = chat(r2, { deleted_at: '2026-10-30T00:00:00Z' });

    draft(c1); // counted
    const live = draft(c1);
    draft(c2); // counted
    draft(c2, { archived_at: '2026-10-29T00:00:00Z' });
    draft(chat(before)); // its run is older than 30 days
    draft(chat(theirs)); // another agent's run
    draft(chat(null)); // a person's own chat
    draft(null); // made in the Content Editor
    // The live one went out later, from the Content Editor: no agent on its ship event.
    ship({ agent_id: null, content_draft_id: live, title: 'Published by hand' });

    const impact = await readAgentImpact(await ctxOf(PEOPLE.manager), AGENT, NOW);
    expect(impact?.draftsNotLive).toBe(2);
    expect(impact?.rows).toEqual([]);
  });
});

describe('readAgentImpact: brand access (00424)', () => {
  it('keeps to the brands the person may see: changes, run numbers and drafts', async () => {
    // Their own agent on All brands, from before they were narrowed to Brand A.
    db.tables.chat_agent_versions.find((v) => v.agent_id === AGENT)!.scope = { all_brands: true };
    const hiddenRun = run('2026-10-10T09:00:00.000Z', { brand_id: BRAND_2 });
    const seenRun = run('2026-10-12T09:00:00.000Z');
    ship({ title: 'On Brand A', agent_run_id: seenRun, shipped_at: '2026-10-13T09:00:00.000Z' });
    ship({
      title: 'On Brand B',
      brand_id: BRAND_2,
      agent_run_id: hiddenRun,
      shipped_at: '2026-10-11T09:00:00.000Z',
      impact_measurements: measured('improved', 'high'),
    });
    draft(chat(seenRun));
    draft(chat(hiddenRun), { brand_id: BRAND_2 });

    const all = await readAgentImpact(await ctxOf(PEOPLE.manager), AGENT, NOW);
    expect(all?.rows.map((r) => [r.title, r.run?.number])).toEqual([
      ['On Brand A', 2],
      ['On Brand B', 1],
    ]);
    expect(all?.summary).toMatchObject({ shipped: 2, improved: 1, judged: 1 });
    expect(all?.draftsNotLive).toBe(2);

    narrow(PEOPLE.manager, BRAND);
    const narrowed = await readAgentImpact(await ctxOf(PEOPLE.manager), AGENT, NOW);
    expect(narrowed?.rows.map((r) => [r.title, r.run?.number])).toEqual([['On Brand A', 1]]);
    expect(narrowed?.summary).toMatchObject({ shipped: 1, improved: 0, judged: 0 });
    expect(narrowed?.draftsNotLive).toBe(1);

    // An Admin sees every brand.
    const admin = await readAgentImpact(await ctxOf(PEOPLE.admin), AGENT, NOW);
    expect(admin?.rows).toHaveLength(2);
  });
});
