import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInsightsData, getMentionsOverview, getTopics } from './visibility-reads';

/** The Visibility tabs' reads from the browser: one POST each, run side by side. */

const BRAND = '33333333-3333-3333-3333-333333333333';
const fetchMock = vi.fn();
const answer = (status: number, body: unknown) => ({ ok: status < 300, json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Visibility reads', () => {
  it('posts the read and its arguments, and returns its data', async () => {
    fetchMock.mockResolvedValue(answer(200, { data: [{ id: 't1', name: 'Espresso' }] }));
    expect(await getTopics(BRAND)).toEqual([{ id: 't1', name: 'Espresso' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/visibility/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: 'topics', args: [BRAND] }),
    });
  });

  it("doesn't wait for one read before sending the next", async () => {
    let release = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(answer(200, { data: 1 })))),
    );
    fetchMock.mockResolvedValueOnce(answer(200, { data: null }));
    const figures = getInsightsData(BRAND, { anchor24h: true });
    const mentions = getMentionsOverview(BRAND, { from: '2026-10-07T00:00:00.000Z' });
    expect(await mentions).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release();
    expect(await figures).toBe(1);
  });

  it('throws when the read failed', async () => {
    fetchMock.mockResolvedValue(answer(500, { error: 'Failed to load' }));
    await expect(getTopics(BRAND)).rejects.toThrow('Failed to load');
  });
});
