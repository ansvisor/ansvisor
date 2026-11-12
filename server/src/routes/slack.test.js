import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * A brand's Slack (#2139, N1): anyone who can access the brand reads where
 * it stands; an admin or manager who can access it connects a workspace,
 * uses another brand's, picks the channel and what goes to it, sends a test
 * message and disconnects, on a plan with Slack notifications. The demo
 * brand connects nothing. No Composio id leaves, and Slack's failures keep
 * the card true.
 */

const BRAND = '22222222-2222-4222-8222-222222222222';
const OTHER = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const SHARED = '55555555-5555-4555-8555-555555555555';

const h = vi.hoisted(() => ({
  access: vi.fn(),
  everyBrand: vi.fn(),
  brandAccess: vi.fn(),
  readers: vi.fn(),
  enforce: vi.fn(),
  configured: { value: true },
  tables: {},
}));

const lib = {
  usableAccounts: vi.fn(),
  useAccountForBrand: vi.fn(),
  startBrandAccount: vi.fn(),
  activateBrandAccount: vi.fn(),
  removeBrandAccount: vi.fn(),
  signInBrandIds: vi.fn(),
};
const slackLib = {
  brandSlack: vi.fn(),
  listChannels: vi.fn(),
  markRefused: vi.fn(),
  postConnectedMessage: vi.fn(),
  readChannel: vi.fn(),
  readWorkspaceLabel: vi.fn(),
  saveSettings: vi.fn(),
  saveWorkspaceLabel: vi.fn(),
};
const initiateSlackConnection = vi.fn();
const deleteConnection = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: async () => ({ data: (h.tables[table] ?? [])[0] ?? null, error: null }),
        then: (resolve) => resolve({ data: h.tables[table] ?? [], error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/composio.js', () => ({
  connectedAccountStatus: vi.fn(),
  deleteConnection: (...a) => deleteConnection(...a),
  entityIdFor: (orgId) => `org_${orgId}`,
  initiateSlackConnection: (...a) => initiateSlackConnection(...a),
  isSlackConfigured: () => h.configured.value,
}));
vi.mock('../lib/brand-integrations.js', () =>
  Object.fromEntries(Object.entries(lib).map(([k, fn]) => [k, (...a) => fn(...a)])),
);
vi.mock('../lib/slack/connection.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    ...Object.fromEntries(Object.entries(slackLib).map(([k, fn]) => [k, (...a) => fn(...a)])),
  };
});
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...a) => h.access(...a),
  assertEveryBrand: (...a) => h.everyBrand(...a),
  brandAccessOf: (...a) => h.brandAccess(...a),
  brandReaders: (...a) => h.readers(...a),
}));
vi.mock('../lib/plan-guard.js', () => {
  class PlanLimitError extends Error {
    constructor(message, statusCode = 403) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { PlanLimitError, enforceFeature: (...a) => h.enforce(PlanLimitError, ...a) };
});
vi.mock('../middleware/rate-limiter.js', () => ({ slackLimiter: (_req, _res, next) => next() }));

const { SlackError } = await import('../lib/slack/api.js');

let server;
let baseUrl;
const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

beforeAll(async () => {
  const { default: router } = await import('./slack.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = log;
    next();
  });
  app.use('/api/slack', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/slack`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const brand = (over = {}) => ({
  id: BRAND,
  organization_id: 'org-1',
  is_demo: false,
  name: 'Northwind',
  ...over,
});

const ALL_ON = { pulse: true, drops: true, suggestion: true, needsYou: true };
const CHANNEL = { id: 'C00000001', name: 'seo-alerts', private: false };
const slack = (over = {}) => ({
  accountId: ACCOUNT,
  organizationId: 'org-1',
  entityId: 'org_org-1',
  composioAccountId: 'ca_secret',
  label: 'Acme Test (acme-test.slack.com)',
  status: 'connected',
  connectedBy: 'u1',
  connectedAt: '2026-11-10T09:00:00Z',
  settings: { channel: CHANNEL, send: ALL_ON },
  ...over,
});

beforeEach(() => {
  vi.unstubAllEnvs();
  for (const fn of [...Object.values(lib), ...Object.values(slackLib)]) fn.mockReset();
  for (const fn of [log.error, log.warn, initiateSlackConnection, deleteConnection]) fn.mockReset();
  h.configured.value = true;
  h.tables = {
    profiles: [{ id: 'u1', full_name: 'Sam Lee' }],
    brands: [{ id: BRAND }, { id: OTHER }],
    integration_accounts: [{ connected_by: 'u1' }],
  };
  h.access.mockReset().mockResolvedValue({ brand: brand(), role: 'manager' });
  h.everyBrand.mockReset().mockResolvedValue({ orgId: 'org-1' });
  h.brandAccess.mockReset().mockResolvedValue({ all: true, brandIds: new Set() });
  h.readers.mockReset().mockResolvedValue(new Map([['u1', new Set([BRAND])]]));
  h.enforce.mockReset().mockResolvedValue(undefined);
  lib.usableAccounts.mockResolvedValue([]);
  lib.signInBrandIds.mockResolvedValue([BRAND]);
  slackLib.brandSlack.mockResolvedValue(slack());
  slackLib.saveSettings.mockResolvedValue(undefined);
  slackLib.markRefused.mockResolvedValue(undefined);
});

const send = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('GET /api/slack/brands/:brandId', () => {
  it('says where the brand stands, with no Composio id', async () => {
    lib.signInBrandIds.mockResolvedValue([BRAND, OTHER, 'b-not-mine']);
    h.brandAccess.mockResolvedValue({ all: false, brandIds: new Set([BRAND, OTHER]) });
    lib.usableAccounts.mockResolvedValue([
      { accountId: ACCOUNT, label: 'Acme', connectedBy: 'u1', brandIds: [BRAND] },
      { accountId: SHARED, label: 'Contoso HQ', connectedBy: 'u1', brandIds: [OTHER] },
      { accountId: 'acct-hidden', label: 'Far', connectedBy: 'u9', brandIds: [OTHER] },
    ]);
    const res = await send('GET', `/brands/${BRAND}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      configured: true,
      allowed: true,
      state: 'connected',
      workspace: {
        accountId: ACCOUNT,
        label: 'Acme Test (acme-test.slack.com)',
        connectedBy: 'Sam Lee',
        connectedAt: '2026-11-10T09:00:00Z',
        // Only the brands the person can access.
        sharedWith: [OTHER],
      },
      channel: CHANNEL,
      send: ALL_ON,
      // Another workspace whose connector sees this brand; not the one it uses.
      usable: [{ accountId: SHARED, label: 'Contoso HQ', brandIds: [OTHER] }],
    });
    expect(JSON.stringify(body)).not.toContain('ca_secret');
    expect(lib.usableAccounts).toHaveBeenCalledWith('org-1', 'slack', [BRAND, OTHER]);
  });

  it('is for anyone who can access the brand, on any plan', async () => {
    h.access.mockResolvedValue({ brand: brand(), role: 'analyst' });
    h.enforce.mockImplementation((PlanLimitError) => {
      throw new PlanLimitError('Choose a plan', 402);
    });
    slackLib.brandSlack.mockResolvedValue(null);
    const body = await (await send('GET', `/brands/${BRAND}`)).json();
    expect(body).toMatchObject({
      allowed: false,
      state: 'not_connected',
      workspace: null,
      channel: null,
      send: ALL_ON,
    });
  });

  it("says when whoever connected it can't see the brand, or Slack refused it", async () => {
    h.readers.mockResolvedValue(new Map([['u2', new Set([BRAND])]]));
    expect((await (await send('GET', `/brands/${BRAND}`)).json()).state).toBe('access_lost');
    slackLib.brandSlack.mockResolvedValue(slack({ status: 'auth_failed' }));
    const body = await (await send('GET', `/brands/${BRAND}`)).json();
    expect(body).toMatchObject({ state: 'refused', workspace: { accountId: ACCOUNT } });
  });

  it('says when this server has no Slack', async () => {
    h.configured.value = false;
    expect((await (await send('GET', `/brands/${BRAND}`)).json()).configured).toBe(false);
  });

  it("refuses a brand the person can't access, and a bad id", async () => {
    h.access.mockRejectedValue(
      Object.assign(new Error("You don't have access to this brand"), {
        status: 403,
        code: 'no_brand_access',
      }),
    );
    const res = await send('GET', `/brands/${BRAND}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'no_brand_access' });
    expect((await send('GET', '/brands/nope')).status).toBe(400);
  });
});

describe('writes', () => {
  const writes = [
    ['POST', `/brands/${BRAND}/connect`, { callbackUrl: 'https://app.test/x' }],
    ['POST', `/brands/${BRAND}/activate`, { accountId: ACCOUNT }],
    ['POST', `/brands/${BRAND}/use`, { accountId: SHARED }],
    ['GET', `/brands/${BRAND}/channels`, undefined],
    ['PUT', `/brands/${BRAND}`, { channelId: 'C00000001' }],
    ['POST', `/brands/${BRAND}/test`, {}],
    ['DELETE', `/brands/${BRAND}`, undefined],
  ];

  it.each(writes)('%s %s is for admins and managers', async (method, path, body) => {
    h.access.mockResolvedValue({ brand: brand(), role: 'analyst' });
    const res = await send(method, path, body);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden' });
  });

  it.each(writes)('%s %s refuses the demo brand', async (method, path, body) => {
    h.access.mockResolvedValue({ brand: brand({ is_demo: true }), role: 'admin' });
    const res = await send(method, path, body);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'demo_brand' });
  });

  it.each(writes.filter(([method]) => method === 'POST' || method === 'PUT'))(
    '%s %s needs a plan with Slack notifications',
    async (method, path, body) => {
      h.enforce.mockImplementation((PlanLimitError) => {
        throw new PlanLimitError('Your plan does not include it', 403);
      });
      const res = await send(method, path, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'plan_limit', code: 'plan_limit' });
    },
  );

  it('Disconnect works on any plan', async () => {
    h.enforce.mockImplementation((PlanLimitError) => {
      throw new PlanLimitError('Choose a plan', 402);
    });
    const res = await send('DELETE', `/brands/${BRAND}`);
    expect(res.status).toBe(200);
    expect(lib.removeBrandAccount).toHaveBeenCalledWith(
      { brand: brand(), provider: 'slack' },
      expect.objectContaining({ deleteRemote: expect.any(Function) }),
    );
  });
});

describe('POST /api/slack/brands/:brandId/connect and /activate', () => {
  it("starts Slack's install as a pending sign-in of the Account", async () => {
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.test');
    lib.startBrandAccount.mockImplementation(async (input, { initiate }) => {
      await initiate(input.entityId);
      return { redirectUrl: 'https://slack.test/install', accountId: ACCOUNT };
    });
    const res = await send('POST', `/brands/${BRAND}/connect`, {
      callbackUrl: 'https://app.test/dashboard/settings/integrations',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      redirectUrl: 'https://slack.test/install',
      accountId: ACCOUNT,
    });
    expect(lib.startBrandAccount.mock.calls[0][0]).toMatchObject({
      provider: 'slack',
      userId: 'u1',
      entityId: 'org_org-1',
    });
    expect(initiateSlackConnection).toHaveBeenCalledWith(
      'org_org-1',
      'https://app.test/dashboard/settings/integrations',
    );
  });

  it('takes a callback on the app only, and says when the server has no Slack', async () => {
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.test');
    let res = await send('POST', `/brands/${BRAND}/connect`, {
      callbackUrl: 'https://evil.test/x',
    });
    expect(res.status).toBe(400);
    res = await send('POST', `/brands/${BRAND}/connect`, { callbackUrl: 'javascript:1' });
    expect(res.status).toBe(400);
    h.configured.value = false;
    res = await send('POST', `/brands/${BRAND}/connect`, { callbackUrl: 'https://app.test/x' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'not_configured' });
    expect(lib.startBrandAccount).not.toHaveBeenCalled();
  });

  it('names the workspace once the install is done', async () => {
    lib.activateBrandAccount.mockResolvedValue('connected');
    slackLib.readWorkspaceLabel.mockResolvedValue('Acme Test (acme-test.slack.com)');
    const res = await send('POST', `/brands/${BRAND}/activate`, { accountId: ACCOUNT });
    expect(await res.json()).toEqual({ status: 'connected' });
    expect(lib.activateBrandAccount.mock.calls[0][0]).toMatchObject({
      provider: 'slack',
      accountId: ACCOUNT,
      userId: 'u1',
    });
    expect(slackLib.saveWorkspaceLabel).toHaveBeenCalledWith(
      ACCOUNT,
      'Acme Test (acme-test.slack.com)',
    );
  });

  it('is still pending until Composio says so, and a name Slack withholds is left out', async () => {
    lib.activateBrandAccount.mockResolvedValueOnce('pending');
    expect(
      await (await send('POST', `/brands/${BRAND}/activate`, { accountId: ACCOUNT })).json(),
    ).toEqual({
      status: 'pending',
    });
    expect(slackLib.readWorkspaceLabel).not.toHaveBeenCalled();

    lib.activateBrandAccount.mockResolvedValueOnce('connected');
    slackLib.readWorkspaceLabel.mockRejectedValueOnce(new SlackError('missing_scope'));
    const res = await send('POST', `/brands/${BRAND}/activate`, { accountId: ACCOUNT });
    expect(await res.json()).toEqual({ status: 'connected' });
    expect(log.warn).toHaveBeenCalledWith({ code: 'missing_scope' }, 'slack workspace not named');
  });
});

describe('POST /api/slack/brands/:brandId/use', () => {
  it("uses another brand's workspace, for someone who can access every brand that uses it", async () => {
    lib.signInBrandIds.mockResolvedValue([OTHER]);
    const res = await send('POST', `/brands/${BRAND}/use`, { accountId: SHARED });
    expect(res.status).toBe(200);
    expect(h.everyBrand).toHaveBeenCalledWith([OTHER], 'u1');
    expect(lib.useAccountForBrand).toHaveBeenCalledWith(
      { brand: brand(), provider: 'slack', accountId: SHARED, brandIds: [BRAND, OTHER] },
      expect.objectContaining({ deleteRemote: expect.any(Function) }),
    );
  });

  it("refuses a workspace whose connector can't see this brand", async () => {
    h.tables.integration_accounts = [{ connected_by: 'u9' }];
    const res = await send('POST', `/brands/${BRAND}/use`, { accountId: SHARED });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'connector_no_access' });
    expect(lib.useAccountForBrand).not.toHaveBeenCalled();
  });
});

describe('channels', () => {
  it("lists the workspace's channels", async () => {
    slackLib.listChannels.mockResolvedValue([{ ...CHANNEL, members: 12 }]);
    const res = await send('GET', `/brands/${BRAND}/channels`);
    expect(await res.json()).toEqual({ channels: [{ ...CHANNEL, members: 12 }] });
    expect(slackLib.listChannels).toHaveBeenCalledWith(slack());
  });

  it('needs a connected workspace', async () => {
    slackLib.brandSlack.mockResolvedValue(null);
    const res = await send('GET', `/brands/${BRAND}/channels`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'not_connected' });
  });

  it('marks a workspace that refuses the connection, logged by code only', async () => {
    slackLib.listChannels.mockRejectedValue(new SlackError('token_revoked', { status: 200 }));
    const res = await send('GET', `/brands/${BRAND}/channels`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'refused' });
    expect(slackLib.markRefused).toHaveBeenCalledWith(ACCOUNT);
    expect(log.warn).toHaveBeenCalledWith(
      { code: 'token_revoked', status: 200 },
      'slack channels error',
    );
  });

  it('keeps the channel Slack confirms, and what goes to it', async () => {
    slackLib.readChannel.mockResolvedValue({
      id: 'G00000003',
      name: 'northwind-seo',
      private: true,
      archived: false,
    });
    const res = await send('PUT', `/brands/${BRAND}`, {
      channelId: 'G00000003',
      send: { drops: false },
    });
    expect(res.status).toBe(200);
    expect(slackLib.saveSettings).toHaveBeenCalledWith(BRAND, {
      channel: { id: 'G00000003', name: 'northwind-seo', private: true },
      send: { ...ALL_ON, drops: false },
    });
  });

  it('turns a kind off without asking Slack, and clears the channel on null', async () => {
    await send('PUT', `/brands/${BRAND}`, { send: { pulse: false } });
    expect(slackLib.readChannel).not.toHaveBeenCalled();
    expect(slackLib.saveSettings).toHaveBeenLastCalledWith(BRAND, {
      channel: CHANNEL,
      send: { ...ALL_ON, pulse: false },
    });
    await send('PUT', `/brands/${BRAND}`, { channelId: null });
    expect(slackLib.saveSettings).toHaveBeenLastCalledWith(BRAND, { channel: null, send: ALL_ON });
  });

  it('refuses an archived channel, one Slack lost (cleared), and a body that is not one', async () => {
    slackLib.readChannel.mockResolvedValueOnce({ ...CHANNEL, archived: true });
    let res = await send('PUT', `/brands/${BRAND}`, { channelId: 'C00000001' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'channel_gone' });

    // One Slack lost: the brand's channel is cleared, so its card asks for another.
    slackLib.readChannel.mockRejectedValueOnce(new SlackError('channel_not_found'));
    res = await send('PUT', `/brands/${BRAND}`, { channelId: 'C00000001' });
    expect(await res.json()).toMatchObject({ code: 'channel_gone' });
    expect(slackLib.saveSettings).toHaveBeenCalledWith(BRAND, { channel: null, send: ALL_ON });
    slackLib.saveSettings.mockClear();

    for (const body of [{}, { channelId: 'D012345678' }, { send: { pulse: 'yes' } }, { x: 1 }]) {
      expect((await send('PUT', `/brands/${BRAND}`, body)).status).toBe(400);
    }
    expect(slackLib.saveSettings).not.toHaveBeenCalled();
  });
});

describe('POST /api/slack/brands/:brandId/test', () => {
  it('posts the test message to the channel, signed with the sender’s name', async () => {
    slackLib.postConnectedMessage.mockResolvedValue({ channel: 'C00000001', ts: '1.2' });
    const res = await send('POST', `/brands/${BRAND}/test`, {});
    expect(await res.json()).toEqual({ sent: true, channel: CHANNEL });
    expect(slackLib.postConnectedMessage).toHaveBeenCalledWith(slack(), {
      channelId: 'C00000001',
      brand: 'Northwind',
      by: 'Sam Lee',
      // The kinds Ansvisor posts that the brand has on.
      kinds: ['pulse', 'drops', 'suggestion', 'needsYou'],
    });
    slackLib.brandSlack.mockResolvedValue(
      slack({ settings: { channel: CHANNEL, send: { ...ALL_ON, pulse: false } } }),
    );
    await send('POST', `/brands/${BRAND}/test`, {});
    expect(slackLib.postConnectedMessage.mock.calls[1][1].kinds).toEqual([
      'drops',
      'suggestion',
      'needsYou',
    ]);
  });

  it("posts nothing without a channel, or when whoever connected it can't see the brand", async () => {
    slackLib.brandSlack.mockResolvedValueOnce(slack({ settings: { channel: null, send: ALL_ON } }));
    let res = await send('POST', `/brands/${BRAND}/test`, {});
    expect(await res.json()).toMatchObject({ code: 'no_channel' });

    h.readers.mockResolvedValue(new Map());
    res = await send('POST', `/brands/${BRAND}/test`, {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'access_lost' });
    expect(slackLib.postConnectedMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['not_in_channel', 409, 'not_in_channel'],
    ['is_archived', 409, 'channel_gone'],
    ['invalid_auth', 409, 'refused'],
    ['ratelimited', 429, 'rate_limited'],
    ['slack_unavailable', 502, 'failed'],
  ])("answers Slack's %s", async (slackCode, status, code) => {
    slackLib.postConnectedMessage.mockRejectedValue(new SlackError(slackCode));
    const res = await send('POST', `/brands/${BRAND}/test`, {});
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });

  it('clears a channel that is gone, and marks a refused workspace', async () => {
    slackLib.postConnectedMessage.mockRejectedValueOnce(new SlackError('channel_not_found'));
    await send('POST', `/brands/${BRAND}/test`, {});
    expect(slackLib.saveSettings).toHaveBeenCalledWith(BRAND, { channel: null, send: ALL_ON });

    slackLib.postConnectedMessage.mockRejectedValueOnce(new SlackError('account_inactive'));
    await send('POST', `/brands/${BRAND}/test`, {});
    expect(slackLib.markRefused).toHaveBeenCalledWith(ACCOUNT);
  });
});
