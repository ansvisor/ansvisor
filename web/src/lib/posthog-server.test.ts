import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePostHog, captureForSessionUser } from './posthog-server';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com/');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('capturePostHog', () => {
  it("posts the event to the project's capture endpoint as the person, and says it was accepted", async () => {
    await expect(capturePostHog('signed_up', 'u1', { source: 'email' })).resolves.toEqual({
      result: 'accepted',
      reason: 'accepted',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://eu.i.posthog.com/capture/');
    expect(JSON.parse(init.body)).toMatchObject({
      api_key: 'phc_test',
      event: 'signed_up',
      distinct_id: 'u1',
      properties: { source: 'email', $geoip_disable: true },
    });
  });

  it('sends nothing without a key or an id, and says which', async () => {
    await expect(capturePostHog('signed_up', '')).resolves.toEqual({
      result: 'refused',
      reason: 'no_id',
    });
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    await expect(capturePostHog('signed_up', 'u1')).resolves.toEqual({
      result: 'refused',
      reason: 'no_key',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws: a 4xx is refused; a 5xx, a timeout or a network error is unknown', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(capturePostHog('signed_up', 'u1')).resolves.toEqual({
      result: 'refused',
      reason: 'refused:401',
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 });
    await expect(capturePostHog('signed_up', 'u1')).resolves.toEqual({
      result: 'unknown',
      reason: 'unknown:502',
    });
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(capturePostHog('signed_up', 'u1')).resolves.toEqual({
      result: 'unknown',
      reason: 'unknown:TimeoutError',
    });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(capturePostHog('signed_up', 'u1')).resolves.toEqual({
      result: 'unknown',
      reason: 'unknown:TypeError',
    });
  });

  it('sends nothing to a relative host, a proxy path only the browser can use, and says so', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '/ingest');
    await expect(capturePostHog('signed_up', 'u1')).resolves.toEqual({
      result: 'refused',
      reason: 'bad_host',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('captureForSessionUser', () => {
  it("sends as the session's user id", async () => {
    const supabase = { auth: { getUser: async () => ({ data: { user: { id: 'u7' } } }) } };
    await captureForSessionUser(supabase as never, 'task_completed', { brand_id: 'b1' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).distinct_id).toBe('u7');
  });

  it('never throws when the session cannot be read', async () => {
    const supabase = { auth: { getUser: async () => Promise.reject(new Error('auth down')) } };
    await expect(captureForSessionUser(supabase as never, 'e')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
