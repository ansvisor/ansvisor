import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Approve and Reject from Slack (#2139, N7), once Slack's signature is
 * checked: the button's post found only as Slack shows it, the brand's own
 * Slack connection and workspace, the plan, the card read within that
 * workspace and brand, and only the person it waits for, by their Slack
 * account found by e-mail. The web decides; the message is answered through
 * the click's response_url. Every refusal is a reply only the clicker sees,
 * with Open in Ansvisor, and nothing is decided.
 */

const h = vi.hoisted(() => ({ tables: {}, slack: null }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const filters = [];
      const chain = {
        select: () => chain,
        eq: (column, value) => (filters.push((row) => row[column] === value), chain),
        maybeSingle: async () => ({
          data: (h.tables[table] ?? []).find((row) => filters.every((f) => f(row))) ?? null,
          error: null,
        }),
      };
      return chain;
    },
  },
}));
vi.mock('./connection.js', () => ({ brandSlack: async () => h.slack }));
vi.mock('./deliver.js', () => ({ slackAllowed: vi.fn() }));
vi.mock('../chat-agents.js', () => ({ postToChatInternal: vi.fn() }));
vi.mock('../chat-notices/own-key.js', () => ({ appOrigin: () => 'https://app.test' }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ logger, default: logger }));

const { SlackError } = await import('./api.js');
const { handleSlackDecision } = await import('./approvals.js');

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/slack-api.json', import.meta.url)));
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '11111111-1111-4111-8111-999999999999';
const BRAND = '22222222-2222-4222-8222-222222222222';
const AGENT_RUN = '33333333-3333-4333-8333-333333333333';
const POST = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = '55555555-5555-4555-8555-555555555555';
const SAM = '77777777-7777-4777-8777-777777777777';
const CHAT = '88888888-8888-4888-8888-888888888888';
const DIGEST = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const RESPONSE_URL = 'https://hooks.slack.com/actions/T00000001/1/abc';
const RUN_URL = `https://app.test/dashboard/chat/${CHAT}`;

const click = (over = {}, action = {}) => ({
  type: 'block_actions',
  team: { id: 'T00000001' },
  user: { id: 'U00000SAM', team_id: 'T00000001' },
  container: { type: 'message', channel_id: 'C00000001', message_ts: '1762770000.000100' },
  channel: { id: 'C00000001' },
  response_url: RESPONSE_URL,
  actions: [{ action_id: 'ansvisor_approve', value: `${POST}:3:${DIGEST}`, ...action }],
  ...over,
});
const CARD = {
  state: 'waiting',
  kind: 'ask',
  n: 3,
  digest: DIGEST,
  title: 'Save drafts in Content',
  target: '“Pricing FAQ” on Northwind',
  fromSlack: true,
  agent: 'Content Writer',
  person: 'Sam Lee',
  conversationId: CHAT,
  decided: null,
};

let deps;
let replies;
const web = (cardAnswer, decision) =>
  vi.fn(async (path) =>
    path === 'slack/card'
      ? { status: 200, body: { ok: true, card: cardAnswer } }
      : { status: 200, body: { ok: true, decision } },
  );
const decideCalls = () => deps.callWeb.mock.calls.filter(([path]) => path === 'slack/decide');
const last = () => replies.at(-1);

beforeEach(() => {
  h.tables = {
    slack_posts: [
      {
        id: POST,
        organization_id: ORG,
        brand_id: BRAND,
        account_id: ACCOUNT,
        kind: 'needs_you',
        dedupe_key: `needs_you:${AGENT_RUN}:${SAM}`,
        channel_id: 'C00000001',
        message_ts: '1762770000.000100',
        status: 'sent',
      },
    ],
    brands: [{ id: BRAND, name: 'Northwind', organization_id: ORG, is_demo: false }],
    profiles: [{ id: SAM, organization_id: ORG }],
  };
  h.slack = {
    accountId: ACCOUNT,
    organizationId: ORG,
    status: 'connected',
    composioAccountId: 'ca_slack',
  };
  replies = [];
  deps = {
    get: vi.fn(async (_slack, method) =>
      method === 'auth.test' ? FIX['auth.test'].data : FIX['users.lookupByEmail'].data,
    ),
    callWeb: web(CARD, { outcome: 'approved', card: CARD }),
    respond: vi.fn(async (url, body) => (replies.push({ url, body }), true)),
    emailOf: vi.fn(async () => 'sam@northwind.test'),
    allowed: vi.fn(async () => true),
    now: () => new Date('2026-11-15T10:00:00Z'),
  };
  logger.error.mockClear();
});

