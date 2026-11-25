import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { chatGptSyncer } = await import('./chatgpt-sync.js');
const { AdsSyncError } = await import('./sync.js');

/**
 * ChatGPT Ads' part of the daily sync (C3): each window read with the
 * account's own key, the key opened once per account.
 */

const KEY = 'sk-ads-0123456789abcdefghij';
const WINDOW = { since: '2026-11-15', until: '2026-11-21' };

function fakeFetch(handler) {
  return vi.fn(async (url) => {
    const { status = 200, body } = handler(new URL(url));
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  });
}

const okFetch = () =>
  fakeFetch((url) =>
    url.pathname.endsWith('/campaigns')
      ? { body: { data: [{ id: 'cmpn_1', status: 'paused' }], has_more: false } }
      : {
          body: {
            data: [
              {
                campaign_id: 'cmpn_1',
                campaign_name: 'Spring',
                readable_time: '2026-11-20',
                impressions: 1200,
                clicks: 36,
                spend: 18.42,
              },
            ],
            has_more: false,
          },
        },
  );

describe('chatGptSyncer', () => {
  it('writes each campaign day with its status, reading the key and campaigns once', async () => {
    const fetchImpl = okFetch();
    const readKey = vi.fn(async () => KEY);
    const sync = chatGptSyncer({ readKey, fetchImpl });
    const account = { id: 'acc' };
    const writeDays = vi.fn(async () => {});
    await sync({ account, window: WINDOW, writeDays });
    await sync({ account, window: WINDOW, writeDays });
    expect(readKey).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.filter(([u]) => u.includes('/campaigns'))).toHaveLength(1);
    expect(writeDays.mock.calls[0][0]).toEqual([
      {
        campaignId: 'cmpn_1',
        campaignName: 'Spring',
        campaignStatus: 'paused',
        day: '2026-11-20',
        impressions: 1200,
        clicks: 36,
        costMicros: 18_420_000,
      },
    ]);
  });

  it("marks the account 'disconnected' when it has no key", async () => {
    const sync = chatGptSyncer({ readKey: async () => null, fetchImpl: okFetch() });
    await expect(
      sync({ account: { id: 'acc' }, window: WINDOW, writeDays: vi.fn() }),
    ).rejects.toMatchObject({ name: 'AdsSyncError', code: 'key_missing', status: 'disconnected' });
  });

  it('turns a refused key or an outage into a code the card words', async () => {
    for (const [status, code] of [
      [401, 'key_refused'],
      [503, 'upstream'],
    ]) {
      const sync = chatGptSyncer({
        readKey: async () => KEY,
        fetchImpl: fakeFetch(() => ({ status, body: {} })),
      });
      const err = await sync({ account: { id: 'acc' }, window: WINDOW, writeDays: vi.fn() }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(AdsSyncError);
      expect(err.status).toBe('error');
      expect(err.code).toBe(code);
      expect(err.message).not.toContain(KEY);
    }
  });
});
