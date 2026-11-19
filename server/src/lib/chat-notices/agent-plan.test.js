import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An AEO Operator's summary (00545, AEO Operator plan §4.2 step 7): the
 * person its run acts as, when they reach its brand, gets the Inbox notice
 * once per plan, and by their "Notify me when an agent needs me" the e-mail
 * or the brand's Slack message; nothing for a plan not summarized or another
 * workspace's. The e-mail names only the agents the summary names.
 */

const db = vi.hoisted(() => ({ tables: {} }));
const deliverEmail = vi.hoisted(() => vi.fn(async () => 'sent'));
const readers = vi.hoisted(() => ({ value: new Map() }));

function query(table) {
  const filters = [];
  let upsert = null;
  let one = false;
  const chain = {
    select: () => chain,
    eq: (col, val) => (filters.push((r) => r[col] === val), chain),
    in: (col, vals) => (filters.push((r) => vals.includes(r[col])), chain),
    limit: () => chain,
    upsert: (rows) => ((upsert = rows), chain),
    maybeSingle: () => ((one = true), chain),
    then: (resolve) => {
      const rows = (db.tables[table] ??= []);
      if (upsert) {
        const written = [];
        for (const row of upsert) {
          if (rows.some((r) => r.user_id === row.user_id && r.dedupe_key === row.dedupe_key)) {
            continue;
          }
          rows.push(row);
          written.push(row);
        }
        return resolve({ data: written, error: null });
      }
      const found = rows.filter((r) => filters.every((f) => f(r)));
      return resolve({ data: one ? (found[0] ?? null) : found, error: null });
    },
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => query(table),
    auth: {
      admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@acme.test` } } }) },
    },
  },
}));
vi.mock('../access.js', () => ({ brandReaders: async () => readers.value }));
vi.mock('../email.js', () => ({ deliverEmail }));
vi.mock('../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const slack = vi.hoisted(() => ({ calls: [], posted: new Set() }));
vi.mock('../slack/agent-plan.js', () => ({
  postAgentPlan: async (input, deps) => (slack.calls.push([input, deps]), slack.posted),
}));

const { renderAgentPlanEmail, tellAgentPlan } = await import('./agent-plan.js');
const { readPlanSummary } = await import('./plan-summary.js');
const { forgetMessages } = await import('../i18n.js');

const ORG = 'org-1';
const BRAND = 'brand-1';
const PLAN = 'plan-1';
const CHILD_CHAT = 'eeeeeeee-0000-4000-8000-000000000001';
const WINBACK = 'abababab-0000-4000-8000-000000000001';

const SUMMARY = {
  v: 1,
  why: 'done',
  day: '2026-11-18',
  budget: 0.05,
  used: 0.017,
  waiting: 1,
  approve_all: true,
  children: [
    {
      agent_id: WINBACK,
      name: 'Citation <Win-back>',
      state: 'done',
      chat_id: CHILD_CHAT,
      share: 0.015,
      used: 0.008,
      counts: { drafts: 2, findings: 1, tasks: 0, shipped: 1 },
      approve_all: true,
    },
    {
      agent_id: null,
      name: null,
      hidden: true,
      state: 'waiting',
      chat_id: null,
      share: 0.01,
      used: 0.004,
      counts: { drafts: 0, findings: 0, tasks: 0, shipped: 0 },
      approve_all: true,
    },
    {
      agent_id: 'abababab-0000-4000-8000-000000000004',
      name: 'FAQ Builder',
      state: 'not_started',
      chat_id: null,
      reason: 'busy',
      share: null,
      used: null,
      counts: { drafts: 0, findings: 0, tasks: 0, shipped: 0 },
    },
  ],
};

beforeEach(() => {
  deliverEmail.mockClear();
  slack.calls = [];
  slack.posted = new Set();
  readers.value = new Map([['person-1', new Set([BRAND])]]);
  db.tables = {
    chat_agent_plans: [
      {
        id: PLAN,
        organization_id: ORG,
        agent_id: 'op-1',
        run_id: 'run-op',
        brand_id: BRAND,
        plan_day: '2026-11-18',
        status: 'summarized',
        summary_json: SUMMARY,
      },
    ],
    chat_agents: [{ id: 'op-1', organization_id: ORG, name: 'AEO Operator', owner_id: 'owner-1' }],
    chat_agent_runs: [{ id: 'run-op', organization_id: ORG, acting_user_id: 'person-1' }],
    brands: [{ id: BRAND, name: 'Trailpeak', organization_id: ORG, is_demo: false }],
    chat_conversations: [{ id: 'chat-op', organization_id: ORG, agent_run_id: 'run-op' }],
    profiles: [
      { id: 'person-1', organization_id: ORG },
      { id: 'owner-1', organization_id: ORG },
    ],
    chat_user_prefs: [],
    chat_notices: [],
  };
});

describe('tellAgentPlan', () => {
  it('writes the notice and e-mails the person, once per plan', async () => {
    expect(await tellAgentPlan({ orgId: ORG, planId: PLAN })).toEqual({ notices: 1, emails: 1 });
    expect(db.tables.chat_notices).toEqual([
      {
        organization_id: ORG,
        user_id: 'person-1',
        kind: 'agent_plan_summary',
        brand_id: BRAND,
        dedupe_key: `agent_plan_summary:${PLAN}`,
        payload: {
          agent: 'AEO Operator',
          agentId: 'op-1',
          planId: PLAN,
          chatId: 'chat-op',
          day: '2026-11-18',
          total: 3,
          done: 1,
          waiting: 1,
          failed: 0,
          stopped: 0,
          working: 0,
          notStarted: 1,
          approveAll: true,
        },
      },
    ]);
    expect(deliverEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['person-1@acme.test'],
        subject: 'AEO Operator on Trailpeak: 1 of 3 agents done · 1 waits for you',
      }),
    );
    expect(await tellAgentPlan({ orgId: ORG, planId: PLAN })).toEqual({ notices: 0, emails: 0 });
    expect(deliverEmail).toHaveBeenCalledTimes(1);
  });

  it('respects the notify setting: Inbox only sends nothing more', async () => {
    db.tables.chat_user_prefs = [{ user_id: 'person-1', notify_via: 'inbox' }];
    expect(await tellAgentPlan({ orgId: ORG, planId: PLAN })).toEqual({ notices: 1, emails: 0 });
    expect(deliverEmail).not.toHaveBeenCalled();
    expect(slack.calls).toEqual([]);
  });

  it('posts to the brand’s Slack with Inbox + Slack, and e-mails when it doesn’t post', async () => {
    db.tables.chat_user_prefs = [{ user_id: 'person-1', notify_via: 'inbox_slack' }];
    slack.posted = new Set(['person-1']);
    expect(await tellAgentPlan({ orgId: ORG, planId: PLAN })).toEqual({
      notices: 1,
      emails: 0,
      slack: 1,
    });
    const [input, deps] = slack.calls[0];
    expect(input).toMatchObject({
      brand: { id: BRAND, name: 'Trailpeak' },
      planId: PLAN,
      operator: 'AEO Operator',
      day: '2026-11-18',
      chatUrl: 'http://localhost:3000/dashboard/chat/chat-op',
      approveAllUrl: 'http://localhost:3000/dashboard/chat/inbox?tab=needsYou',
      people: ['person-1'],
    });
    expect(typeof deps.emailOf).toBe('function');
    expect(deliverEmail).not.toHaveBeenCalled();

    db.tables.chat_notices = [];
    slack.posted = new Set();
    expect(await tellAgentPlan({ orgId: ORG, planId: PLAN })).toEqual({ notices: 1, emails: 1 });
  });

  it('tells no one for a plan not summarized, another workspace’s, or a person off its brand', async () => {
    db.tables.chat_agent_plans[0].status = 'dispatched';
    expect(await tellAgentPlan({ orgId: ORG, planId: PLAN })).toEqual({ notices: 0, emails: 0 });
    db.tables.chat_agent_plans[0].status = 'summarized';
    expect(await tellAgentPlan({ orgId: 'org-2', planId: PLAN })).toEqual({
      notices: 0,
      emails: 0,
    });
    readers.value = new Map();
    expect(await tellAgentPlan({ orgId: ORG, planId: PLAN })).toEqual({ notices: 0, emails: 0 });
    expect(deliverEmail).not.toHaveBeenCalled();
  });
});

describe('renderAgentPlanEmail', () => {
  const summary = readPlanSummary(SUMMARY);
  const facts = {
    operator: 'AEO Operator',
    brand: 'Trailpeak',
    day: '2026-11-18',
    agentId: 'op-1',
  };

  it('lists each agent, its work and AI, the total, what waits and Approve all', () => {
    const { html } = renderAgentPlanEmail({ ...facts, chatId: 'chat-op', summary });
    expect(html).toContain(
      '<strong>Citation &lt;Win-back&gt;</strong> · Done · 2 drafts saved · 1 Action Center finding · 1 page sent or published · 0.8% of its 1.5%',
    );
    expect(html).toContain(`/dashboard/chat/${CHILD_CHAT}`);
    expect(html).toContain(
      '<strong>An agent you can’t see</strong> · Waits for you · 0.4% of its 1%',
    );
    expect(html).toContain('<strong>FAQ Builder</strong> · Not started');
    expect(html).toContain('AI used: 1.7% of the day’s 5% budget');
    expect(html).toContain('<strong>Waits for you:</strong> 1 agent.');
    expect(html).toContain('/dashboard/chat/chat-op');
    expect(html).toContain('Approve all in the Inbox');
    expect(html).toContain('Once per plan.');
  });

  it('has no AI line with no AI limit, and opens the Operator without its chat', () => {
    const { html } = renderAgentPlanEmail({
      ...facts,
      chatId: null,
      summary: readPlanSummary({ ...SUMMARY, budget: null, approve_all: false }),
    });
    expect(html).not.toContain('AI used');
    expect(html).toContain('/dashboard/agents/op-1');
  });

  it('words the summary in the reader’s language, numbers and day included (LOC-008)', () => {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../messages/de.json',
    );
    fs.writeFileSync(
      file,
      JSON.stringify({
        agentPlan: { subject: '{operator} für {brand}: {headline}' },
        planSummary: {
          state: { done: 'Fertig' },
          usedOf: '{used} von {share}',
          plan: 'die Agenten, die {operator} am {day} für {brand} gestartet hat',
        },
      }),
    );
    forgetMessages();
    try {
      const { subject, html } = renderAgentPlanEmail({
        ...facts,
        chatId: 'chat-op',
        summary,
        locale: 'de',
      });
      expect(subject).toBe('AEO Operator für Trailpeak: 1 of 3 agents done · 1 waits for you');
      expect(html).toContain('<strong>Citation &lt;Win-back&gt;</strong> · Fertig');
      expect(html).toContain('0,8 % von 1,5 %');
      expect(html).toContain('die Agenten, die AEO Operator am 18. Nov. für Trailpeak');
      // English where German has no text.
      expect(html).toContain('Approve all in the Inbox');
    } finally {
      fs.rmSync(file, { force: true });
      forgetMessages();
    }
  });
});

describe('readPlanSummary', () => {
  it('reads defensively: a hidden agent keeps no name, a bad child is left out', () => {
    const read = readPlanSummary({
      ...SUMMARY,
      children: [
        { ...SUMMARY.children[1], name: 'Leaked', agent_id: WINBACK },
        { state: 'exploded' },
        null,
      ],
    });
    expect(read.children).toHaveLength(1);
    expect(read.children[0]).toMatchObject({ hidden: true, name: null, agentId: null });
    expect(readPlanSummary({ v: 2 })).toBeNull();
    expect(readPlanSummary(null)).toBeNull();
  });
});
