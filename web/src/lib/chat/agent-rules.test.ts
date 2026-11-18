import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_AGENT_SETTINGS,
  agentActDenial,
  agentPlanLimits,
  agentTriggersSchema,
  canCallDenial,
  canSeeAgent,
  copyName,
  createAgentInput,
  enginesDenial,
  enginesNamed,
  firstVersion,
  lifecycleTarget,
  modeDenial,
  monthCapDenial,
  nextVersion,
  triggerScopeProblem,
  triggerTimeProblem,
  updateAgentInput,
  visibilityDenial,
  agentKindOf,
  isOperatorSkills,
  operatorBrandOf,
  operatorDenial,
  operatorJsonFromRow,
  operatorPlanSettings,
  operatorProblem,
  operatorSettingsInput,
  versionFromRow,
  type AgentFacts,
  type AgentViewer,
} from './agent-rules';
import { planFactsFromOrgRow } from './plan-facts';

/**
 * Chat's agents without the database (CHAT-21; CHAT-27 §E): what a request
 * may hold, who sees and changes an agent, which state follows which, what
 * the plan allows, the budget shares and the names.
 */

const BRAND = '22222222-2222-4222-8222-222222222222';
const ME = 'aaaaaaaa-0000-4000-8000-000000000002';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000004';

const base = {
  name: 'Win back citations',
  skills: ['winback'],
  scope: { brand_ids: [BRAND] },
};

const viewer = (role: AgentViewer['role'], userId = ME): AgentViewer => ({
  userId,
  role,
  brandAccess: 'all',
});
const agent = (over: Partial<AgentFacts> = {}): AgentFacts => ({
  ownerId: ME,
  visibility: 'private',
  scope: { brand_ids: [BRAND] },
  ...over,
});

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true'));
afterEach(() => vi.unstubAllEnvs());

const plan = (planId: string, status = 'active', overrides: unknown = null) =>
  planFactsFromOrgRow({ plan: planId, subscription_status: status, plan_overrides: overrides });

