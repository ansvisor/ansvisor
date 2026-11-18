import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An AEO Operator's summary in the brand's Slack channel (AEO Operator plan
 * §4.2 step 7): for the people who chose Inbox + Slack, mentioning them,
 * once per plan and person, under the brand's "An agent needs you" switch;
 * the message lists the agents, their work, their AI and what waits, with
 * links only.
 */

const h = vi.hoisted(() => ({ slack: null, names: [] }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        in: () => chain,
        then: (resolve) => resolve({ data: h.names, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('./connection.js', () => ({ brandSlack: async () => h.slack }));
vi.mock('./deliver.js', () => ({ deliverToSlack: vi.fn(), slackAllowed: vi.fn() }));
vi.mock('./approvals.js', () => ({ slackApprovalsReady: () => false, slackCard: vi.fn() }));
vi.mock('../composio.js', () => ({ proxyRequest: vi.fn() }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ logger, default: logger }));

const { postAgentPlan } = await import('./agent-plan.js');
const { agentPlanMessage } = await import('./blocks/agent-plan.js');
const { readPlanSummary } = await import('../chat-notices/plan-summary.js');

const ALL_ON = { pulse: true, drops: true, suggestion: true, needsYou: true };
const CHANNEL = { id: 'C00000001', name: 'seo-alerts', private: false };
const BRAND = { id: 'b1', organization_id: 'org-1', name: 'Northwind', is_demo: false };
const CHILD_CHAT = 'eeeeeeee-0000-4000-8000-000000000001';
const SUMMARY = readPlanSummary({
  v: 1,
  why: 'deadline',
  day: '2026-11-18',
  budget: 0.05,
  used: 0.012,
  approve_all: true,
  children: [
    {
      agent_id: 'abababab-0000-4000-8000-000000000001',
      name: 'Win <back>',
      state: 'waiting',
      chat_id: CHILD_CHAT,
      share: 0.01,
      used: 0.004,
      counts: { drafts: 1, findings: 0, tasks: 0, shipped: 0 },
      approve_all: true,
    },
    {
      agent_id: null,
      name: null,
      hidden: true,
      state: 'working',
      chat_id: null,
      share: 0.01,
      used: 0.006,
      counts: { drafts: 0, findings: 0, tasks: 0, shipped: 0 },
    },
  ],
});
const INPUT = {
  brand: BRAND,
  planId: 'plan-1',
  operator: 'AEO Operator',
  day: '2026-11-18',
  summary: SUMMARY,
  chatUrl: 'https://app.test/dashboard/chat/chat-op',
  chatUrlOf: (id) => `https://app.test/dashboard/chat/${id}`,
  approveAllUrl: 'https://app.test/dashboard/chat/inbox?tab=needsYou',
  people: ['u1'],
};

let deliver;
let get;
const emailOf = vi.fn(async (id) => `${id}@acme.test`);

beforeEach(() => {
  h.slack = { status: 'connected', settings: { channel: CHANNEL, send: ALL_ON } };
  h.names = [{ id: 'u1', full_name: 'Sam Lee' }];
  deliver = vi.fn(async () => ({ status: 'sent', ts: '1.2' }));
  get = vi.fn(async () => ({ user: { id: 'U00000SAM' } }));
});

describe('postAgentPlan', () => {
  it('mentions the person in the channel, once per plan, and says it posted for them', async () => {
    expect(await postAgentPlan(INPUT, { deliver, emailOf, get })).toEqual(new Set(['u1']));
    const [input] = deliver.mock.calls[0];
    expect(input).toMatchObject({
      brand: BRAND,
      kind: 'needs_you',
      dedupeKey: 'agent_plan:plan-1:u1',
    });
    expect(input.message.text).toBe(
      '<@U00000SAM> AEO Operator on Northwind: 0 of 2 agents done · 1 waits for you',
    );
  });

  it('counts a post already made as posted, and posts for no one when it failed', async () => {
    deliver.mockResolvedValue({ status: 'skipped', reason: 'already_sent' });
    expect(await postAgentPlan(INPUT, { deliver, emailOf, get })).toEqual(new Set(['u1']));
    deliver.mockResolvedValue({ status: 'failed', code: 'is_archived' });
    expect(await postAgentPlan(INPUT, { deliver, emailOf, get })).toEqual(new Set());
  });

  it.each([
    ['no Slack', () => (h.slack = null)],
    ['no channel', () => (h.slack = { ...h.slack, settings: { channel: null, send: ALL_ON } })],
    [
      '"needs you" off',
      () =>
        (h.slack = {
          ...h.slack,
          settings: { channel: CHANNEL, send: { ...ALL_ON, needsYou: false } },
        }),
    ],
  ])('asks Slack nothing with %s', async (_name, arrange) => {
    arrange();
    expect(await postAgentPlan(INPUT, { deliver, emailOf, get })).toEqual(new Set());
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('agentPlanMessage', () => {
  it('lists the agents, their work and AI, the total, what waits, and links only', () => {
    const { blocks } = agentPlanMessage({
      ...INPUT,
      brand: 'Northwind',
      person: { name: 'Sam', slackId: null },
    });
    const all = JSON.stringify(blocks);
    expect(blocks[0].text.text).toBe(
      '*AEO Operator* · Northwind · Nov 18: 0 of 2 agents done · 1 waits for you.',
    );
    expect(blocks[1].text.text).toContain(
      'Some of the agents AEO Operator started on Northwind for Nov 18 are still working',
    );
    expect(blocks[1].text.text).toContain(
      `• *Win &lt;back&gt;* · Waits for you · 1 draft saved · 0.4% of its 1% · <https://app.test/dashboard/chat/${CHILD_CHAT}|Open its chat>`,
    );
    expect(blocks[1].text.text).toContain(
      '• *An agent you can’t see* · Still working · 0.6% of its 1%',
    );
    expect(blocks[2].text.text).toContain('AI used: 1.2% of the day’s 5% budget');
    expect(blocks[2].text.text).toContain(
      '<https://app.test/dashboard/chat/inbox?tab=needsYou|Approve all in the Inbox>',
    );
    expect(all).toContain('<https://app.test/dashboard/chat/chat-op|Open the summary>');
    expect(blocks.some((block) => block.type === 'actions')).toBe(false);
    expect(blocks.at(-1).elements[0].text).toContain('Posted because Sam chose Inbox + Slack');
  });
});
