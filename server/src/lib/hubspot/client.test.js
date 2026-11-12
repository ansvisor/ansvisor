import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Calls to HubSpot through Composio's proxy (#2140): only HubSpot's API, the
 * token never here, 429 waited out, a write never sent twice, and refusals
 * named for the card and logged without the body, the query or an id.
 * Answers in the shape HubSpot's API reference documents (__fixtures__),
 * to be replaced with recorded ones at the live test.
 */

const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('../logger.js', () => ({ logger, default: logger }));
vi.mock('../composio.js', () => ({ proxyRequest: vi.fn() }));

const { HUBSPOT_API, HubspotError, hubspotClient, hubspotRequest, pathShape } =
  await import('./client.js');

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));

let proxy;
let waits;
const wait = async (ms) => {
  waits.push(ms);
};
const call = (accountId, request) => hubspotRequest(accountId, request, { proxy, wait });

beforeEach(() => {
  proxy = vi.fn();
  waits = [];
  logger.warn.mockReset();
});

describe('hubspotRequest', () => {
  it("calls HubSpot's API on the account, with the method, query and body", async () => {
    proxy.mockResolvedValueOnce({ status: 200, headers: {}, data: fixture('account-details') });
    const res = await call('ca_1', { path: '/account-info/v3/details' });
    expect(res.data.portalId).toBe(4412893);
    expect(proxy).toHaveBeenCalledWith('ca_1', {
      endpoint: `${HUBSPOT_API}/account-info/v3/details`,
      method: 'GET',
      query: undefined,
      body: undefined,
      signal: undefined,
    });

    proxy.mockResolvedValueOnce({ status: 201, headers: {}, data: fixture('group-created') });
    await call('ca_1', {
      method: 'POST',
      path: '/crm/v3/properties/contacts/groups',
      body: { name: 'ansvisor' },
    });
    expect(proxy).toHaveBeenLastCalledWith(
      'ca_1',
      expect.objectContaining({
        endpoint: `${HUBSPOT_API}/crm/v3/properties/contacts/groups`,
        method: 'POST',
        body: { name: 'ansvisor' },
      }),
    );
  });

  it("calls nothing but HubSpot's API, and nothing without a sign-in", async () => {
    await expect(call('ca_1', { path: '//evil.test/x' })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(call('ca_1', { path: 'https://evil.test/x' })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(call(null, { path: '/account-info/v3/details' })).rejects.toMatchObject({
      code: 'no_sign_in',
    });
    expect(proxy).not.toHaveBeenCalled();
  });

  it('waits out a 429 as Retry-After says, else 1, 2, 4 seconds, whatever the method', async () => {
    proxy
      .mockResolvedValueOnce({ status: 429, headers: { 'Retry-After': '2' }, data: null })
      .mockResolvedValueOnce({ status: 429, headers: {}, data: null })
      .mockResolvedValueOnce({ status: 201, headers: {}, data: {} });
    await call('ca_1', { method: 'POST', path: '/crm/v3/properties/contacts/groups', body: {} });
    expect(waits).toEqual([2000, 2000]);
    expect(proxy).toHaveBeenCalledTimes(3);
  });

  it('stops waiting after three tries, or when asked to wait longer than the call allows', async () => {
    proxy.mockResolvedValue({ status: 429, headers: {}, data: null });
    await expect(call('ca_1', { path: '/account-info/v3/details' })).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
    expect(waits).toEqual([1000, 2000, 4000]);

    waits = [];
    proxy.mockReset().mockResolvedValue({ status: 429, headers: { 'retry-after': '30' } });
    await expect(
      call('ca_1', { path: '/account-info/v3/details', maxWaitMs: 10_000 }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(waits).toEqual([]);
  });

  it('tries a read again on a 5xx, never a write HubSpot may have taken', async () => {
    proxy
      .mockResolvedValueOnce({ status: 502, headers: {}, data: null })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: {} });
    await call('ca_1', { path: '/crm/v3/properties/contacts/groups/ansvisor' });
    expect(proxy).toHaveBeenCalledTimes(2);

    proxy.mockReset().mockResolvedValue({ status: 502, headers: {}, data: null });
    await expect(
      call('ca_1', { method: 'POST', path: '/crm/v3/properties/contacts/batch/create', body: {} }),
    ).rejects.toMatchObject({ code: 'http_error', status: 502 });
    expect(proxy).toHaveBeenCalledOnce();
  });

  it("names HubSpot's refusals, and logs them without the body, the query or an id", async () => {
    const cases = [
      [401, { category: 'INVALID_AUTHENTICATION' }, 'auth'],
      [403, fixture('missing-scopes'), 'scopes'],
      [403, { category: 'FORBIDDEN' }, 'forbidden'],
      [404, fixture('group-not-found'), 'not_found'],
      [409, { category: 'OBJECT_ALREADY_EXISTS' }, 'conflict'],
      [400, { category: 'VALIDATION_ERROR' }, 'invalid'],
      [500, {}, 'http_error'],
    ];
    for (const [status, data, code] of cases) {
      proxy.mockReset().mockResolvedValue({ status, headers: {}, data });
      const err = await call('ca_1', {
        method: 'PATCH',
        path: '/crm/v3/properties/contacts/ansvisor_ai_source',
        query: { secret: 'q-secret' },
        body: { options: ['b-secret'] },
      }).catch((e) => e);
      expect(err, `${status}`).toBeInstanceOf(HubspotError);
      expect(err.code, `${status}`).toBe(code);
      expect(err.message).toBe('PATCH /crm/v3/properties/contacts/:name answered ' + status);
    }
    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).toContain('MISSING_SCOPES');
    expect(logged).not.toMatch(/q-secret|b-secret|ansvisor_ai_source|ca_1/);
  });

  it("reads Composio's own refusals: a sign-in gone, this server refused, or not reached", async () => {
    proxy.mockRejectedValueOnce(new Error('Connected account ca_1 is expired'));
    await expect(call('ca_1', { path: '/account-info/v3/details' })).rejects.toMatchObject({
      code: 'auth',
    });
    proxy.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await expect(call('ca_1', { path: '/account-info/v3/details' })).rejects.toMatchObject({
      code: 'not_set_up',
    });
    proxy.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(call('ca_1', { path: '/account-info/v3/details' })).rejects.toMatchObject({
      code: 'unreachable',
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('ca_1');
  });

  it('stops at once when its signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      call('ca_1', { path: '/account-info/v3/details', signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('hubspotClient', () => {
  it('binds the account and the wait, each call naming its own request', async () => {
    proxy.mockResolvedValue({ status: 429, headers: { 'retry-after': '20' }, data: null });
    const request = hubspotClient('ca_9', { maxWaitMs: 10_000, proxy, wait });
    await expect(request({ path: '/account-info/v3/details' })).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(proxy).toHaveBeenCalledOnce();
    expect(proxy.mock.calls[0][0]).toBe('ca_9');
  });
});

describe('pathShape', () => {
  it('leaves out ids and property names', () => {
    expect(pathShape('/crm/v3/objects/contacts/12345?archived=false')).toBe(
      '/crm/v3/objects/contacts/:id',
    );
    expect(pathShape('/crm/v3/properties/contacts/groups/ansvisor')).toBe(
      '/crm/v3/properties/contacts/groups/:name',
    );
    expect(pathShape('/crm/v3/properties/contacts/batch/read')).toBe(
      '/crm/v3/properties/contacts/batch/read',
    );
  });
});
