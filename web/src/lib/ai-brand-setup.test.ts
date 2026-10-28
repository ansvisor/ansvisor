import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  }),
}));

const { BRAND_SETUP_LIMITS, generatePromptsFromTopics, suggestCompetitors, suggestTopics } =
  await import('./ai-brand-setup');

/** Setup's suggestion calls send no more than the API takes (#1611 follow-up). */

const fetchMock = vi.fn();
const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ topics: [], topicPrompts: [], competitors: [] }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const long = {
  brandName: 'A'.repeat(250),
  // A description kept on the brand from its settings, longer than setup takes.
  description: `${'d'.repeat(1999)}☕️ and more`,
  website: `${'w'.repeat(250)}.com`,
  language: 'en',
};

describe('the setup suggestion calls', () => {
  it('cut the brand to the lengths the API takes, never half an emoji', async () => {
    await suggestTopics(long);
    const body = sent();
    expect(body.brandName).toHaveLength(BRAND_SETUP_LIMITS.name);
    expect(body.website).toHaveLength(BRAND_SETUP_LIMITS.website);
    expect(body.description).toBe(`${'d'.repeat(1999)}☕`);

    // An emoji past the limit's last unit is left out whole, as the API counts.
    fetchMock.mockClear();
    await suggestTopics({ ...long, description: `${'d'.repeat(1999)}😀` });
    expect(sent().description).toBe('d'.repeat(1999));
  });

  it('leave a short brand and the topics as they are', async () => {
    await generatePromptsFromTopics(
      { brandName: 'Acme', description: 'Coffee', website: 'acme.com', language: 'en' },
      ['coffee subscriptions'],
    );
    expect(sent()).toMatchObject({
      brandName: 'Acme',
      description: 'Coffee',
      topics: ['coffee subscriptions'],
    });
    fetchMock.mockClear();
    await suggestCompetitors({ ...long, region: 'US' });
    expect(sent().description).toHaveLength(BRAND_SETUP_LIMITS.description);
  });
});
