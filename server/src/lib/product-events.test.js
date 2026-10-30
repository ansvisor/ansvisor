import { describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { logger } = await import('./logger.js');
const { captureProductEvents } = await import('./product-events.js');

/** Product events the server sends itself: PostHog's batch endpoint, only with a key. */

const event = (n) => ({
  event: 'daily_suggestion_sent',
  distinctId: `user-${n}`,
  timestamp: '2026-10-30T09:30:00.000Z',
  properties: { brand_id: 'b1' },
});

describe('captureProductEvents', () => {
  it('sends nothing without a key, as a self-hosted install has none', async () => {
    const fetcher = vi.fn();
    expect(await captureProductEvents([event(1)], { key: '', fetcher })).toBe(0);
    expect(await captureProductEvents([event(1)], { key: undefined, fetcher })).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends a batch to the host, the person as the distinct id', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    const sent = await captureProductEvents([event(1), event(2)], {
      key: 'phc_test',
      host: 'https://eu.i.posthog.com/',
      fetcher,
    });
    expect(sent).toBe(2);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://eu.i.posthog.com/batch/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      api_key: 'phc_test',
      batch: [1, 2].map((n) => ({
        event: 'daily_suggestion_sent',
        distinct_id: `user-${n}`,
        properties: { brand_id: 'b1', distinct_id: `user-${n}`, $lib: 'ansvisor-server' },
        timestamp: '2026-10-30T09:30:00.000Z',
      })),
    });
  });

  it('uses the US cloud when no host is set, and sends nothing for no events', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await captureProductEvents([], { key: 'phc_test', fetcher })).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    await captureProductEvents([event(1)], { key: 'phc_test', host: '', fetcher });
    expect(fetcher.mock.calls[0][0]).toBe('https://us.i.posthog.com/batch/');
  });

  it('never throws: a refused or failed send is logged by count and dropped', async () => {
    const refused = vi.fn(async () => ({ ok: false, status: 401 }));
    expect(await captureProductEvents([event(1)], { key: 'k', fetcher: refused })).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      { status: 401, events: 1 },
      '[product-events] not sent',
    );

    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await captureProductEvents([event(1)], { key: 'k', fetcher: down })).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: { name: 'TypeError' }, events: 1 },
      '[product-events] not sent',
    );
  });
});
