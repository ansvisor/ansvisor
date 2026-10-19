import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/** POST /bots/ingest (AT-010): a connection's secret, then the batch. */

const connectionForSecret = vi.fn();
const ingestBotRequests = vi.fn();
vi.mock('../lib/bot-ingest.js', () => ({
  connectionForSecret: (...a) => connectionForSecret(...a),
  ingestBotRequests: (...a) => ingestBotRequests(...a),
}));
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
  ingestBotRequests.mockReset();
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
  it('ingests a batch for the connection its secret names', async () => {
    const connection = { id: 'c1', brandId: 'b1', organizationId: 'o1' };
    connectionForSecret.mockResolvedValue(connection);
    ingestBotRequests.mockResolvedValue({ received: 1, verified: 1, stored: 1, skipped: {} });
    const res = await post('abot_x', {
      requests: [{ userAgent: 'GPTBot', ip: '1.2.3.4', url: '/' }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 1 });
    expect(connectionForSecret).toHaveBeenCalledWith('abot_x');
    expect(ingestBotRequests).toHaveBeenCalledWith(connection, [
      { userAgent: 'GPTBot', ip: '1.2.3.4', url: '/' },
    ]);
  });

  it('refuses an unknown secret, and an organization without a subscription', async () => {
    connectionForSecret.mockResolvedValue(null);
    expect((await post('abot_bad', { requests: [] })).status).toBe(401);
    expect(ingestBotRequests).not.toHaveBeenCalled();

    connectionForSecret.mockResolvedValue({ id: 'c1' });
    ingestBotRequests.mockRejectedValue(new PlanLimitError('choose a plan', 402));
    expect((await post('abot_x', { requests: [] })).status).toBe(402);
  });
});
