import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { describe, expect, it } from 'vitest';
import {
  LogTooLargeError,
  LogUnreadableError,
  MAX_INFLATED_BYTES,
  MAX_LOG_LINES,
  readFastlyBody,
  readJsonLinesBody,
  readLogpushBody,
  readSenderBody,
  readUploadBody,
  readVercelBody,
  readWorkerBody,
} from './bot-log-formats.js';

/** What each AI-bot sender posts (AT-010, spec §6.1), read into one request shape. */

const logpushLine = (over = {}) =>
  JSON.stringify({
    ClientRequestUserAgent: 'Mozilla/5.0; compatible; GPTBot/1.2',
    ClientIP: '20.171.206.9',
    ClientRequestHost: 'acme.example',
    ClientRequestURI: '/menu?x=1',
    EdgeResponseStatus: 200,
    EdgeStartTimestamp: 1792400000000000000,
    ClientCountry: 'us',
    ...over,
  });

describe('readLogpushBody', () => {
  it('reads the http_requests fields, in any timestamp format', async () => {
    const text = [
      logpushLine(),
      logpushLine({ EdgeStartTimestamp: 1792400000 }),
      logpushLine({ EdgeStartTimestamp: '2026-10-19T09:00:00Z' }),
      '{not json',
      '',
    ].join('\n');
    const { records, requests } = await readLogpushBody(text);
    expect(records).toBe(3);
    expect(requests[0]).toEqual({
      userAgent: 'Mozilla/5.0; compatible; GPTBot/1.2',
      ip: '20.171.206.9',
      url: 'https://acme.example/menu?x=1',
      status: 200,
      at: '2026-10-19T08:53:20.000Z',
      country: 'us',
    });
    expect(requests[1].at).toBe('2026-10-19T08:53:20.000Z');
    expect(requests[2].at).toBe('2026-10-19T09:00:00.000Z');
  });

  it("reads Logpush's gzipped test upload as no requests", async () => {
    const parsed = await readSenderBody('cloudflare_logpush', gzipSync('{"content":"tests"}'));
    expect(parsed).toEqual({ records: 1, requests: [] });
  });

  it('opens a gzipped file by its magic bytes', async () => {
    const parsed = await readSenderBody(
      'cloudflare_logpush',
      gzipSync(`${logpushLine()}\n${logpushLine()}`),
    );
    expect(parsed.requests).toHaveLength(2);
  });
});

describe('readVercelBody', () => {
  const entry = (over = {}) => ({
    id: '1',
    source: 'static',
    host: 'acme.vercel.app',
    timestamp: 1792400000000,
    proxy: {
      timestamp: 1792400000500,
      method: 'GET',
      host: 'acme.example',
      path: '/gifts?ref=a',
      userAgent: ['Mozilla/5.0 (compatible; ClaudeBot/1.0)'],
      statusCode: 200,
      clientIp: '160.79.104.10',
      region: 'fra1',
    },
    ...over,
  });

  it('reads the request logs of a JSON array or NDJSON, and skips the rest', async () => {
    const build = { id: '2', source: 'build', message: 'Build completed' };
    const fromArray = await readVercelBody(JSON.stringify([entry(), build]));
    expect(fromArray.records).toBe(2);
    expect(fromArray.requests).toEqual([
      {
        userAgent: 'Mozilla/5.0 (compatible; ClaudeBot/1.0)',
        ip: '160.79.104.10',
        url: 'https://acme.example/gifts?ref=a',
        status: 200,
        at: '2026-10-19T08:53:20.500Z',
        country: null,
      },
    ]);
    const fromLines = await readVercelBody(`${JSON.stringify(entry())}\n${JSON.stringify(build)}`);
    expect(fromLines).toEqual(fromArray);
  });
});

