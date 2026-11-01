import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The web tells the server the workspace's own key fails, server to server
 * with CRON_SECRET; the body is checked before anything is sent.
 */

const ORG = '22222222-2222-2222-2222-222222222222';
const SINCE = '2026-11-01T09:00:00.000Z';

const notifyOwnKeyFailure = vi.fn();
vi.mock('../lib/chat-notices/own-key.js', () => ({
  notifyOwnKeyFailure: (...args) => notifyOwnKeyFailure(...args),
}));
vi.mock('../lib/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { default: router } = await import('./internal-chat-notices.js');

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', 'shh');
  notifyOwnKeyFailure.mockReset().mockResolvedValue({ notices: 2, emails: 1 });
  const app = express();
  app.use(express.json());
  app.use('/api/internal/chat/notices', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/internal/chat/notices`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const post = (body, secret = 'shh') =>
  fetch(`${baseUrl}/own-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

describe('POST /api/internal/chat/notices/own-key', () => {
  it('answers only the web, with its secret', async () => {
    expect((await post({ orgId: ORG, provider: 'openai', since: SINCE }, 'nope')).status).toBe(401);
    expect(notifyOwnKeyFailure).not.toHaveBeenCalled();
  });

  it('tells the Admins of the episode, and says how many it told', async () => {
    const res = await post({ orgId: ORG, provider: 'openai', since: SINCE, reminder: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, notices: 2, emails: 1 });
    expect(notifyOwnKeyFailure).toHaveBeenCalledWith({
      orgId: ORG,
      provider: 'openai',
      since: SINCE,
      reminder: true,
    });
  });

  it('refuses a body it can’t read, and says so when telling fails', async () => {
    for (const body of [
      { orgId: 'org', provider: 'openai', since: SINCE },
      { orgId: ORG, provider: 'copilot', since: SINCE },
      { orgId: ORG, provider: 'openai', since: 'yesterday' },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(notifyOwnKeyFailure).not.toHaveBeenCalled();
    notifyOwnKeyFailure.mockRejectedValueOnce(new Error('down'));
    expect((await post({ orgId: ORG, provider: 'openai', since: SINCE })).status).toBe(500);
  });
});
