import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Setup suggestions for a workspace that never subscribed are bounded a day
 * (429 `onboarding_daily_limit`): the onboarding steps say so, apart from any
 * other failure, which reads as before.
 */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  }),
}));

const {
  SetupDailyLimitError,
  generatePromptsFromTopics,
  suggestCompetitors,
  suggestFailure,
  suggestTopics,
} = await import('./ai-brand-setup');

const params = { brandName: 'Acme', description: '', website: 'acme.com', language: 'en' };
const answer = (status: number, body: unknown) =>
  vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setup suggestions past the daily limit', () => {
  const limit = { success: false, error: 'rate_limited', code: 'onboarding_daily_limit' };

  it('throws SetupDailyLimitError, read as "dailyLimit", from each of the three calls', async () => {
    vi.stubGlobal('fetch', answer(429, limit));
    const calls = [
      suggestTopics(params),
      generatePromptsFromTopics(params, ['Coffee']),
      suggestCompetitors(params),
    ];
    for (const call of calls) {
      const err = await call.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SetupDailyLimitError);
      expect(suggestFailure(err)).toBe('dailyLimit');
    }
  });

  it('keeps the usual message, so a caller that only shows it says what it said before', async () => {
    vi.stubGlobal('fetch', answer(429, limit));
    await expect(suggestTopics(params)).rejects.toThrow('Failed to suggest topics');
  });

  it('reads any other failure as before: a plain Error, "failed"', async () => {
    for (const [status, body] of [
      [500, { error: 'boom' }],
      [429, { error: 'rate_limited' }],
      [402, { code: 'onboarding_daily_limit' }],
    ] as const) {
      vi.stubGlobal('fetch', answer(status, body));
      const err = await suggestCompetitors(params).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(SetupDailyLimitError);
      expect((err as Error).message).toBe('Failed to suggest competitors');
      expect(suggestFailure(err)).toBe('failed');
    }
  });

  it('returns the suggestions on success', async () => {
    vi.stubGlobal('fetch', answer(200, { topics: [{ name: 'Coffee' }] }));
    await expect(suggestTopics(params)).resolves.toEqual({ topics: ['Coffee'] });
  });
});
