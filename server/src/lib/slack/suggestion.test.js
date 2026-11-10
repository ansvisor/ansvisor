import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The daily suggestion in a brand's Slack channel (#2139, N5): one a day for
 * the brand, the action most of its people got, worded by the web as the
 * Action Center words it, through the deliverer; never thrown.
 */

const h = vi.hoisted(() => ({ brand: null, lately: 0, slack: null }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        maybeSingle: async () => ({ data: h.brand, error: null }),
        then: (resolve) =>
          resolve({ count: table === 'slack_posts' ? h.lately : 0, data: null, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('./connection.js', () => ({ brandSlack: async () => h.slack }));
vi.mock('./deliver.js', () => ({ deliverToSlack: vi.fn() }));
vi.mock('../pulse/engine.js', () => ({ appUrl: () => 'https://app.test' }));
vi.mock('../chat-agents.js', () => ({ webAppOrigin: () => 'https://app.test' }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ logger, default: logger }));

const { COOLDOWN_HOURS, actionWords, brandPick, postDailySuggestion } =
  await import('./suggestion.js');

const NOW = new Date('2026-11-10T06:07:00Z');
const ALL_ON = { pulse: true, drops: true, suggestion: true, needsYou: true };
const CHANNEL = { id: 'C00000001', name: 'seo-alerts', private: false };
const action = (id, over = {}) => ({
  id,
  category: 'compete',
  priority_level: 'high',
  ...over,
});
const entry = (id, score, days = 2) => ({
  action: action(id),
  pick: { score, wait: { days, points: days } },
});
const WORDS = {
  title: 'Close the visibility gap with Contoso',
  description: 'Contoso is named in 14 answers where Northwind isn’t.',
};

describe('brandPick', () => {
  it('takes the action most people got, then the higher rank, then the longer wait', () => {
    expect(brandPick([entry('a', 50), entry('b', 90), entry('a', 50)]).action.id).toBe('a');
    expect(brandPick([entry('a', 50), entry('b', 90)]).action.id).toBe('b');
    expect(brandPick([entry('a', 50, 1), entry('b', 50, 9)]).action.id).toBe('b');
    expect(brandPick([])).toBeNull();
  });
});

describe('actionWords', () => {
  it("asks the web for the action's words with the shared secret", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => WORDS }));
    await expect(actionWords('a1', { fetchImpl, env: { CRON_SECRET: 's3cret' } })).resolves.toEqual(
      WORDS,
    );
    expect(fetchImpl).toHaveBeenCalledWith('https://app.test/api/internal/slack/suggestion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer s3cret' },
      body: JSON.stringify({ actionId: 'a1' }),
      signal: expect.any(AbortSignal),
    });
  });

  it('throws without a secret, on a refusal, or without a title', async () => {
    await expect(actionWords('a1', { fetchImpl: vi.fn(), env: {} })).rejects.toThrow('CRON_SECRET');
    let fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));
    await expect(actionWords('a1', { fetchImpl, env: { CRON_SECRET: 's' } })).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ title: '' }) }));
    await expect(actionWords('a1', { fetchImpl, env: { CRON_SECRET: 's' } })).rejects.toThrow();
  });
});

describe('postDailySuggestion', () => {
  let deliver;
  let words;
  const post = (picks = [entry('a1', 80, 5)]) =>
    postDailySuggestion({ orgId: 'org-1', brandId: 'b1', picks, now: NOW }, { deliver, words });

  beforeEach(() => {
    h.brand = { id: 'b1', name: 'Northwind', organization_id: 'org-1', is_demo: false };
    h.lately = 0;
    h.slack = { status: 'connected', settings: { channel: CHANNEL, send: ALL_ON } };
    deliver = vi.fn(async () => ({ status: 'sent', ts: '1.2' }));
    words = vi.fn(async () => WORDS);
    logger.warn.mockClear();
    logger.error.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it('posts the action, in its own words, once a day', async () => {
    await expect(post()).resolves.toEqual({ status: 'sent', ts: '1.2' });
    expect(words).toHaveBeenCalledWith('a1');
    const [input] = deliver.mock.calls[0];
    expect(input).toMatchObject({
      brand: h.brand,
      kind: 'suggestion',
      dedupeKey: 'suggestion:2026-11-10',
    });
    expect(input.message.text).toBe(
      'Today’s suggestion for Northwind: Close the visibility gap with Contoso',
    );
    const blocks = JSON.stringify(input.message.blocks);
    expect(blocks).toContain('High priority · waiting 5 days · Compete');
    expect(blocks).toContain(
      '<https://app.test/dashboard/action-center/actions?action=a1|Open in Action Center>',
    );
    expect(blocks).toContain('Contoso is named in 14 answers where Northwind isn’t.');
  });

  it.each([
    ['no Slack', () => (h.slack = null)],
    ['no channel', () => (h.slack = { ...h.slack, settings: { channel: null, send: ALL_ON } })],
    [
      'the suggestion off',
      () =>
        (h.slack = {
          ...h.slack,
          settings: { channel: CHANNEL, send: { ...ALL_ON, suggestion: false } },
        }),
    ],
    ['one posted in the last 20 hours', () => (h.lately = 1)],
    ['another workspace’s brand', () => (h.brand = { ...h.brand, organization_id: 'org-2' })],
  ])('posts nothing for %s', async (_name, arrange) => {
    arrange();
    await expect(post()).resolves.toMatchObject({ status: 'skipped' });
    expect(deliver).not.toHaveBeenCalled();
    expect(COOLDOWN_HOURS).toBe(20);
  });

  it('posts nothing, to try again next hour, when the web can’t word it', async () => {
    words.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    await expect(post()).resolves.toEqual({ status: 'skipped', reason: 'not_worded' });
    expect(deliver).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { brandId: 'b1', kind: 'suggestion', code: 503 },
      '[slack] suggestion not worded, the next run tries again',
    );
  });

  it('never throws', async () => {
    deliver.mockRejectedValue(new Error('boom'));
    await expect(post()).resolves.toEqual({ status: 'failed', code: 'error' });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
