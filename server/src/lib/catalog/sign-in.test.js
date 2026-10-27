import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { ConnectorHttpError } from '../../connectors/http.js';
import { fakeDb } from './__fixtures__/fake-db.js';
import { signInRequest, workspaceEntity } from './sign-in.js';

const URL_ = 'https://merchantapi.googleapis.com/products/v1/accounts/1/products';

function setup(answers, { active = async () => ({ id: 'ca_1' }) } = {}) {
  const queue = [...answers];
  const proxy = vi.fn(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const wait = vi.fn(async () => {});
  const request = signInRequest('google-merchant-center', 'org_1', {
    active: vi.fn(active),
    proxy,
    wait,
  });
  return { request, proxy, wait };
}

const answer = (status, headers = {}) => ({
  status,
  headers,
  data: status < 300 ? { ok: true } : null,
});

describe('signInRequest', () => {
  it('calls the API through the active connection, looked up once', async () => {
    const active = vi.fn(async () => ({ id: 'ca_1' }));
    const proxy = vi.fn(async () => answer(200));
    const request = signInRequest('google-merchant-center', 'org_1', { active, proxy });
    await request(URL_, { query: { pageSize: 1000 } });
    await request(URL_);
    expect(active).toHaveBeenCalledTimes(1);
    expect(active).toHaveBeenCalledWith('google-merchant-center', 'org_1');
    expect(proxy).toHaveBeenCalledWith('ca_1', {
      endpoint: URL_,
      query: { pageSize: 1000 },
      signal: undefined,
    });
  });

  it("says the sign-in is gone when there's no active connection, or Google refuses it", async () => {
    await expect(setup([], { active: async () => null }).request(URL_)).rejects.toMatchObject({
      code: 'auth',
    });
    await expect(setup([answer(401)]).request(URL_)).rejects.toMatchObject({
      code: 'auth',
      status: 401,
    });
    await expect(setup([answer(403)]).request(URL_)).rejects.toMatchObject({
      code: 'auth',
      status: 403,
    });
    // Composio refusing an expired account is the same.
    await expect(
      setup([new Error('Connected account is expired')]).request(URL_),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('waits as Retry-After says on a 429, then 1, 2, 4 seconds, and gives up after three', async () => {
    const { request, wait } = setup([
      answer(429, { 'Retry-After': '3' }),
      answer(503),
      answer(200),
    ]);
    await expect(request(URL_)).resolves.toMatchObject({ status: 200 });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([3000, 2000]);

    const stuck = setup([answer(429), answer(429), answer(429), answer(429)]);
    await expect(stuck.request(URL_)).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(stuck.wait).toHaveBeenCalledTimes(3);
  });

  it('names the host and path only, never the query', async () => {
    const err = await setup([answer(400)])
      .request(URL_, { query: { pageToken: 'secret-ish' } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorHttpError);
    expect(err).toMatchObject({ code: 'http_error', status: 400 });
    expect(err.message).toBe(
      'GET merchantapi.googleapis.com/products/v1/accounts/1/products answered 400',
    );
  });

  it("says Composio couldn't be reached, or took too long", async () => {
    await expect(
      setup([], {
        active: async () => {
          throw new Error('ECONNRESET');
        },
      }).request(URL_),
    ).rejects.toMatchObject({ code: 'unreachable' });
    await expect(setup([new Error('socket hang up')]).request(URL_)).rejects.toMatchObject({
      code: 'unreachable',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      setup([new Error('aborted')]).request(URL_, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('workspaceEntity', () => {
  it("is the brand's workspace's Composio entity", async () => {
    const fake = fakeDb();
    fake.rows('brands').push({ id: 'brand-1', organization_id: 'org-9' });
    await expect(workspaceEntity('brand-1', { db: fake.db })).resolves.toBe('org_org-9');
    await expect(workspaceEntity('brand-2', { db: fake.db })).rejects.toThrow();
  });
});