describe('what a new agent may hold', () => {
  it('fills the defaults: private, Auto, Normal, 14 days, no triggers, no monthly cap', () => {
    const input = createAgentInput.parse(base);
    expect(input).toMatchObject({
      visibility: 'private',
      mode: 'auto',
      model: 'auto',
      effort: 'normal',
      followupDays: 14,
      triggers: [],
      connections: [],
      maxMonthShare: null,
      instructions: null,
      canCall: [],
    });
    expect(input.maxRunShare).toBeUndefined();
  });

  it('lets an agent call up to 5 other agents, none twice', () => {
    const ids = [1, 2, 3, 4, 5, 6].map((n) => `bbbbbbbb-0000-4000-8000-00000000000${n}`);
    expect(createAgentInput.parse({ ...base, canCall: ids.slice(0, 5) }).canCall).toHaveLength(5);
    expect(createAgentInput.safeParse({ ...base, canCall: ids }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, canCall: [ids[0], ids[0]] }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, canCall: ['not-an-id'] }).success).toBe(false);
  });

  it('folds a name’s spaces and keeps it to 1–60 characters', () => {
    expect(createAgentInput.parse({ ...base, name: '  Win   back  ' }).name).toBe('Win back');
    expect(createAgentInput.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, name: 'x'.repeat(61) }).success).toBe(false);
  });

  it('takes 1–3 skills, none twice, and instructions up to 2,000 characters', () => {
    expect(createAgentInput.safeParse({ ...base, skills: [] }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, skills: ['a', 'b', 'c', 'd'] }).success).toBe(
      false,
    );
    expect(createAgentInput.safeParse({ ...base, skills: ['faq', 'faq'] }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, skills: ['Not A Slug'] }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, instructions: 'x'.repeat(2001) }).success).toBe(
      false,
    );
    expect(createAgentInput.parse({ ...base, instructions: '   ' }).instructions).toBeNull();
  });

  it('caps a run at 1–50% and a month at 1–100%, in whole percents, as shares', () => {
    expect(createAgentInput.parse({ ...base, maxRunShare: 0.07 }).maxRunShare).toBe(0.07);
    expect(createAgentInput.parse({ ...base, maxRunShare: 0.5 }).maxRunShare).toBe(0.5);
    for (const share of [0, 0.005, 0.51, 1, 0.125]) {
      expect(createAgentInput.safeParse({ ...base, maxRunShare: share }).success, `${share}`).toBe(
        false,
      );
    }
    expect(createAgentInput.parse({ ...base, maxMonthShare: 1 }).maxMonthShare).toBe(1);
    expect(createAgentInput.safeParse({ ...base, maxMonthShare: 1.01 }).success).toBe(false);
  });

  it('takes brands or all brands, never both or neither, and known engines only', () => {
    expect(createAgentInput.safeParse({ ...base, scope: { all_brands: true } }).success).toBe(true);
    expect(
      createAgentInput.safeParse({ ...base, scope: { all_brands: true, brand_ids: [BRAND] } })
        .success,
    ).toBe(false);
    expect(createAgentInput.safeParse({ ...base, scope: {} }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, scope: { brand_ids: [] } }).success).toBe(false);
    expect(
      createAgentInput.safeParse({
        ...base,
        scope: { brand_ids: [BRAND], engines: ['chatgpt-web', 'claude-sonnet-5'] },
      }).success,
    ).toBe(true);
    expect(
      createAgentInput.safeParse({ ...base, scope: { brand_ids: [BRAND], engines: ['bard'] } })
        .success,
    ).toBe(false);
    // No longer tracked, but a saved scope that names them still parses.
    expect(
      createAgentInput.safeParse({
        ...base,
        scope: { brand_ids: [BRAND], engines: ['copilot-web', 'perplexity-web'] },
      }).success,
    ).toBe(true);
    expect(
      createAgentInput.safeParse({ ...base, scope: { brand_ids: [BRAND], urls: ['ftp://x.y'] } })
        .success,
    ).toBe(false);
  });

  it('takes a model preference, never a key, and connections each Required or Optional', () => {
    expect(
      createAgentInput.safeParse({ ...base, model: 'anthropic/claude-sonnet-5.5' }).success,
    ).toBe(true);
    expect(createAgentInput.safeParse({ ...base, model: 'sk-ant-api03-secret' }).success).toBe(
      false,
    );
    expect(
      createAgentInput.safeParse({
        ...base,
        connections: [
          { key: 'webflow', required: true },
          { key: 'webflow', required: false },
        ],
      }).success,
    ).toBe(false);
    expect(createAgentInput.safeParse({ ...base, apiKey: 'x' }).success).toBe(false);
  });
});

