import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A brand's Slack (#2139): its workspace from the pool, its channel and what
 * goes to it, where it stands, the workspace's channels, and the test message.
 */

const db = vi.hoisted(() => ({ answer: { data: null, error: null }, calls: [] }));
const readers = vi.hoisted(() => ({ map: new Map() }));

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, op: 'select', filters: [], payload: null, columns: null };
      db.calls.push(call);
      const chain = {
        select: (cols) => ((call.columns = cols), chain),
        update: (p) => ((call.op = 'update'), (call.payload = p), chain),
        eq: (col, val) => (call.filters.push([col, val]), chain),
        maybeSingle: async () => db.answer,
        then: (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject),
      };
      return chain;
    },
  },
}));
vi.mock('../access.js', () => ({
  brandReaders: vi.fn(async () => readers.map),
}));
vi.mock('../composio.js', () => ({ proxyRequest: vi.fn() }));

const {
  SEND_KINDS,
  brandSlack,
  listChannels,
  markRefused,
  postConnectedMessage,
  readChannel,
  readWorkspaceLabel,
  saveSettings,
  seesBrand,
  settingsOf,
  stateOf,
  workspaceLabel,
} = await import('./connection.js');
const { slackGet, slackPost } = await import('./api.js');

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/slack-api.json', import.meta.url)));
const CONNECTION = { composioAccountId: 'ca_slack' };
const ALL_ON = { pulse: true, drops: true, suggestion: true, needsYou: true };

/** slackGet / slackPost on a fake proxy answering the fixtures in turn. */
function recorded(...answers) {
  const proxy = vi.fn();
  for (const answer of answers) proxy.mockResolvedValueOnce(answer);
  return {
    proxy,
    get: (connection, method, query) => slackGet(connection, method, query, { proxy }),
    post: (connection, method, body) => slackPost(connection, method, body, { proxy }),
  };
}

beforeEach(() => {
  db.calls = [];
  db.answer = { data: null, error: null };
  readers.map = new Map();
});

describe('settingsOf', () => {
  it('starts with no channel and everything on', () => {
    expect(settingsOf({})).toEqual({ channel: null, send: ALL_ON });
    expect(settingsOf(null)).toEqual({ channel: null, send: ALL_ON });
    expect(SEND_KINDS).toEqual(['pulse', 'drops', 'suggestion', 'needsYou']);
  });

  it('keeps a channel and the kinds turned off, and nothing else', () => {
    expect(
      settingsOf({
        channel: { id: 'C00000001', name: 'seo-alerts', private: false, extra: 1 },
        send: { drops: false, needsYou: 'no', other: false },
        stray: true,
      }),
    ).toEqual({
      channel: { id: 'C00000001', name: 'seo-alerts', private: false },
      send: { ...ALL_ON, drops: false },
    });
  });

  it('drops a channel that is not one', () => {
    expect(settingsOf({ channel: { id: 'D0123456', name: 'dm' } }).channel).toBeNull();
    expect(settingsOf({ channel: { id: 'C00000001' } }).channel).toBeNull();
    expect(settingsOf({ channel: 'C00000001' }).channel).toBeNull();
  });
});

describe('brandSlack', () => {
  it("reads the brand's workspace from the pool, with its choices", async () => {
    db.answer = {
      data: {
        settings: { channel: { id: 'C00000001', name: 'seo-alerts' }, send: { pulse: false } },
        account: {
          id: 'acct-1',
          organization_id: 'org-1',
          composio_entity_id: 'org_org-1',
          composio_account_id: 'ca_slack',
          label: 'Acme Test (acme-test.slack.com)',
          status: 'connected',
          connected_by: 'u1',
          created_at: '2026-11-10T09:00:00Z',
        },
      },
      error: null,
    };
    await expect(brandSlack('b1')).resolves.toEqual({
      accountId: 'acct-1',
      organizationId: 'org-1',
      entityId: 'org_org-1',
      composioAccountId: 'ca_slack',
      label: 'Acme Test (acme-test.slack.com)',
      status: 'connected',
      connectedBy: 'u1',
      connectedAt: '2026-11-10T09:00:00Z',
      settings: {
        channel: { id: 'C00000001', name: 'seo-alerts', private: false },
        send: { ...ALL_ON, pulse: false },
      },
    });
    expect(db.calls[0]).toMatchObject({
      table: 'brand_integrations',
      filters: [
        ['brand_id', 'b1'],
        ['provider', 'slack'],
      ],
    });
  });

  it('is none when the brand uses none, or before 00470', async () => {
    await expect(brandSlack('b1')).resolves.toBeNull();
    db.answer = { data: null, error: { code: '42P01', message: 'missing' } };
    await expect(brandSlack('b1')).resolves.toBeNull();
    db.answer = { data: null, error: { code: 'XX000', message: 'down' } };
    await expect(brandSlack('b1')).rejects.toThrow('down');
  });
});

