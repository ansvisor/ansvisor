import { createHmac } from 'node:crypto';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Slack app's Interactivity Request URL (#2139, N7): every request
 * checked on its raw body before anything happens (401 otherwise), a
 * verified click answered at once and handled after, a retry dropped.
 */

vi.mock('../middleware/rate-limiter.js', () => ({
  webhookCallbackAuthFailureLimiter: (_req, _res, next) => next(),
}));
vi.mock('../lib/slack/approvals.js', () => ({
  ACTION_IDS: new Set(['ansvisor_approve', 'ansvisor_reject']),
  handleSlackDecision: vi.fn(),
}));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../lib/logger.js', () => ({ logger, default: logger }));

const { createSlackInteractivityRouter } = await import('./slack-interactivity.js');

const SECRET = 'slack-signing-secret';
const NOW = 1_762_770_000_000;
const TS = String(NOW / 1000);
const CLICK = {
  type: 'block_actions',
  actions: [{ action_id: 'ansvisor_approve', value: 'p:1:d' }],
};
const form = (payload) => `payload=${encodeURIComponent(JSON.stringify(payload))}`;
const sign = (body, ts = TS) =>
  `v0=${createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex')}`;

let server;
let baseUrl;
let handle;

beforeEach(async () => {
  vi.stubEnv('SLACK_SIGNING_SECRET', SECRET);
  handle = vi.fn(async () => 'approved');
  const app = express();
  app.use('/webhooks/slack', express.raw({ type: () => true, limit: '256kb' }));
  // As server.js: the global parsers come after, and skip a body already read.
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/webhooks/slack', createSlackInteractivityRouter({ handle, now: () => NOW }));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const post = (body, headers = {}) =>
  fetch(`${baseUrl}/webhooks/slack/interactivity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
const signed = (body, extra = {}) =>
  post(body, { 'X-Slack-Request-Timestamp': TS, 'X-Slack-Signature': sign(body), ...extra });

describe('POST /webhooks/slack/interactivity', () => {
  it('answers a signed click at once, then handles it', async () => {
    const res = await signed(form(CLICK));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    await vi.waitFor(() => expect(handle).toHaveBeenCalledWith(CLICK));
  });

  it.each([
    ['no signature', (body) => post(body, { 'X-Slack-Request-Timestamp': TS })],
    ['a bad signature', (body) => signed(body, { 'X-Slack-Signature': `v0=${'0'.repeat(64)}` })],
    [
      'a stale timestamp',
      (body) => {
        const ts = String(NOW / 1000 - 301);
        return post(body, { 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': sign(body, ts) });
      },
    ],
    [
      'a replayed body with a changed byte',
      (body) =>
        post(body.replace('approve', 'apprvve'), {
          'X-Slack-Request-Timestamp': TS,
          'X-Slack-Signature': sign(body),
        }),
    ],
  ])('refuses %s with 401, and nothing happens', async (_name, send) => {
    const res = await send(form(CLICK));
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it('refuses everything while no signing secret is set', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', '');
    expect((await signed(form(CLICK))).status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("drops Slack's retry of a click: one decision only", async () => {
    const res = await signed(form(CLICK), { 'X-Slack-Retry-Num': '1' });
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handle).not.toHaveBeenCalled();
  });

  it('answers other interactions and ignores them', async () => {
    const open = { ...CLICK, actions: [{ action_id: 'ansvisor_open' }] };
    expect((await signed(form(open))).status).toBe(200);
    expect((await signed(form({ type: 'view_submission' }))).status).toBe(200);
    expect((await signed('payload=not-json')).status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handle).not.toHaveBeenCalled();
  });
});
