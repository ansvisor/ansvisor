import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One message to a brand's Slack channel (#2139): only with Slack set up, a
 * connected workspace, a channel, the kind on, a plan with Slack and a
 * connector who can still see the brand; once per dedupe key; spaced per
 * channel; tried once more when that can help; a refused workspace and a
 * gone channel kept true on the card; codes only in the logs; never thrown.
 */

const h = vi.hoisted(() => ({
  configured: true,
  org: { plan: 'starter', subscription_status: 'active', plan_overrides: null },
  orgError: null,
  insertError: null,
  inserts: [],
  updates: [],
  slack: null,
  sees: true,
}));

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, op: 'select', payload: null, filters: [] };
      const chain = {
        select: () => chain,
        insert: (row) => ((call.op = 'insert'), (call.payload = row), h.inserts.push(row), chain),
        update: (patch) => ((call.op = 'update'), (call.payload = patch), chain),
        eq: (col, val) => (call.filters.push([col, val]), chain),
        maybeSingle: async () => ({ data: h.orgError ? null : h.org, error: h.orgError }),
        single: async () =>
          h.insertError
            ? { data: null, error: h.insertError }
            : { data: { id: 'post-1' }, error: null },
        then: (resolve, reject) => {
          if (call.op === 'update') h.updates.push([table, call.payload, call.filters]);
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));
vi.mock('../plan-guard.js', () => ({ applyPlanOverrides: (plan) => plan }));
vi.mock('../composio.js', () => ({
  isSlackConfigured: () => h.configured,
  proxyRequest: vi.fn(),
}));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ logger, default: logger }));
const conn = vi.hoisted(() => ({
  markRefused: vi.fn(async () => {}),
  saveSettings: vi.fn(async () => {}),
}));
vi.mock('./connection.js', () => ({
  brandSlack: async () => h.slack,
  seesBrand: async () => h.sees,
  markRefused: (...a) => conn.markRefused(...a),
  saveSettings: (...a) => conn.saveSettings(...a),
}));

const { SlackError } = await import('./api.js');
const { CHANNEL_GAP_MS, deliverToSlack, resetChannelSlots, slackAllowed } =
  await import('./deliver.js');

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/slack-api.json', import.meta.url)));
const BRAND = { id: 'b1', organization_id: 'org-1', is_demo: false, name: 'Northwind' };
const ALL_ON = { pulse: true, drops: true, suggestion: true, needsYou: true };
const CHANNEL = { id: 'C00000001', name: 'seo-alerts', private: false };
const MESSAGE = { text: 'Northwind Daily Pulse', blocks: [{ type: 'section' }] };
const slack = (over = {}) => ({
  accountId: 'acct-1',
  organizationId: 'org-1',
  entityId: 'org_org-1',
  composioAccountId: 'ca_slack',
  label: 'Acme Test',
  status: 'connected',
  connectedBy: 'u1',
  connectedAt: '2026-11-10T09:00:00Z',
  settings: { channel: CHANNEL, send: ALL_ON },
  ...over,
});

/** A clock that only moves when slept, and the sleeps asked for. */
function clock() {
  let at = 1_000_000;
  const sleeps = [];
  return {
    now: () => at,
    sleep: async (ms) => {
      sleeps.push(ms);
      at += ms;
    },
    sleeps,
  };
}

const posted = (data = FIX['chat.postMessage'].data) => vi.fn(async () => data);
const deliver = (deps, over = {}) =>
  deliverToSlack(
    { brand: BRAND, kind: 'pulse', dedupeKey: 'pulse:2026-11-10', message: MESSAGE, ...over },
    deps,
  );

beforeEach(() => {
  Object.assign(h, {
    configured: true,
    org: { plan: 'starter', subscription_status: 'active', plan_overrides: null },
    orgError: null,
    insertError: null,
    inserts: [],
    updates: [],
    slack: slack(),
    sees: true,
  });
  BRAND.is_demo = false;
  vi.stubEnv('IS_CLOUD', 'true');
  conn.markRefused.mockClear();
  conn.saveSettings.mockClear();
  for (const fn of Object.values(logger)) fn.mockClear();
  resetChannelSlots();
});

afterAll(() => vi.unstubAllEnvs());

