// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A run's write through the API server for its person (apiAs): their own
 * session's token in their own request; otherwise CHAT_ACTING_SECRET with
 * X-Acting-User naming the run's person, never another person's session,
 * and nothing sent while the way is closed. The server's refusals of the
 * way (401, 403 chat_off) come back as the person's words.
 */

const SECRET = 'a'.repeat(64);
const PERSON = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const actor = { userId: PERSON, organizationId: 'org-1' };

const session = vi.hoisted(() => ({
  current: null as { user: { id: string }; access_token: string } | null,
  outsideRequest: false,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (session.outsideRequest) throw new Error('cookies was called outside a request scope');
    return { auth: { getSession: async () => ({ data: { session: session.current } }) } };
  },
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const { ACTING_USER_HEADER, ActingRefusedError, actingOpen, apiAs } = await import('./api');

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const sentHeaders = () => fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>;
const post = () => apiAs(actor, '/api/audits', { method: 'POST', body: { brandId: 'b' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CHAT_ACTING_SECRET', SECRET);
  session.current = null;
  session.outsideRequest = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the acting way', () => {
  it('is open only with a secret as long as the server takes', () => {
    expect(actingOpen()).toBe(true);
    vi.stubEnv('CHAT_ACTING_SECRET', 'a'.repeat(31));
    expect(actingOpen()).toBe(false);
    vi.stubEnv('CHAT_ACTING_SECRET', '');
    expect(actingOpen()).toBe(false);
  });

  it('acts as the run’s person with the secret when no session is behind the request', async () => {
    answer(200, { ok: true });
    expect(await post()).toEqual({ status: 200, ok: true, body: { ok: true } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/audits');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
    expect(JSON.parse(init.body)).toEqual({ brandId: 'b' });
    expect(sentHeaders()).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SECRET}`,
      [ACTING_USER_HEADER]: PERSON,
    });
  });

  it('acts with the secret outside a request too (the minute tick’s background)', async () => {
    session.outsideRequest = true;
    answer(200, {});
    await post();
    expect(sentHeaders()[ACTING_USER_HEADER]).toBe(PERSON);
  });

  it('uses the person’s own session in their own request, and never another person’s', async () => {
    session.current = { user: { id: PERSON }, access_token: 'their-token' };
    answer(200, {});
    await post();
    expect(sentHeaders()).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer their-token',
    });

    // A teammate's Run now picked this run: their cookies are theirs, not the run's person's.
    session.current = { user: { id: OTHER }, access_token: 'teammate-token' };
    answer(200, {});
    await post();
    expect(sentHeaders().Authorization).toBe(`Bearer ${SECRET}`);
    expect(sentHeaders()[ACTING_USER_HEADER]).toBe(PERSON);
  });

  it('sends nothing while the way is closed: the person’s words instead', async () => {
    vi.stubEnv('CHAT_ACTING_SECRET', 'short');
    const err = await post().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActingRefusedError);
    expect((err as InstanceType<typeof ActingRefusedError>).refusal).toMatchObject({
      ok: false,
      reason: 'acting_refused',
      message: expect.stringMatching(/\w/),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the server’s refusals of the way in the person’s words: 401, and Chat off', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    answer(401, { message: 'Unauthorized API Request' });
    await expect(post()).rejects.toMatchObject({ refusal: { reason: 'acting_refused' } });
    answer(403, { code: 'chat_off', message: 'Chat is off for this workspace' });
    await expect(post()).rejects.toMatchObject({ refusal: { reason: 'chat_off' } });
    // Any other refusal is the route's own answer, for the caller to read.
    answer(403, { code: 'no_brand_access' });
    expect(await post()).toEqual({ status: 403, ok: false, body: { code: 'no_brand_access' } });
    // With the person's own session, a 401 is their session's: the caller's to read.
    session.current = { user: { id: PERSON }, access_token: 'their-token' };
    answer(401, {});
    expect(await post()).toMatchObject({ status: 401, ok: false });
    vi.mocked(console.error).mockRestore();
  });

  it('sends no body or content type for a request without one, and reads an empty answer', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    const res = await apiAs(actor, '/api/prompts/suggestions/s-1/dismiss', { method: 'POST' });
    expect(res).toEqual({ status: 200, ok: true, body: {} });
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBeUndefined();
    expect(sentHeaders()['Content-Type']).toBeUndefined();
  });
});
