import { gzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /bots/ingest (AT-010): a connection's secret, then its body read by
 * kind — a Worker's batch, a Vercel drain's entries or a Logpush file — with
 * log senders' records counted against the raw cap first.
 */

const connectionForSecret = vi.fn();
const ingestBotRequests = vi.fn();
const countRawRecords = vi.fn();
const claimLogFile = vi.fn();
const releaseLogFile = vi.fn();
vi.mock('../lib/bot-ingest.js', () => ({
  MAX_BATCH: 500,
  connectionForSecret: (...a) => connectionForSecret(...a),
  ingestBotRequests: (...a) => ingestBotRequests(...a),
  countRawRecords: (...a) => countRawRecords(...a),
  claimLogFile: (...a) => claimLogFile(...a),
  releaseLogFile: (...a) => releaseLogFile(...a),
}));
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/plan-guard.js', () => ({
  PlanLimitError: class PlanLimitError extends Error {
    constructor(message, statusCode = 403) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

const { default: router } = await import('./bot-ingest.js');
const { PlanLimitError } = await import('../lib/plan-guard.js');

let server;
let url;

beforeEach(async () => {
  connectionForSecret.mockReset();
  ingestBotRequests
    .mockReset()
    .mockResolvedValue({ received: 0, verified: 0, stored: 0, skipped: {} });
  countRawRecords.mockReset().mockResolvedValue({ allowed: true });
  claimLogFile.mockReset().mockResolvedValue('hash-1');
  releaseLogFile.mockReset().mockResolvedValue(undefined);
  const app = express();
  app.use(router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  url = `http://127.0.0.1:${server.address().port}/bots/ingest`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = (secret, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

describe('POST /bots/ingest', () => {
  it("ingests a Worker's batch for the connection its secret names", async () => {
    const connection = { id: 'c1', organizationId: 'o1', kind: 'cloudflare_worker' };
    connectionForSecret.mockResolvedValue(connection);
    ingestBotRequests.mockResolvedValue({ received: 1, verified: 1, stored: 1, skipped: {} });
    const res = await post('abot_x', {
      requests: [{ userAgent: 'GPTBot', ip: '1.2.3.4', url: '/' }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 1, records: 1 });
    expect(connectionForSecret).toHaveBeenCalledWith('abot_x');
    expect(ingestBotRequests).toHaveBeenCalledWith(
      connection,
      [{ userAgent: 'GPTBot', ip: '1.2.3.4', url: '/' }],
      { limit: 500 },
    );
    expect(countRawRecords).not.toHaveBeenCalled();
  });

  it("reads a Vercel drain's entries after counting them against the raw cap", async () => {
    const connection = { id: 'c2', organizationId: 'o1', kind: 'vercel_drain' };
    connectionForSecret.mockResolvedValue(connection);
    const entries = [
      {
        proxy: {
          clientIp: '1.2.3.4',
          userAgent: ['GPTBot'],
          host: 'acme.example',
          path: '/',
          statusCode: 200,
          timestamp: 1792400000000,
        },
      },
      { source: 'build', message: 'done' },
    ];
    const res = await post('abot_x', entries);
    expect(res.status).toBe(200);
    expect((await res.json()).records).toBe(2);
    expect(countRawRecords).toHaveBeenCalledWith(connection, 2);
    expect(ingestBotRequests.mock.calls[0][1]).toHaveLength(1);
    expect(ingestBotRequests.mock.calls[0][2]).toEqual({ limit: Infinity });

    countRawRecords.mockResolvedValue({ allowed: false });
    ingestBotRequests.mockClear();
    const capped = await post('abot_x', entries);
    expect(await capped.json()).toMatchObject({ received: 2, stored: 0, rawCapped: true });
    expect(ingestBotRequests).not.toHaveBeenCalled();

    countRawRecords.mockResolvedValue({ allowed: false, locked: true });
    expect(await (await post('abot_x', entries)).json()).toMatchObject({ locked: true });
  });

  it("opens a Logpush job's gzipped file, and refuses an unreadable one", async () => {
    connectionForSecret.mockResolvedValue({
      id: 'c3',
      organizationId: 'o1',
      kind: 'cloudflare_logpush',
    });
    const ok = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer abot_x' },
      body: gzipSync('{"content":"tests"}'),
    });
    expect(ok.status).toBe(200);
    expect(countRawRecords).toHaveBeenCalledWith(expect.objectContaining({ id: 'c3' }), 1);

    const bad = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer abot_x' },
      body: Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02]),
    });
    expect(bad.status).toBe(400);
  });

  it('reads a log file once: a resent one is answered without reading it', async () => {
    const connection = { id: 'c2', organizationId: 'o1', kind: 'vercel_drain' };
    connectionForSecret.mockResolvedValue(connection);
    const entries = [{ source: 'build', message: 'done' }];
    expect((await post('abot_x', entries)).status).toBe(200);
    expect(claimLogFile).toHaveBeenCalledWith(connection, expect.any(Buffer));
    expect(releaseLogFile).not.toHaveBeenCalled();

    claimLogFile.mockResolvedValue(null);
    countRawRecords.mockClear();
    const again = await post('abot_x', entries);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true, stored: 0 });
    expect(countRawRecords).not.toHaveBeenCalled();
  });

  it('gives the claim back when the read fails, so the retry is read', async () => {
    const connection = { id: 'c2', organizationId: 'o1', kind: 'vercel_drain' };
    connectionForSecret.mockResolvedValue(connection);
    ingestBotRequests.mockRejectedValue(new Error('database down'));
    const entries = [
      {
        proxy: {
          clientIp: '1.2.3.4',
          userAgent: ['GPTBot'],
          host: 'acme.example',
          path: '/',
          statusCode: 200,
          timestamp: 1792400000000,
        },
      },
    ];
    expect((await post('abot_x', entries)).status).toBe(500);
    expect(releaseLogFile).toHaveBeenCalledWith(connection, 'hash-1');
  });

  it('answers 413 for a file past the line limit, without reading it', async () => {
    connectionForSecret.mockResolvedValue({
      id: 'c3',
      organizationId: 'o1',
      kind: 'cloudflare_logpush',
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer abot_x' },
      body: gzipSync(Array.from({ length: 20_001 }, () => '{}').join('\n')),
    });
    expect(res.status).toBe(413);
    expect(countRawRecords).not.toHaveBeenCalled();
    expect(releaseLogFile).toHaveBeenCalled();
  });

  it('refuses an unknown secret, and an organization without a subscription', async () => {
    connectionForSecret.mockResolvedValue(null);
    expect((await post('abot_bad', { requests: [] })).status).toBe(401);
    expect(ingestBotRequests).not.toHaveBeenCalled();

    connectionForSecret.mockResolvedValue({ id: 'c1', kind: 'cloudflare_worker' });
    ingestBotRequests.mockRejectedValue(new PlanLimitError('choose a plan', 402));
    expect((await post('abot_x', { requests: [] })).status).toBe(402);
  });
});