describe('readFastlyBody (#2164)', () => {
  it('reads Fastly JSON lines and arrays into the shared request shape', async () => {
    const lines = fixture('fastly.jsonl');
    const parsed = await readFastlyBody(lines);
    expect(parsed.records).toBe(2);
    expect(parsed.requests).toEqual([
      {
        userAgent: expect.stringContaining('GPTBot/1.2'),
        ip: '20.171.206.9',
        url: 'https://acme.example/pricing?from=fastly',
        status: 200,
        at: new Date(1792400000 * 1000).toISOString(),
        country: 'US',
      },
      {
        userAgent: 'Mozilla/5.0 Chrome/129',
        ip: '203.0.113.9',
        url: 'https://acme.example/about',
        status: 404,
        at: new Date(1792400001 * 1000).toISOString(),
        country: 'GB',
      },
    ]);
    expect(await readFastlyBody(JSON.stringify([JSON.parse(lines.split('\n')[0])]))).toMatchObject({
      records: 1,
      requests: [expect.objectContaining({ ip: '20.171.206.9' })],
    });
    const throughReader = await readSenderBody('fastly_log_stream', Buffer.from(lines));
    expect(throughReader.requests).toHaveLength(2);
  });

  it('drops Fastly records without a readable timestamp', async () => {
    const parsed = await readFastlyBody(JSON.stringify({
      timestamp: 'not-a-time', client_ip: '1.2.3.4',
      request_user_agent: 'GPTBot', url: '/', response_status: 200,
    }));
    expect(parsed).toEqual({ records: 1, requests: [] });
  });
});

describe('readWorkerBody and unknown kinds', () => {
  it("reads a Worker's batch, and nothing from a malformed body or an unknown kind", async () => {
    expect(readWorkerBody('{"requests":[{"ip":"1.1.1.1"}]}')).toEqual({
      records: 1,
      requests: [{ ip: '1.1.1.1' }],
    });
    expect(readWorkerBody('{bad')).toEqual({ records: 0, requests: [] });
    expect(await readSenderBody('ftp', Buffer.from('x'))).toEqual({ records: 0, requests: [] });
    expect(await readSenderBody('vercel_drain', Buffer.alloc(0))).toEqual({
      records: 0,
      requests: [],
    });
  });
});

describe('a large or odd file', () => {
  it("doesn't read a file past its line or size limit", async () => {
    const lines = Array.from({ length: MAX_LOG_LINES + 1 }, () => '{}').join('\n');
    await expect(readLogpushBody(lines)).rejects.toBeInstanceOf(LogTooLargeError);
    // A small gzip that opens past the limit.
    const bomb = gzipSync(Buffer.alloc(MAX_INFLATED_BYTES + 1, 0x20));
    await expect(readSenderBody('cloudflare_logpush', bomb)).rejects.toBeInstanceOf(
      LogTooLargeError,
    );
  });

  it('reads a file at the line limit, a slice at a time', async () => {
    const lines = Array.from({ length: MAX_LOG_LINES }, () => logpushLine()).join('\n');
    const parsed = await readLogpushBody(lines);
    expect(parsed.records).toBe(MAX_LOG_LINES);
    expect(parsed.requests).toHaveLength(MAX_LOG_LINES);
  });

  it('drops a line whose time is unreadable, not the file', async () => {
    const parsed = await readLogpushBody(
      [logpushLine(), logpushLine({ EdgeStartTimestamp: 1e30 })].join('\n'),
    );
    expect(parsed.records).toBe(2);
    expect(parsed.requests).toHaveLength(1);
    const vercel = await readVercelBody(
      JSON.stringify([
        { proxy: { clientIp: '1.2.3.4', userAgent: ['GPTBot'], path: '/', timestamp: 'never' } },
      ]),
    );
    expect(vercel).toEqual({ records: 1, requests: [] });
  });
});

/** A fixture of each format a person can send or upload (#2170). */
const fixture = (name) =>
  readFileSync(new URL(`./__fixtures__/bot-logs/${name}`, import.meta.url), 'utf8');