describe('deliverToSlack', () => {
  it('keeps the message, posts it to the channel and records Slack’s ts', async () => {
    const post = posted();
    const c = clock();
    await expect(deliver({ post, ...c })).resolves.toEqual({
      status: 'sent',
      ts: '1762770000.000100',
    });
    expect(h.inserts).toEqual([
      {
        organization_id: 'org-1',
        brand_id: 'b1',
        account_id: 'acct-1',
        kind: 'pulse',
        dedupe_key: 'pulse:2026-11-10',
        channel_id: 'C00000001',
        status: 'sending',
      },
    ]);
    expect(post).toHaveBeenCalledWith(slack(), 'chat.postMessage', {
      channel: 'C00000001',
      ...MESSAGE,
      unfurl_links: false,
      unfurl_media: false,
    });
    expect(h.updates).toEqual([
      [
        'slack_posts',
        {
          status: 'sent',
          message_ts: '1762770000.000100',
          sent_at: new Date(c.now()).toISOString(),
          attempts: 1,
          error_code: null,
        },
        [['id', 'post-1']],
      ],
    ]);
  });

  it.each([
    ['the demo brand', () => Object.assign(BRAND, { is_demo: true }), 'demo_brand'],
    ['no Slack on this server', () => (h.configured = false), 'not_configured'],
    ['no workspace', () => (h.slack = null), 'not_connected'],
    ['a pending install', () => (h.slack = slack({ status: 'pending' })), 'not_connected'],
    ['a refused workspace', () => (h.slack = slack({ status: 'auth_failed' })), 'refused'],
    [
      'the kind off',
      () =>
        (h.slack = slack({ settings: { channel: CHANNEL, send: { ...ALL_ON, pulse: false } } })),
      'off',
    ],
    [
      'no channel',
      () => (h.slack = slack({ settings: { channel: null, send: ALL_ON } })),
      'no_channel',
    ],
    ['a plan that ended', () => (h.org = { ...h.org, subscription_status: 'canceled' }), 'plan'],
    ['a connector who lost the brand', () => (h.sees = false), 'access_lost'],
  ])('posts nothing for %s', async (_name, arrange, reason) => {
    arrange();
    const post = posted();
    await expect(deliver({ post, ...clock() })).resolves.toEqual({ status: 'skipped', reason });
    expect(post).not.toHaveBeenCalled();
    expect(h.inserts).toEqual([]);
  });

  it('posts a message once, whoever asks again', async () => {
    h.insertError = { code: '23505', message: 'duplicate key' };
    const post = posted();
    await expect(deliver({ post, ...clock() })).resolves.toEqual({
      status: 'skipped',
      reason: 'already_sent',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('says once that 00515 is missing, and posts nothing until it is applied', async () => {
    h.insertError = { code: '42P01', message: 'relation "slack_posts" does not exist' };
    const post = posted();
    await expect(deliver({ post, ...clock() })).resolves.toEqual({
      status: 'skipped',
      reason: 'not_migrated',
    });
    await deliver({ post, ...clock() });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('words the message only once every check passed', async () => {
    const make = vi.fn(() => MESSAGE);
    h.sees = false;
    await deliver({ post: posted(), ...clock() }, { message: make });
    expect(make).not.toHaveBeenCalled();
    h.sees = true;
    await expect(deliver({ post: posted(), ...clock() }, { message: make })).resolves.toMatchObject(
      { status: 'sent' },
    );
    expect(make).toHaveBeenCalledOnce();
  });

  it('spaces posts to one channel by a second', async () => {
    const c = clock();
    const post = posted();
    await deliver({ post, ...c });
    await deliver({ post, ...c }, { dedupeKey: 'pulse:2026-11-11' });
    expect(c.sleeps).toEqual([CHANNEL_GAP_MS]);
    // Another channel waits for nothing.
    h.slack = slack({ settings: { channel: { ...CHANNEL, id: 'C00000002' }, send: ALL_ON } });
    await deliver({ post, ...c }, { dedupeKey: 'pulse:2026-11-12' });
    expect(c.sleeps).toEqual([CHANNEL_GAP_MS]);
  });

  it('tries once more after Slack’s Retry-After on a 429', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new SlackError('ratelimited', { status: 429, retryAfter: 3 }))
      .mockResolvedValueOnce(FIX['chat.postMessage'].data);
    const c = clock();
    await expect(deliver({ post, ...c })).resolves.toMatchObject({ status: 'sent' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(c.sleeps).toContain(3000);
    expect(h.updates.at(-1)[1]).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('gives up at once when Slack asks to wait too long, or the second try fails too', async () => {
    let post = vi.fn().mockRejectedValue(new SlackError('ratelimited', { retryAfter: 120 }));
    await expect(deliver({ post, ...clock() })).resolves.toEqual({
      status: 'failed',
      code: 'ratelimited',
    });
    expect(post).toHaveBeenCalledTimes(1);

    post = vi.fn().mockRejectedValue(new SlackError('slack_unavailable', { status: 503 }));
    const c = clock();
    await expect(deliver({ post, ...c }, { dedupeKey: 'pulse:x' })).resolves.toEqual({
      status: 'failed',
      code: 'slack_unavailable',
    });
    expect(post).toHaveBeenCalledTimes(2);
    expect(c.sleeps).toContain(2000);
    expect(h.updates.at(-1)[1]).toEqual({
      status: 'failed',
      error_code: 'slack_unavailable',
      attempts: 2,
    });
    // Logged by code only.
    expect(logger.warn).toHaveBeenLastCalledWith(
      { brandId: 'b1', kind: 'pulse', code: 'slack_unavailable', status: 503, attempts: 2 },
      '[slack] post failed',
    );
  });

  it('marks a workspace that refuses the connection, without a second try', async () => {
    const post = vi.fn().mockRejectedValue(new SlackError('token_revoked'));
    await expect(deliver({ post, ...clock() })).resolves.toEqual({
      status: 'failed',
      code: 'token_revoked',
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(conn.markRefused).toHaveBeenCalledWith('acct-1');
    expect(conn.saveSettings).not.toHaveBeenCalled();
  });

  it.each(['channel_not_found', 'is_archived', 'not_in_channel'])(
    'clears a channel Slack answers %s for, so the card asks for another',
    async (code) => {
      const post = vi.fn().mockRejectedValue(new SlackError(code));
      await expect(deliver({ post, ...clock() })).resolves.toEqual({ status: 'failed', code });
      expect(conn.saveSettings).toHaveBeenCalledWith('b1', { channel: null, send: ALL_ON });
      expect(conn.markRefused).not.toHaveBeenCalled();
    },
  );

  it('never throws: a failure around it is logged by name and code', async () => {
    h.orgError = { message: 'down' };
    await expect(deliver({ post: posted(), ...clock() })).resolves.toEqual({
      status: 'failed',
      code: 'error',
    });
    expect(logger.error).toHaveBeenCalledWith(
      { brandId: 'b1', kind: 'pulse', err: { name: 'Error', code: null } },
      '[slack] delivery failed',
    );
  });

  it('records a message it could not word as failed', async () => {
    const make = () => {
      throw new TypeError('bad metrics');
    };
    await expect(deliver({ post: posted(), ...clock() }, { message: make })).resolves.toEqual({
      status: 'failed',
      code: 'error',
    });
    expect(h.updates[0][1]).toEqual({ status: 'failed', error_code: 'render_failed', attempts: 0 });
  });
});

describe('slackAllowed', () => {
  it('is every paid plan, in its trial too, and always off the cloud', async () => {
    for (const plan of ['starter', 'growth', 'enterprise']) {
      h.org = { plan, subscription_status: 'active', plan_overrides: null };
      await expect(slackAllowed('org-1')).resolves.toBe(true);
    }
    h.org = { plan: 'growth', subscription_status: 'trialing', plan_overrides: null };
    await expect(slackAllowed('org-1')).resolves.toBe(true);
    h.org = { plan: 'growth', subscription_status: 'past_due', plan_overrides: null };
    await expect(slackAllowed('org-1')).resolves.toBe(false);
    h.org = null;
    await expect(slackAllowed('org-1')).resolves.toBe(false);
    vi.stubEnv('IS_CLOUD', '');
    await expect(slackAllowed('org-1')).resolves.toBe(true);
  });
});
