import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "An agent needs you" in the brand's Slack channel (#2139, N6): for the
 * people who chose Inbox + Slack, mentioning them when their Slack account
 * is found by e-mail, else naming them; once per run and person; the people
 * it posted for, so the others get the e-mail.
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
vi.mock('./deliver.js', () => ({ deliverToSlack: vi.fn() }));
vi.mock('../composio.js', () => ({ proxyRequest: vi.fn() }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ logger, default: logger }));

const { SlackError } = await import('./api.js');
const { postNeedsYou } = await import('./needs-you.js');
const { needsYouMessage } = await import('./blocks/needs-you.js');

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/slack-api.json', import.meta.url)));
const ALL_ON = { pulse: true, drops: true, suggestion: true, needsYou: true };
const CHANNEL = { id: 'C00000001', name: 'seo-alerts', private: false };
const BRAND = { id: 'b1', organization_id: 'org-1', name: 'Northwind', is_demo: false };
const INPUT = {
  brand: BRAND,
  runId: 'run-1',
  agent: 'Content Writer',
  runUrl: 'https://app.test/dashboard/chat/chat-1',
  people: ['u1'],
};

let deliver;
let get;
const emailOf = vi.fn(async (id) => `${id}@acme.test`);

beforeEach(() => {
  h.slack = {
    status: 'connected',
    composioAccountId: 'ca_slack',
    settings: { channel: CHANNEL, send: ALL_ON },
  };
  h.names = [{ id: 'u1', full_name: 'Sam Lee' }];
  deliver = vi.fn(async () => ({ status: 'sent', ts: '1.2' }));
  get = vi.fn(async () => FIX['users.lookupByEmail'].data);
  logger.warn.mockClear();
  logger.error.mockClear();
});

describe('postNeedsYou', () => {
  it('mentions the person in the channel, once per run, and says it posted for them', async () => {
    const posted = await postNeedsYou(INPUT, { deliver, emailOf, get });
    expect(posted).toEqual(new Set(['u1']));
    expect(get).toHaveBeenCalledWith(h.slack, 'users.lookupByEmail', { email: 'u1@acme.test' });
    const [input] = deliver.mock.calls[0];
    expect(input).toMatchObject({
      brand: BRAND,
      kind: 'needs_you',
      dedupeKey: 'needs_you:run-1:u1',
    });
    const message = input.message();
    expect(message.text).toBe('<@U00000SAM> Content Writer needs you on Northwind');
    expect(JSON.stringify(message.blocks)).toContain(
      '<https://app.test/dashboard/chat/chat-1|Open the run>',
    );
  });

  it('names the person when Slack has no account for their e-mail', async () => {
    get.mockRejectedValue(new SlackError('users_not_found'));
    await postNeedsYou(INPUT, { deliver, emailOf, get });
    expect(deliver.mock.calls[0][0].message().text).toBe(
      'Content Writer needs Sam Lee on Northwind',
    );
    expect(logger.warn).not.toHaveBeenCalled();
    // Another refusal is logged by code.
    get.mockRejectedValue(new SlackError('missing_scope'));
    await postNeedsYou({ ...INPUT, runId: 'run-2' }, { deliver, emailOf, get });
    expect(logger.warn).toHaveBeenCalledWith(
      { code: 'missing_scope' },
      '[slack] person not looked up',
    );
  });

  it('counts a post already made for this run as posted', async () => {
    deliver.mockResolvedValue({ status: 'skipped', reason: 'already_sent' });
    expect(await postNeedsYou(INPUT, { deliver, emailOf, get })).toEqual(new Set(['u1']));
  });

  it.each([
    [
      'a post that failed',
      () => deliver.mockResolvedValue({ status: 'failed', code: 'is_archived' }),
    ],
    [
      'a plan without Slack',
      () => deliver.mockResolvedValue({ status: 'skipped', reason: 'plan' }),
    ],
  ])('posts for no one after %s, so they get the e-mail', async (_name, arrange) => {
    arrange();
    expect(await postNeedsYou(INPUT, { deliver, emailOf, get })).toEqual(new Set());
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
  ])('asks Slack nothing for %s', async (_name, arrange) => {
    arrange();
    expect(await postNeedsYou(INPUT, { deliver, emailOf, get })).toEqual(new Set());
    expect(get).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    deliver.mockRejectedValue(new Error('boom'));
    expect(await postNeedsYou(INPUT, { deliver, emailOf, get })).toEqual(new Set());
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe('needsYouMessage', () => {
  it("escapes Slack's markup in names", () => {
    const { text, blocks } = needsYouMessage({
      agent: 'Writer <beta>',
      brand: 'A & B',
      person: { name: null, slackId: null },
      runUrl: 'https://app.test/dashboard/chat',
    });
    expect(text).toBe('Writer &lt;beta&gt; needs its person on A &amp; B');
    expect(blocks[0].text.text).toBe('*Writer &lt;beta&gt;* needs its person on A &amp; B.');
  });
});
