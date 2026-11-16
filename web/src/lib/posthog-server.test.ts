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
      accepted: true,
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
      accepted: false,
      reason: 'no_id',
    });
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    await expect(capturePostHog('signed_up', 'u1')).resolves.toEqual({
      accepted: false,
      reason: 'no_key',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws, and says a refused or failed capture was not accepted', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(capturePostHog('signed_up', 'u1')).resolves.toEqual({
      accepted: false,
      reason: 'refused:401',
    });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to parse URL from /ingest/capture/'));
    await expect(capturePostHog('signed_up', 'u1')).resolves.toEqual({
      accepted: false,
      reason: 'failed:TypeError',
    });
  });

  it('fails on a relative host, as a proxy path the browser can use would', async () => {
    vi.stubGlobal('fetch', (url: string) => Promise.resolve().then(() => new URL(url)));
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '/ingest');
    await expect(capturePostHog('signed_up', 'u1')).resolves.toEqual({
      accepted: false,
      reason: 'failed:TypeError',
    });
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