describe('triggers', () => {
  const schedule = {
    kind: 'schedule',
    config: { type: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9', timezone: 'UTC' },
  };
  const signal = { kind: 'signal', config: { category: 'recover' } };
  const kpi = {
    kind: 'kpi',
    config: {
      kpi: 'ai_visibility',
      direction: 'down',
      threshold: 5,
      unit: 'percent',
      period: 'week',
    },
  };
  const watch = { kind: 'watch_rule', config: { watch_rule_id: BRAND } };

  it('takes up to 5, each of the four kinds, switched on unless said', () => {
    const parsed = agentTriggersSchema.parse([schedule, signal, kpi, watch]);
    expect(parsed.map((t) => [t.kind, t.enabled])).toEqual([
      ['schedule', true],
      ['signal', true],
      ['kpi', true],
      ['watch_rule', true],
    ]);
    const six = [0, 1, 2, 3, 4, 5].map((h) => ({
      kind: 'schedule',
      config: { type: 'recurring', rrule: `FREQ=DAILY;BYHOUR=${h}`, timezone: 'UTC' },
    }));
    expect(agentTriggersSchema.safeParse(six.slice(0, 5)).success).toBe(true);
    expect(agentTriggersSchema.safeParse(six).success).toBe(false);
    expect(agentTriggersSchema.safeParse([signal, signal]).success).toBe(false);
  });

  it('refuses a kind it doesn’t know and settings that don’t fit theirs', () => {
    for (const bad of [
      { kind: 'manual', config: {} },
      { kind: 'webhook', config: {} },
      { kind: 'signal', config: { category: 'growthy' } },
      { kind: 'signal', config: { category: 'fix', definition_ids: ['Bad Id'] } },
      { kind: 'kpi', config: { ...kpi.config, kpi: 'toString' } },
      { kind: 'kpi', config: { ...kpi.config, threshold: 0 } },
      { kind: 'kpi', config: { ...kpi.config, threshold: 5000 } },
      { kind: 'watch_rule', config: { watch_rule_id: 'nope' } },
      { kind: 'schedule', config: { type: 'recurring', rrule: 'FREQ=HOURLY', timezone: 'UTC' } },
    ]) {
      expect(agentTriggersSchema.safeParse([bad]).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('takes When a brand is added with no settings, once, on All brands only (00482)', () => {
    const added = { kind: 'brand_added', config: {} };
    expect(agentTriggersSchema.parse([added, schedule])[0]).toEqual({ ...added, enabled: true });
    expect(agentTriggersSchema.safeParse([added, added]).success).toBe(false);
    expect(
      agentTriggersSchema.safeParse([{ kind: 'brand_added', config: { brand_id: BRAND } }]).success,
    ).toBe(false);
    const triggers = agentTriggersSchema.parse([added]);
    expect(triggerScopeProblem(triggers, { all_brands: true })).toBeNull();
    expect(triggerScopeProblem(triggers, {})).toBe('brand_added_scope');
    expect(triggerScopeProblem(agentTriggersSchema.parse([schedule]), {})).toBeNull();
  });

  it('keeps a one-off schedule within the coming year', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    const once = (at: string) =>
      agentTriggersSchema.parse([{ kind: 'schedule', config: { type: 'once', at } }])[0];
    expect(triggerTimeProblem(once('2026-11-02T09:00:00Z'), now)).toBeNull();
    expect(triggerTimeProblem(once('2026-10-29T11:00:00Z'), now)).toBe('schedule_past');
    expect(triggerTimeProblem(once('2028-01-01T00:00:00Z'), now)).toBe('schedule_too_far');
  });

  it('names the engines of the scope and of Signal filters', () => {
    const [withEngines] = agentTriggersSchema.parse([
      { kind: 'signal', config: { category: 'fix', entity_filter: { engines: ['grok-web'] } } },
    ]);
    expect(
      enginesNamed({ brand_ids: [BRAND], engines: ['chatgpt-web'] }, [withEngines]).sort(),
    ).toEqual(['chatgpt-web', 'grok-web']);
  });
});

describe('versions', () => {
  const current = firstVersion(createAgentInput.parse(base));

  it('makes a new version only when what the agent does changes', () => {
    expect(nextVersion(current, updateAgentInput.parse({ name: 'New name' }))).toBeNull();
    expect(
      nextVersion(current, updateAgentInput.parse({ skills: ['winback'], mode: 'auto' })),
    ).toBeNull();
    const next = nextVersion(current, updateAgentInput.parse({ mode: 'ask_first' }));
    expect(next).toEqual({ ...current, mode: 'ask_first' });
    // What it didn't name stays as it was.
    expect(next?.scope).toEqual(current.scope);
  });

  it('makes a new version when whom it can call changes', () => {
    expect(current.can_call).toEqual([]);
    const callee = 'bbbbbbbb-0000-4000-8000-000000000001';
    expect(nextVersion(current, updateAgentInput.parse({ canCall: [] }))).toBeNull();
    expect(nextVersion(current, updateAgentInput.parse({ canCall: [callee] }))).toEqual({
      ...current,
      can_call: [callee],
    });
  });

  it('refuses an empty change', () => {
    expect(updateAgentInput.safeParse({}).success).toBe(false);
    expect(updateAgentInput.safeParse({ expectedVersion: 2 }).success).toBe(false);
  });
});

describe('names', () => {
  it('copies as “{name} copy”, then 2, 3, within 60 characters', () => {
    expect(copyName('Brief', new Set())).toBe('Brief copy');
    expect(copyName('Brief', new Set(['brief copy']))).toBe('Brief copy 2');
    expect(copyName('Brief', new Set(['brief copy', 'brief copy 2']))).toBe('Brief copy 3');
    const long = copyName('x'.repeat(60), new Set());
    expect(long).toHaveLength(60);
    expect(long.endsWith(' copy')).toBe(true);
  });
});

describe('states', () => {
  it('goes draft → active ⇄ paused → archived → deleted, and back to paused from archived', () => {
    expect(lifecycleTarget('activate', 'draft')).toBe('active');
    expect(lifecycleTarget('pause', 'active')).toBe('paused');
    expect(lifecycleTarget('resume', 'paused')).toBe('active');
    expect(lifecycleTarget('archive', 'paused')).toBe('archived');
    expect(lifecycleTarget('archive', 'draft')).toBe('archived');
    expect(lifecycleTarget('restore', 'archived')).toBe('paused');
    expect(lifecycleTarget('delete', 'archived')).toBeNull();
  });

  it('refuses what doesn’t follow', () => {
    expect(lifecycleTarget('activate', 'paused')).toBeUndefined();
    expect(lifecycleTarget('pause', 'draft')).toBeUndefined();
    expect(lifecycleTarget('resume', 'active')).toBeUndefined();
    expect(lifecycleTarget('delete', 'active')).toBeUndefined();
    expect(lifecycleTarget('restore', 'paused')).toBeUndefined();
    expect(lifecycleTarget('archive', 'archived')).toBeUndefined();
  });
});

describe('who sees and changes an agent', () => {
  const settings = DEFAULT_AGENT_SETTINGS;

  it('shows a private agent to its owner and the Admins, a workspace one to everyone', () => {
    expect(canSeeAgent(agent(), viewer('manager'))).toBe(true);
    expect(canSeeAgent(agent(), viewer('manager', OTHER))).toBe(false);
    expect(canSeeAgent(agent(), viewer('analyst', OTHER))).toBe(false);
    expect(canSeeAgent(agent(), viewer('admin', OTHER))).toBe(true);
    expect(canSeeAgent(agent({ visibility: 'workspace' }), viewer('analyst', OTHER))).toBe(true);
  });

  it('shows an Agency partner only agents on brands shared with them', () => {
    const partner = { ...viewer('agency_partner', OTHER), brandAccess: [BRAND] };
    expect(canSeeAgent(agent({ visibility: 'workspace' }), partner)).toBe(true);
    expect(
      canSeeAgent(agent({ visibility: 'workspace', scope: { all_brands: true } }), partner),
    ).toBe(false);
    expect(
      canSeeAgent(agent({ visibility: 'workspace', scope: { brand_ids: [BRAND, ME] } }), partner),
    ).toBe(false);
  });

  it('shows a Selected-brands person their own agent on All brands, which runs on theirs only', () => {
    const narrowed = { ...viewer('manager'), brandAccess: [BRAND] };
    const allBrands = { scope: { all_brands: true as const } };
    expect(canSeeAgent(agent(allBrands), narrowed)).toBe(true);
    // Someone else's on All brands covers brands they don't have: hidden, as before.
    expect(
      canSeeAgent(agent({ ...allBrands, ownerId: OTHER, visibility: 'workspace' }), narrowed),
    ).toBe(false);
    // Their own on a brand taken from them since: hidden until it comes back (§9 Q4).
    expect(canSeeAgent(agent({ scope: { brand_ids: [OTHER] } }), narrowed)).toBe(false);
    // With All brands, nothing changes.
    expect(
      canSeeAgent(
        agent({ ...allBrands, ownerId: OTHER, visibility: 'workspace' }),
        viewer('analyst'),
      ),
    ).toBe(true);
  });

  it('lets Analysts and Agency partners read only, with the roles who can', () => {
    for (const role of ['analyst', 'agency_partner'] as const) {
      for (const act of ['create', 'edit', 'run', 'pause', 'duplicate'] as const) {
        expect(agentActDenial(act, viewer(role), agent(), settings)).toEqual({
          denial: { code: 'forbidden_role', role, roles: ['admin', 'manager'] },
          asked: act,
        });
      }
    }
  });

  it('lets a Manager change their own agents and run any workspace agent; an Admin anything', () => {
    const manager = viewer('manager');
    expect(agentActDenial('edit', manager, agent(), settings)).toBeNull();
    expect(agentActDenial('edit', manager, agent({ ownerId: OTHER }), settings)).toEqual({
      denial: { code: 'forbidden_role', role: 'manager', roles: ['admin'] },
      asked: 'edit',
    });
    expect(
      agentActDenial('run', manager, agent({ ownerId: OTHER, visibility: 'workspace' }), settings),
    ).toBeNull();
    expect(
      agentActDenial(
        'pause',
        manager,
        agent({ ownerId: OTHER, visibility: 'workspace' }),
        settings,
      ),
    ).not.toBeNull();
    expect(
      agentActDenial('archive', viewer('admin', OTHER), agent({ ownerId: ME }), settings),
    ).toBeNull();
  });

  it('keeps Take over to Admins, whoever owns the agent', () => {
    expect(agentActDenial('takeOver', viewer('admin', OTHER), agent(), settings)).toBeNull();
    for (const role of ['manager', 'analyst', 'agency_partner'] as const) {
      expect(agentActDenial('takeOver', viewer(role), agent(), settings)).toEqual({
        denial: { code: 'forbidden_role', role, roles: ['admin'] },
        asked: 'takeOver',
      });
    }
  });

  it('keeps workspace agents to Admins when Settings › Chat says so', () => {
    const adminsOnly = { ...settings, workspaceAgentsAdminsOnly: true };
    const mine = agent({ visibility: 'workspace' });
    expect(agentActDenial('edit', viewer('manager'), mine, adminsOnly)).toEqual({
      denial: { code: 'policy_never' },
      asked: 'edit',
    });
    expect(agentActDenial('activate', viewer('manager'), mine, adminsOnly)).not.toBeNull();
    // Taking it down and running it stay theirs.
    expect(agentActDenial('pause', viewer('manager'), mine, adminsOnly)).toBeNull();
    expect(agentActDenial('run', viewer('manager'), mine, adminsOnly)).toBeNull();
    expect(visibilityDenial('workspace', viewer('manager'), adminsOnly)).toEqual({
      denial: { code: 'policy_never' },
      asked: 'workspace',
    });
    expect(visibilityDenial('workspace', viewer('admin'), adminsOnly)).toBeNull();
    expect(visibilityDenial('workspace', viewer('manager'), settings)).toBeNull();
  });

  it('keeps the monthly cap to Admins', () => {
    expect(monthCapDenial(viewer('admin'))).toBeNull();
    expect(monthCapDenial(viewer('manager'))?.denial).toEqual({
      code: 'forbidden_role',
      role: 'manager',
      roles: ['admin'],
    });
  });
});

describe('what the plan allows', () => {
  it('opens Full auto on Growth and up, paid, and where Settings › Chat allows it', () => {
    const settings = DEFAULT_AGENT_SETTINGS;
    expect(modeDenial('auto', plan('starter'), settings, 'manager')).toBeNull();
    expect(modeDenial('full_auto', plan('starter'), settings, 'admin')?.denial).toEqual({
      code: 'plan_locked',
      needs: 'growth',
    });
    expect(modeDenial('full_auto', plan('growth', 'trialing'), settings, 'admin')).not.toBeNull();
    expect(modeDenial('full_auto', plan('growth'), settings, 'manager')).toBeNull();
    expect(
      modeDenial('full_auto', plan('growth'), { ...settings, agentsFullAuto: false }, 'admin')
        ?.denial,
    ).toEqual({ code: 'policy_never' });
    expect(
      modeDenial(
        'full_auto',
        plan('growth'),
        { ...settings, fullAutoForMembers: false },
        'manager',
      ),
    ).not.toBeNull();
    expect(
      modeDenial('full_auto', plan('growth'), { ...settings, fullAutoForMembers: false }, 'admin'),
    ).toBeNull();
  });

  it('keeps engines to the plan’s: Starter’s two platforms, Claude on Enterprise', () => {
    expect(enginesDenial(plan('starter'), ['chatgpt-web', 'gemini-web'])).toBeNull();
    expect(enginesDenial(plan('starter'), ['google-aio'])?.denial).toEqual({
      code: 'plan_locked',
      needs: 'growth',
    });
    expect(enginesDenial(plan('growth'), ['google-aio'])).toBeNull();
    expect(enginesDenial(plan('growth'), ['claude-sonnet-5'])?.denial).toEqual({
      code: 'plan_locked',
      needs: 'enterprise',
    });
    expect(
      enginesDenial(plan('enterprise', 'active', { allowedModels: ['claude-sonnet-5'] }), [
        'claude-sonnet-5',
      ]),
    ).toBeNull();
  });

  it('keeps the agents on and runs at once per plan, the trial’s in the trial', () => {
    expect(agentPlanLimits(plan('starter', 'trialing'))).toEqual({
      activeAgents: 1,
      runsAtOnce: 1,
      eventRunsPerDay: 2,
    });
    expect(agentPlanLimits(plan('starter'))).toMatchObject({ activeAgents: 5, runsAtOnce: 2 });
    expect(agentPlanLimits(plan('growth'))).toMatchObject({ activeAgents: 25, runsAtOnce: 5 });
    expect(agentPlanLimits(plan('enterprise'))).toMatchObject({
      activeAgents: 100,
      runsAtOnce: 10,
      eventRunsPerDay: 12,
    });
    expect(
      agentPlanLimits(plan('enterprise', 'active', { maxActiveAgents: 250 })).activeAgents,
    ).toBe(250);
  });

  it('keeps calling other agents to Growth and up, paid', () => {
    const callee = ['bbbbbbbb-0000-4000-8000-000000000001'];
    expect(canCallDenial([], plan('starter'))).toBeNull();
    expect(canCallDenial(callee, plan('starter'))).toEqual({
      denial: { code: 'plan_locked', needs: 'growth' },
      asked: 'canCall',
    });
    expect(canCallDenial(callee, plan('growth', 'trialing'))).not.toBeNull();
    expect(canCallDenial(callee, plan('growth'))).toBeNull();
  });

  it('gives self-hosted no plan gates and no cap on agents', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    const selfHosted = plan('starter');
    expect(modeDenial('full_auto', selfHosted, DEFAULT_AGENT_SETTINGS, 'manager')).toBeNull();
    expect(canCallDenial(['bbbbbbbb-0000-4000-8000-000000000001'], selfHosted)).toBeNull();
    expect(enginesDenial(selfHosted, ['claude-sonnet-5'])).toBeNull();
    expect(agentPlanLimits(selfHosted).activeAgents).toBeNull();
  });
});

// ─── The AEO Operator (AEO Operator plan §4.2, §4.5; PR 4) ──────────────────

describe('the AEO Operator', () => {
  afterEach(() => vi.unstubAllEnvs());
  const OTHER_BRAND = '33333333-3333-4333-8333-333333333333';
  const operator = {
    kind: 'operator' as const,
    skills: ['operator'],
    scope: { brand_ids: [BRAND] },
    visibility: 'private' as const,
    maxRunShare: 0.05,
    canCall: [] as string[],
    settings: true,
  };

  it('is an agent made of /operator alone: its kind, set when it is made', () => {
    expect(isOperatorSkills(['operator'])).toBe(true);
    expect(isOperatorSkills(['operator', 'faq'])).toBe(false);
    expect(isOperatorSkills(['faq', 'operator'])).toBe(false);
    expect(agentKindOf(['operator'])).toBe('operator');
    expect(agentKindOf(['winback'])).toBe('agent');
    expect(agentKindOf(['operator', 'faq'])).toBe('agent');
  });

  it('takes its settings with their defaults: all my agents, 5 a day (1–8), Ask first fixed on', () => {
    expect(operatorSettingsInput.parse({})).toEqual({
      allowed: null,
      includeWorkspace: false,
      maxRuns: 5,
      askFirst: true,
    });
    expect(operatorSettingsInput.safeParse({ maxRuns: 1 }).success).toBe(true);
    expect(operatorSettingsInput.safeParse({ maxRuns: 8 }).success).toBe(true);
    for (const maxRuns of [0, 9, 2.5]) {
      expect(operatorSettingsInput.safeParse({ maxRuns }).success, String(maxRuns)).toBe(false);
    }
    // Ask first can't be turned off in v1 (decision 12).
    expect(operatorSettingsInput.safeParse({ askFirst: false }).success).toBe(false);
    expect(operatorSettingsInput.safeParse({ allowed: [BRAND, BRAND] }).success).toBe(false);
    expect(operatorSettingsInput.safeParse({ somethingElse: 1 }).success).toBe(false);
    // A new agent takes them under `operator`, its daily budget as its maxRunShare.
    const input = createAgentInput.parse({ ...base, skills: ['operator'], operator: {} });
    expect(firstVersion(input).operator_json).toEqual({
      allowed: null,
      include_workspace: false,
      max_runs: 5,
      ask_first: true,
    });
    // Without settings an Operator still gets the defaults; another agent never has any.
    expect(
      firstVersion(createAgentInput.parse({ ...base, skills: ['operator'] })).operator_json,
    ).toMatchObject({ max_runs: 5 });
    expect(firstVersion(createAgentInput.parse(base))).not.toHaveProperty('operator_json');
  });

  it('reads stored settings back within their bounds, and the planner’s from them', () => {
    expect(
      operatorJsonFromRow({ max_runs: 12, include_workspace: true, ask_first: false }),
    ).toEqual({ allowed: null, include_workspace: true, max_runs: 8, ask_first: true });
    expect(operatorJsonFromRow(null)).toEqual({
      allowed: null,
      include_workspace: false,
      max_runs: 5,
      ask_first: true,
    });
    expect(operatorJsonFromRow({ allowed: [BRAND, 3], max_runs: 'x' })).toMatchObject({
      allowed: [BRAND],
      max_runs: 5,
    });
    // The daily budget is max_run_share: 5% by default, 1–10% whatever was stored.
    expect(operatorPlanSettings(null, 0.05, 'Europe/Istanbul')).toEqual({
      dailyBudget: 0.05,
      maxRuns: 5,
      allowed: null,
      includeWorkspace: false,
      timeZone: 'Europe/Istanbul',
    });
    expect(operatorPlanSettings(null, 0.5, 'UTC').dailyBudget).toBe(0.1);
    expect(operatorPlanSettings(null, 0, 'UTC').dailyBudget).toBe(0.01);
    expect(
      operatorPlanSettings({ ...operatorJsonFromRow(null), max_runs: 3 }, 0.07, 'UTC'),
    ).toMatchObject({ dailyBudget: 0.07, maxRuns: 3 });
  });

  it('keeps its settings in its versions: a change of them is a new version', () => {
    const current = firstVersion(createAgentInput.parse({ ...base, skills: ['operator'] }));
    const next = nextVersion(current, updateAgentInput.parse({ operator: { maxRuns: 3 } }));
    expect(next?.operator_json).toMatchObject({ max_runs: 3 });
    expect(nextVersion(current, updateAgentInput.parse({ operator: {} }))).toBeNull();
    // A version's other change keeps them.
    expect(
      nextVersion(current, updateAgentInput.parse({ instructions: 'Hi.' }))?.operator_json,
    ).toEqual(current.operator_json);
    const row = {
      skill_ids: ['operator'],
      instructions: null,
      mode: 'auto',
      connections: [],
      model: 'auto',
      effort: 'normal',
      scope: { brand_ids: [BRAND] },
      notify_user_ids: [],
      followup_days: 14,
      can_call: [],
    };
    expect(versionFromRow({ ...row, operator_json: { max_runs: 2 } }).operator_json).toMatchObject({
      max_runs: 2,
    });
    expect(versionFromRow({ ...row, operator_json: null })).not.toHaveProperty('operator_json');
  });

  it('is one brand, private, a 1–10% daily budget and no Can call; its kind never changes', () => {
    expect(operatorProblem(operator)).toBeNull();
    expect(operatorProblem({ ...operator, maxRunShare: 0.01 })).toBeNull();
    expect(operatorProblem({ ...operator, maxRunShare: 0.1 })).toBeNull();
    expect(operatorProblem({ ...operator, skills: ['operator', 'faq'] })).toBe('operator_skills');
    expect(operatorProblem({ ...operator, skills: ['faq'] })).toBe('operator_kind');
    expect(operatorProblem({ ...operator, scope: { all_brands: true } })).toBe('operator_scope');
    expect(operatorProblem({ ...operator, scope: { brand_ids: [BRAND, OTHER_BRAND] } })).toBe(
      'operator_scope',
    );
    expect(operatorProblem({ ...operator, visibility: 'workspace' })).toBe('operator_visibility');
    expect(operatorProblem({ ...operator, maxRunShare: 0.11 })).toBe('operator_budget');
    expect(operatorProblem({ ...operator, maxRunShare: 0.005 })).toBe('operator_budget');
    expect(operatorProblem({ ...operator, canCall: [OTHER] })).toBe('operator_can_call');
    // An agent: becoming an Operator, /operator beside another skill, an Operator's settings.
    const agent = { ...operator, kind: 'agent' as const, skills: ['winback'], settings: false };
    expect(operatorProblem(agent)).toBeNull();
    expect(operatorProblem({ ...agent, maxRunShare: 0.3, visibility: 'workspace' })).toBeNull();
    expect(operatorProblem({ ...agent, skills: ['operator'] })).toBe('operator_kind');
    expect(operatorProblem({ ...agent, skills: ['winback', 'operator'] })).toBe('operator_skills');
    expect(operatorProblem({ ...agent, settings: true })).toBe('operator_skills');
    expect(operatorBrandOf({ brand_ids: [BRAND] })).toBe(BRAND);
    expect(operatorBrandOf({ all_brands: true })).toBeNull();
  });

  it('is Growth and up, paid, as Can call; open off the cloud; nothing for another agent', () => {
    expect(operatorDenial('operator', plan('starter'))).toEqual({
      denial: { code: 'plan_locked', needs: 'growth' },
      asked: 'operator',
    });
    expect(operatorDenial('operator', plan('growth', 'trialing'))).not.toBeNull();
    expect(operatorDenial('operator', plan('growth'))).toBeNull();
    expect(operatorDenial('operator', plan('enterprise'))).toBeNull();
    expect(operatorDenial('agent', plan('starter'))).toBeNull();
    // The same gate as Can call's, on every plan.
    for (const [id, status] of [
      ['starter', 'active'],
      ['growth', 'trialing'],
      ['growth', 'active'],
    ] as const) {
      expect(operatorDenial('operator', plan(id, status)) === null).toBe(
        canCallDenial([OTHER], plan(id, status)) === null,
      );
    }
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(operatorDenial('operator', plan('starter'))).toBeNull();
  });
});
