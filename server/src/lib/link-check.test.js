import { describe, expect, it, vi } from 'vitest';

// The real client needs the service key; each test passes its own.
vi.mock('../config/supabase.js', () => ({ default: {} }));

const { PageFetchError } = await import('./safe-fetch.js');
const { CHECK_TTL_MS, MAX_LINKS, checkLinks, linkStatus, pageDate } =
  await import('./link-check.js');

/**
 * A draft's links for Trust (Quality spec §2.2): each read once a day, as
 * working, broken or unknown, with its page's newest date.
 */

const NOW = Date.parse('2026-10-23T12:00:00Z');

/** content_link_checks, as the server reads and writes it. */
function fakeDb(rows = []) {
  const upserts = [];
  const reads = [];
  const db = {
    from: () => {
      const query = { filters: [] };
      const chain = {
        select: () => chain,
        in: (column, values) => {
          query.in = values;
          return chain;
        },
        gte: (column, value) => {
          query.since = value;
          reads.push(query);
          return Promise.resolve({
            data: rows.filter((r) => query.in.includes(r.url) && r.checked_at >= value),
            error: null,
          });
        },
        upsert: async (values) => {
          upserts.push(...values);
          return { error: null };
        },
      };
      return chain;
    },
  };
  return { db, upserts, reads };
}

describe('linkStatus', () => {
  it('reads a page or a file as working', () => {
    expect(linkStatus(null)).toBe('ok');
    expect(linkStatus(new PageFetchError('not_html', 'a PDF'))).toBe('ok');
    expect(linkStatus(new PageFetchError('too_large', 'big'))).toBe('ok');
  });

  it('reads a gone page or a site that is nowhere as broken', () => {
    for (const status of [400, 404, 410, 451]) {
      expect(linkStatus(new PageFetchError('http_error', 'x', { status }))).toBe('broken');
    }
    expect(linkStatus(new PageFetchError('unreachable', 'ENOTFOUND'))).toBe('broken');
    expect(linkStatus(new PageFetchError('too_many_redirects', 'loop'))).toBe('broken');
  });

  it("doesn't call a bot wall, a slow site or a passing error broken", () => {
    for (const status of [401, 403, 429, 500, 503]) {
      expect(linkStatus(new PageFetchError('http_error', 'x', { status }))).toBe('unknown');
    }
    expect(linkStatus(new PageFetchError('timeout', 'slow'))).toBe('unknown');
    expect(linkStatus(new PageFetchError('blocked', 'private'))).toBe('unknown');
    expect(linkStatus(new Error('boom'))).toBe('unknown');
  });
});

describe('pageDate', () => {
  it("takes the page's newest date, from JSON-LD, <time> or article meta", () => {
    const html = `<script type="application/ld+json">{"@type":"Article","datePublished":"2023-01-05","dateModified":"2024-03-01"}</script>
      <meta property="article:published_time" content="2022-07-01">
      <time datetime="2021-02-02">Feb 2021</time>`;
    expect(pageDate(html)).toBe('2024-03-01T00:00:00.000Z');
  });

  it('gives none for a page without a date, and ignores one ahead of today', () => {
    expect(pageDate('<p>No date</p>')).toBeNull();
    expect(pageDate('<time datetime="2999-01-01">Later</time>')).toBeNull();
  });
});

describe('checkLinks', () => {
  it('reads each new link once, in turn, and keeps the reads', async () => {
    const { db, upserts } = fakeDb();
    const fetcher = vi.fn(async (url) => {
      if (url.includes('gone')) throw new PageFetchError('http_error', '404', { status: 404 });
      return { url, status: 200, html: '<time datetime="2025-06-01">June</time>' };
    });
    const links = await checkLinks(
      ['https://a.example/x', 'https://gone.example/', 'https://a.example/x', '/pricing'],
      { db, fetcher, now: NOW },
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(links).toEqual([
      {
        url: 'https://a.example/x',
        status: 'ok',
        httpStatus: 200,
        date: '2025-06-01T00:00:00.000Z',
      },
      { url: 'https://gone.example/', status: 'broken', httpStatus: 404, date: null },
    ]);
    expect(upserts.map((u) => [u.url, u.status, u.checked_at])).toEqual([
      ['https://a.example/x', 'ok', '2026-10-23T12:00:00.000Z'],
      ['https://gone.example/', 'broken', '2026-10-23T12:00:00.000Z'],
    ]);
  });

  it("uses a read from the last day, and reads one that's older again", async () => {
    const { db, reads } = fakeDb([
      {
        url: 'https://fresh.example/',
        status: 'ok',
        http_status: 200,
        page_date: null,
        checked_at: new Date(NOW - 60_000).toISOString(),
      },
      {
        url: 'https://stale.example/',
        status: 'broken',
        http_status: 404,
        page_date: null,
        checked_at: new Date(NOW - CHECK_TTL_MS - 60_000).toISOString(),
      },
    ]);
    const fetcher = vi.fn(async (url) => ({ url, status: 200, html: '' }));
    const links = await checkLinks(['https://fresh.example/', 'https://stale.example/'], {
      db,
      fetcher,
      now: NOW,
    });
    expect(reads[0].since).toBe(new Date(NOW - CHECK_TTL_MS).toISOString());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://stale.example/', expect.any(Object));
    expect(links.map((l) => l.status)).toEqual(['ok', 'ok']);
  });

  it(`reads ${MAX_LINKS} links at most`, async () => {
    const { db } = fakeDb();
    const fetcher = vi.fn(async (url) => ({ url, status: 200, html: '' }));
    const urls = Array.from({ length: MAX_LINKS + 5 }, (_, i) => `https://s${i}.example/`);
    expect(await checkLinks(urls, { db, fetcher, now: NOW })).toHaveLength(MAX_LINKS);
    expect(fetcher).toHaveBeenCalledTimes(MAX_LINKS);
  });

  it('answers even when the reads could not be kept', async () => {
    const { db } = fakeDb();
    db.from = ((from) => () => ({
      ...from(),
      upsert: async () => ({ error: { message: 'read-only' } }),
    }))(db.from);
    const log = { error: vi.fn() };
    const fetcher = async (url) => ({ url, status: 200, html: '' });
    const links = await checkLinks(['https://a.example/'], { db, fetcher, now: NOW, log });
    expect(links[0].status).toBe('ok');
    expect(log.error).toHaveBeenCalled();
  });
});
