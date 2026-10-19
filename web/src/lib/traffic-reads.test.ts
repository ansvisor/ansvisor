import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBotConnections, getTrafficPages } from './traffic-reads';

/** The AI Traffic page's reads from the browser: one POST each, run side by side. */

const BRAND = '33333333-3333-3333-3333-333333333333';
const WEEK = { dateFrom: '2026-10-12T00:00:00.000Z', dateTo: '2026-10-19T00:00:00.000Z' };
const fetchMock = vi.fn();
const answer = (status: number, body: unknown) => ({ ok: status < 300, json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('traffic reads', () => {
  it('posts the read and its arguments, and returns its data', async () => {
    fetchMock.mockResolvedValue(answer(200, { data: { counts: { all: 3 }, rows: [] } }));
    expect(await getTrafficPages(BRAND, WEEK, { tab: 'all', limit: 10 })).toEqual({
      counts: { all: 3 },
      rows: [],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/traffic/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: 'pages', args: [BRAND, WEEK, { tab: 'all', limit: 10 }] }),
    });
  });

  it("doesn't wait for one read before sending the next", async () => {
    let release = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(answer(200, { data: 1 })))),
    );
    fetchMock.mockResolvedValueOnce(answer(200, { data: { connections: [] } }));
    const first = getTrafficPages(BRAND, WEEK, { tab: 'all' });
    const second = getBotConnections(BRAND);
    expect(await second).toEqual({ connections: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release();
    expect(await first).toBe(1);
  });

  it('throws when the read failed', async () => {
    fetchMock.mockResolvedValue(answer(500, { error: 'Failed to load' }));
    await expect(getTrafficPages(BRAND, WEEK, { tab: 'all' })).rejects.toThrow('Failed to load');
  });
});
