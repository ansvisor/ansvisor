import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The daily suggestion's words for the API server's Slack post (#2139): its secret, the action, its words. */

const words = vi.fn();
vi.mock('@/lib/slack-action-words', () => ({
  slackActionWords: (...args: unknown[]) => words(...args),
}));

const { POST } = await import('./route');

const ACTION = '11111111-1111-4111-8111-111111111111';
const call = (body: unknown, secret: string | null = 'cron-secret') =>
  POST(
    new Request('http://localhost/api/internal/slack/suggestion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  words.mockReset().mockResolvedValue({ title: 'Recover 7 lost citations', description: 'Why.' });
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/internal/slack/suggestion', () => {
  it("answers the action's words for the server", async () => {
    const res = await call({ actionId: ACTION });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: 'Recover 7 lost citations', description: 'Why.' });
    expect(words).toHaveBeenCalledWith(ACTION);
  });

  it('refuses a call without the secret, or with another', async () => {
    expect((await call({ actionId: ACTION }, null)).status).toBe(401);
    expect((await call({ actionId: ACTION }, 'wrong')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await call({ actionId: ACTION })).status).toBe(401);
    expect(words).not.toHaveBeenCalled();
  });

  it('refuses a body that names no action, and says when the action is gone', async () => {
    expect((await call({ actionId: 'nope' })).status).toBe(422);
    expect((await call({})).status).toBe(422);
    words.mockResolvedValue(null);
    expect((await call({ actionId: ACTION })).status).toBe(404);
  });

  it('says it failed, without the error, when the action can’t be read', async () => {
    words.mockRejectedValue(new Error('Could not read the action: timeout'));
    const res = await call({ actionId: ACTION });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'failed' });
  });
});
