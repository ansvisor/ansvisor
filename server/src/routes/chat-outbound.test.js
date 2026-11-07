import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The Inbox card's Send and Cancel for an e-mail outside the workspace
 * (W4-28): only Admins and Managers, each a person's own click; the lib's
 * refusals answered with their status and code.
 */

let profile;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: profile, error: null }),
      };
      return chain;
    },
  },
}));
const sendOutsideEmail = vi.fn();
const cancelOutsideEmail = vi.fn();
vi.mock('../lib/chat-outbound-email.js', () => ({
  sendOutsideEmail: (...a) => sendOutsideEmail(...a),
  cancelOutsideEmail: (...a) => cancelOutsideEmail(...a),
}));

const { default: router } = await import('./chat-outbound.js');

const ID = '0b6f8d2e-3c1a-4e5b-9f7d-2a4c6e8b0d1f';
let server;
let baseUrl;

beforeEach(async () => {
  profile = { role: 'manager' };
  sendOutsideEmail.mockReset().mockResolvedValue({ ok: true });
  cancelOutsideEmail.mockReset().mockResolvedValue({ ok: true });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/chat-outbound', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/chat-outbound`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = (path) => fetch(`${baseUrl}/${path}`, { method: 'POST' });

describe('POST /api/chat-outbound/:id/send and /cancel', () => {
  it('sends and cancels as the signed-in Admin or Manager', async () => {
    expect((await post(`${ID}/send`)).status).toBe(200);
    expect(sendOutsideEmail).toHaveBeenCalledWith({ userId: 'u1', id: ID });
    profile = { role: 'admin' };
    expect((await post(`${ID}/cancel`)).status).toBe(200);
    expect(cancelOutsideEmail).toHaveBeenCalledWith({ userId: 'u1', id: ID });
  });

  it('refuses an Analyst and an Agency partner before anything is read', async () => {
    for (const role of ['analyst', 'agency_partner']) {
      profile = { role };
      const res = await post(`${ID}/send`);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'forbidden' });
      expect((await post(`${ID}/cancel`)).status).toBe(403);
    }
    expect(sendOutsideEmail).not.toHaveBeenCalled();
    expect(cancelOutsideEmail).not.toHaveBeenCalled();
  });

  it('answers the lib’s refusals with their status and code', async () => {
    sendOutsideEmail.mockResolvedValueOnce({
      ok: false,
      code: 'daily_limit',
      status: 429,
      message: null,
    });
    const res = await post(`${ID}/send`);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ success: false, code: 'daily_limit' });
    expect((await post('not-an-id/send')).status).toBe(400);
  });
});