describe('stateOf and seesBrand', () => {
  const slack = { status: 'connected', connectedBy: 'u1' };

  it('says where the brand stands', () => {
    expect(stateOf(null, false)).toBe('not_connected');
    expect(stateOf({ ...slack, status: 'pending' }, true)).toBe('not_connected');
    expect(stateOf({ ...slack, status: 'auth_failed' }, true)).toBe('refused');
    expect(stateOf(slack, false)).toBe('access_lost');
    expect(stateOf(slack, true)).toBe('connected');
  });

  it('asks whether whoever connected it can still see the brand', async () => {
    const brand = { id: 'b1', organization_id: 'org-1' };
    readers.map = new Map([['u1', new Set(['b1'])]]);
    await expect(seesBrand(brand, 'u1')).resolves.toBe(true);
    await expect(seesBrand(brand, 'u2')).resolves.toBe(false);
    await expect(seesBrand(brand, null)).resolves.toBe(false);
  });
});

describe('the workspace', () => {
  it('is named by auth.test, as "Name (host)"', async () => {
    const { get, proxy } = recorded(FIX['auth.test']);
    await expect(readWorkspaceLabel(CONNECTION, { get })).resolves.toBe(
      'Acme Test (acme-test.slack.com)',
    );
    expect(proxy).toHaveBeenCalledWith('ca_slack', expect.objectContaining({ method: 'GET' }));
    expect(workspaceLabel({ team: 'Acme', url: 'not a url' })).toBe('Acme');
    expect(workspaceLabel({ url: 'https://x.slack.com/' })).toBe('x.slack.com');
    expect(workspaceLabel({})).toBeNull();
  });

  it('lists its channels page by page, by name, without archived ones', async () => {
    const { get, proxy } = recorded(FIX['conversations.list:1'], FIX['conversations.list:2']);
    await expect(listChannels(CONNECTION, { get })).resolves.toEqual([
      { id: 'G00000003', name: 'northwind-seo', private: true, members: 3 },
      { id: 'C00000001', name: 'seo-alerts', private: false, members: 12 },
      { id: 'C00000002', name: 'seo-team', private: false, members: 5 },
    ]);
    expect(proxy).toHaveBeenCalledTimes(2);
    expect(proxy.mock.calls[0][1].query).toEqual({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor: undefined,
    });
    expect(proxy.mock.calls[1][1].query.cursor).toBe('dGVhbTpDMDAwMDAwMDM=');
  });

  it('stops after five pages', async () => {
    const page = FIX['conversations.list:1'];
    const { get, proxy } = recorded(page, page, page, page, page, page);
    await listChannels(CONNECTION, { get });
    expect(proxy).toHaveBeenCalledTimes(5);
  });

  it('reads one channel', async () => {
    const { get } = recorded(FIX['conversations.info']);
    await expect(readChannel(CONNECTION, 'C00000001', { get })).resolves.toEqual({
      id: 'C00000001',
      name: 'seo-alerts',
      private: false,
      archived: false,
    });
  });
});

describe('writes', () => {
  it("keeps the brand's choices made whole", async () => {
    await saveSettings('b1', { channel: { id: 'C00000001', name: 'seo-alerts' }, junk: 1 });
    expect(db.calls[0]).toMatchObject({
      table: 'brand_integrations',
      op: 'update',
      filters: [
        ['brand_id', 'b1'],
        ['provider', 'slack'],
      ],
    });
    expect(db.calls[0].payload.settings).toEqual({
      channel: { id: 'C00000001', name: 'seo-alerts', private: false },
      send: ALL_ON,
    });
  });

  it('marks a refused workspace only while it is connected', async () => {
    await markRefused('acct-1');
    expect(db.calls[0]).toMatchObject({
      table: 'integration_accounts',
      op: 'update',
      filters: [
        ['id', 'acct-1'],
        ['status', 'connected'],
      ],
    });
    expect(db.calls[0].payload.status).toBe('auth_failed');
  });
});

describe('postConnectedMessage', () => {
  it('posts the test message to the channel, links not unfurled', async () => {
    const { post, proxy } = recorded(FIX['chat.postMessage']);
    await expect(
      postConnectedMessage(
        CONNECTION,
        { channelId: 'C00000001', brand: 'Northwind <Ltd>', by: 'Sam Lee' },
        { post },
      ),
    ).resolves.toEqual({ channel: 'C00000001', ts: '1762770000.000100' });
    const { body } = proxy.mock.calls[0][1];
    expect(body).toMatchObject({
      channel: 'C00000001',
      unfurl_links: false,
      unfurl_media: false,
    });
    expect(body.text).toContain('Northwind <Ltd>’s Daily Pulse');
    // Slack's markup characters escaped in the blocks.
    expect(body.blocks[0].text.text).toContain('Northwind &lt;Ltd&gt;’s');
    expect(body.blocks[1].elements[0].text).toBe('Sent by Sam Lee from Settings › Integrations');
  });

  it("says who sent it only when their name is known, and passes Slack's refusal on", async () => {
    const { post, proxy } = recorded(FIX['chat.postMessage'], FIX['error:not_in_channel']);
    await postConnectedMessage(
      CONNECTION,
      { channelId: 'C00000001', brand: 'N', by: null },
      { post },
    );
    expect(proxy.mock.calls[0][1].body.blocks[1].elements[0].text).toBe(
      'Sent from Settings › Integrations',
    );
    await expect(
      postConnectedMessage(CONNECTION, { channelId: 'C00000001', brand: 'N', by: null }, { post }),
    ).rejects.toMatchObject({ code: 'not_in_channel' });
  });
});
