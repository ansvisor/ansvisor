import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePostHog, captureForSessionUser } from './posthog-server';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com/');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('capturePostHog', () => {
  it("posts the event to the project's capture endpoint as the person", async () => {
    await capturePostHog('signed_up', 'u1', { source: 'email' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://eu.i.posthog.com/capture/');
    expect(JSON.parse(init.body)).toMatchObject({
      api_key: 'phc_test',
      event: 'signed_up',
      distinct_id: 'u1',
      properties: { source: 'email', $geoip_disable: true },
    });
  });

  it('sends nothing without a key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    await capturePostHog('signed_up', 'u1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the capture fails', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    await expect(capturePostHog('signed_up', 'u1')).resolves.toBeUndefined();
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