describe('handleSlackDecision', () => {
  it('approves as the person it waits for, and the message says who and when, without buttons', async () => {
    expect(await handleSlackDecision(click(), deps)).toBe('approved');
    expect(deps.get).toHaveBeenCalledWith(h.slack, 'users.lookupByEmail', {
      email: 'sam@northwind.test',
    });
    expect(deps.allowed).toHaveBeenCalledWith(ORG, 'slack_approvals');
    expect(deps.callWeb).toHaveBeenCalledWith(
      'slack/card',
      { organizationId: ORG, brandId: BRAND, agentRunId: AGENT_RUN, n: 3 },
      expect.anything(),
    );
    expect(decideCalls()).toEqual([
      [
        'slack/decide',
        {
          organizationId: ORG,
          brandId: BRAND,
          agentRunId: AGENT_RUN,
          userId: SAM,
          decision: 'approve',
          n: 3,
          digest: DIGEST,
        },
        expect.anything(),
      ],
    ]);
    expect(replies).toHaveLength(1);
    const { url, body } = last();
    expect(url).toBe(RESPONSE_URL);
    expect(body.replace_original).toBe(true);
    expect(body.blocks.some((block) => block.type === 'actions')).toBe(false);
    const text = JSON.stringify(body.blocks);
    expect(text).toContain('Approved by Sam Lee in Slack · <!date^1794736800^');
    expect(text).toContain('*Save drafts in Content* · “Pricing FAQ” on Northwind');
    expect(text).toContain(`<${RUN_URL}|Open in Ansvisor>`);
  });

  it('rejects as the card’s Skip', async () => {
    deps.callWeb = web(CARD, { outcome: 'rejected', card: CARD });
    const payload = click({}, { action_id: 'ansvisor_reject' });
    expect(await handleSlackDecision(payload, deps)).toBe('rejected');
    expect(decideCalls()[0][1]).toMatchObject({ decision: 'reject' });
    expect(JSON.stringify(last().body.blocks)).toContain('Rejected by Sam Lee in Slack');
  });

  it('answers a card decided in Ansvisor: the message loses its buttons, nothing changes', async () => {
    const decided = {
      ...CARD,
      state: 'decided',
      kind: null,
      decided: { how: 'approved', at: '2026-11-15T09:00:00Z', inSlack: false },
    };
    deps.callWeb = web(decided, null);
    // Anyone in the workspace who clicks, the person it waited for or not.
    const zoe = click({ user: { id: 'U00000ZOE', team_id: 'T00000001' } });
    expect(await handleSlackDecision(zoe, deps)).toBe('decided');
    expect(decideCalls()).toEqual([]);
    const [message, reply] = replies.map((r) => r.body);
    expect(message.replace_original).toBe(true);
    expect(JSON.stringify(message.blocks)).toContain('Approved by Sam Lee in Ansvisor');
    expect(reply).toMatchObject({ response_type: 'ephemeral', replace_original: false });
    expect(reply.text).toContain('This was already decided: Approved by Sam Lee in Ansvisor');
    expect(reply.text).toContain('Nothing changed.');
  });

  it('answers a second click the web found decided (a double click)', async () => {
    const decided = {
      ...CARD,
      state: 'decided',
      decided: { how: 'approved', at: null, inSlack: true },
    };
    deps.callWeb = web(CARD, { outcome: 'decided', card: decided });
    expect(await handleSlackDecision(click(), deps)).toBe('decided');
    expect(JSON.stringify(replies[0].body.blocks)).toContain('Approved by Sam Lee in Slack');
  });

  const refusals = [
    ['a value that isn’t one of ours', 'not_found', () => click({}, { value: 'run-1:3:abc' })],
    [
      'a post id that isn’t there',
      'not_found',
      () => ((h.tables.slack_posts[0].id = 'x'), click()),
    ],
    [
      'a post id shown in another channel',
      'not_found',
      () => click({ container: { channel_id: 'C00000009', message_ts: '1762770000.000100' } }),
    ],
    [
      'a post id shown on another message',
      'not_found',
      () => click({ container: { channel_id: 'C00000001', message_ts: '1762770000.000999' } }),
    ],
    [
      'a post of another kind',
      'not_found',
      () => ((h.tables.slack_posts[0].kind = 'pulse'), click()),
    ],
    [
      'a brand of another workspace than its post',
      'not_found',
      () => ((h.tables.brands[0].organization_id = OTHER_ORG), click()),
    ],
    ['the demo brand', 'not_found', () => ((h.tables.brands[0].is_demo = true), click())],
    [
      'a brand that uses another Slack connection now',
      'connection',
      () => ((h.slack = { ...h.slack, accountId: 'other' }), click()),
    ],
    [
      'a Slack connection of another Ansvisor workspace',
      'connection',
      () => ((h.slack = { ...h.slack, organizationId: OTHER_ORG }), click()),
    ],
    [
      'a connection Slack refused',
      'connection',
      () => ((h.slack = { ...h.slack, status: 'auth_failed' }), click()),
    ],
    [
      'a click from another Slack workspace',
      'other_workspace',
      () => click({ team: { id: 'T00000099' } }),
    ],
    [
      'a Slack user of another workspace in a shared channel',
      'other_workspace',
      () => click({ user: { id: 'U00000SAM', team_id: 'T00000099' } }),
    ],
    [
      'a plan without Slack approvals',
      'plan',
      () => (deps.allowed.mockResolvedValue(false), click()),
    ],
    [
      'a person no longer a member',
      'not_member',
      () => ((h.tables.profiles[0].organization_id = OTHER_ORG), click()),
    ],
    [
      'a person with no Slack account for their e-mail',
      'not_linked',
      () => (
        deps.get.mockImplementation(async (_s, m) => {
          if (m === 'auth.test') return FIX['auth.test'].data;
          throw new SlackError('users_not_found');
        }),
        click()
      ),
    ],
    [
      'a person whose e-mail isn’t confirmed',
      'not_linked',
      () => (deps.emailOf.mockResolvedValue(null), click()),
    ],
    [
      'a Slack account on another team for their e-mail',
      'not_linked',
      () => (
        deps.get.mockImplementation(async (_s, m) =>
          m === 'auth.test'
            ? FIX['auth.test'].data
            : { user: { ...FIX['users.lookupByEmail'].data.user, team_id: 'T00000099' } },
        ),
        click()
      ),
    ],
    [
      'someone else in the channel',
      'not_yours',
      () => click({ user: { id: 'U00000ZOE', team_id: 'T00000001' } }),
    ],
  ];

  it.each(refusals)(
    'refuses %s: a reply only they see, and nothing is decided',
    async (_name, reason, arrange) => {
      const payload = arrange();
      expect(await handleSlackDecision(payload, deps)).toBe(reason);
      expect(decideCalls()).toEqual([]);
      expect(replies).toHaveLength(1);
      expect(last().body).toMatchObject({ response_type: 'ephemeral', replace_original: false });
      expect(last().body.blocks[0].text.text).toContain('|Open in Ansvisor>');
    },
  );

  it('never reads the card for a click it can’t place', async () => {
    await handleSlackDecision(click({ team: { id: 'T00000099' } }), deps);
    expect(deps.callWeb).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 'Your role or brand access doesn’t allow this change now.'],
    ['read_only', 'This Ansvisor workspace is read-only'],
    ['needs_app', 'This change needs Sam Lee signed in to Ansvisor'],
    ['demo', 'The sample brand changes nothing.'],
  ])('says why the web refused (%s), and the message keeps its buttons', async (reason, words) => {
    deps.callWeb = web(CARD, { outcome: 'refused', reason, card: CARD });
    expect(await handleSlackDecision(click(), deps)).toBe(reason);
    expect(replies).toHaveLength(1);
    expect(last().body.text).toContain(words);
    expect(last().body.blocks[0].text.text).toContain(`<${RUN_URL}|Open in Ansvisor>`);
  });

  it('says it failed when the web didn’t answer, and never throws', async () => {
    deps.callWeb = vi.fn(async (path) =>
      path === 'slack/card' ? { status: 200, body: { card: CARD } } : null,
    );
    expect(await handleSlackDecision(click(), deps)).toBe('failed');
    expect(last().body.text).toContain('Something went wrong, so nothing changed.');
    deps.get.mockRejectedValue(new SlackError('composio_failed'));
    expect(await handleSlackDecision(click(), deps)).toBe('failed');
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('ignores what isn’t a click of ours, and never answers anywhere but Slack', async () => {
    const elsewhere = click({ response_url: 'https://attacker.test/hook' });
    expect(await handleSlackDecision(elsewhere, deps)).toBe('ignored');
    expect(await handleSlackDecision(click({}, { action_id: 'ansvisor_open' }), deps)).toBe(
      'ignored',
    );
    expect(await handleSlackDecision({ type: 'view_submission' }, deps)).toBe('ignored');
    expect(deps.respond).not.toHaveBeenCalled();
    expect(deps.callWeb).not.toHaveBeenCalled();
  });
});