describe('readJsonLinesBody (a generic webhook, #2170)', () => {
  it('reads the documented fields: a full address, or a host and path, and any time format', async () => {
    const { records, requests } = await readJsonLinesBody(fixture('log-lines.jsonl'));
    expect(records).toBe(3);
    expect(requests).toEqual([
      {
        userAgent: expect.stringContaining('PerplexityBot'),
        ip: '52.6.40.1',
        url: 'https://www.acme.example/pricing',
        status: 200,
        at: '2026-11-04T09:20:00.000Z',
        country: 'us',
      },
      {
        userAgent: expect.stringContaining('ClaudeBot'),
        ip: '160.79.104.10',
        url: 'https://www.acme.example/blog/cold-brew',
        status: 200,
        at: new Date(1793783000 * 1000).toISOString(),
        country: undefined,
      },
      {
        userAgent: 'Mozilla/5.0',
        ip: '203.0.113.9',
        url: '/about',
        status: 301,
        at: new Date(1793783000123).toISOString(),
        country: undefined,
      },
    ]);
  });

  it("is what a log_webhook connection's body reads as", async () => {
    const body = Buffer.from(fixture('log-lines.jsonl'));
    expect((await readSenderBody('log_webhook', body)).requests).toHaveLength(3);
  });
});

describe('readUploadBody (an uploaded access log, #2170)', () => {
  it('reads the combined log format: address, path, status, user agent and time with its offset', async () => {
    const { records, requests } = await readUploadBody(fixture('combined-log.txt'));
    expect(records).toBe(4);
    expect(requests).toEqual([
      {
        userAgent: expect.stringContaining('GPTBot/1.2'),
        ip: '20.171.207.12',
        url: '/blog/cold-brew',
        status: '200',
        at: '2026-11-04T09:15:02.000Z',
        country: null,
      },
      {
        userAgent: expect.stringContaining('Googlebot'),
        ip: '66.249.66.1',
        url: '/pricing',
        status: '200',
        at: '2026-11-04T09:15:40.000Z',
        country: null,
      },
      {
        userAgent: expect.stringContaining('Safari'),
        ip: '198.51.100.7',
        url: '/blog/cold-brew?ref=x',
        status: '304',
        at: '2026-11-04T09:01:09.000Z',
        country: null,
      },
    ]);
  });

  it('counts the common log format, which names no user agent, but finds no bot in it', async () => {
    expect(await readUploadBody(fixture('common-log.txt'))).toEqual({ records: 2, requests: [] });
  });

  it('takes JSON lines too, mixed with log lines, and a gzipped file', async () => {
    const mixed = `${fixture('combined-log.txt')}${fixture('log-lines.jsonl')}`;
    expect((await readUploadBody(mixed)).requests).toHaveLength(6);
    const gzipped = gzipSync(Buffer.from(fixture('combined-log.txt')));
    expect((await readSenderBody('log_upload', gzipped)).requests).toHaveLength(3);
  });

  it('refuses a file with no line it reads, another kind of file, so it is never counted', async () => {
    await expect(readUploadBody('%PDF-1.7\nnot a log\r\n')).rejects.toBeInstanceOf(
      LogUnreadableError,
    );
    // One line in a format it reads is enough: the rest are counted and left out.
    expect((await readUploadBody(`not a log\n${fixture('common-log.txt')}`)).records).toBe(3);
  });

  it('reads Windows line endings', async () => {
    const crlf = fixture('combined-log.txt').replace(/\n/g, '\r\n');
    expect((await readUploadBody(crlf)).requests).toHaveLength(3);
  });

  it('refuses a file past the lines it reads', async () => {
    const line = `${fixture('common-log.txt').split('\n')[0]}\n`;
    await expect(readUploadBody(line.repeat(MAX_LOG_LINES + 1))).rejects.toBeInstanceOf(
      LogTooLargeError,
    );
  });
});
