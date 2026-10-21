import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Cancel Subscription's answers: kept, then e-mailed to the team with replies
 * going to the customer; a few a day per organization.
 */

let profile;
let sentToday;
const inserted = [];
const updated = [];

function table(name) {
  const state = {};
  const result = () => {
    if (name === 'profiles') return { data: profile, error: null };
    if (name === 'organizations')
      return {
        data: {
          name: 'Acme Coffee',
          plan: 'starter',
          subscription_status: 'trialing',
          subscription_ends_at: '2026-10-30T00:00:00Z',
        },
        error: null,
      };
    if (name === 'cancellation_feedback') {
      if (state.insert) return { data: { id: 'f1' }, error: null };
      if (state.update) return { data: null, error: null };
      return { count: sentToday, data: null, error: null };
    }
    return { data: null, error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then')
          return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        if (prop === 'single' || prop === 'maybeSingle') return async () => result();
        if (prop === 'insert')
          return (row) => {
            state.insert = row;
            inserted.push(row);
            return chain;
          };
        if (prop === 'update')
          return (row) => {
            state.update = row;
            updated.push(row);
            return chain;
          };
        return () => chain;
      },
    },
  );
  return chain;
}

const deliverEmail = vi.fn();
vi.mock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../lib/email.js', () => ({ deliverEmail: (...args) => deliverEmail(...args) }));

const { default: router } = await import('./billing.js');

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('CANCEL_FEEDBACK_EMAILS', 'cg@ansvisor.com,support@ansvisor.com');
  profile = { organization_id: 'o1', role: 'admin', full_name: 'Ada' };
  sentToday = 0;
  inserted.length = 0;
  updated.length = 0;
  deliverEmail.mockReset().mockResolvedValue('sent');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1', email: 'ada@acme.example' };
    req.log = { error: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use('/api/billing', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/billing`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const send = (body) =>
  fetch(`${baseUrl}/cancel-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/billing/cancel-feedback', () => {
  it('keeps the answer, then e-mails the team with replies going to the customer', async () => {
    const res = await send({
      reasons: ['no_results'],
      message: 'Not seeing results yet.',
      choice: 'wait',
    });
    expect(res.status).toBe(201);
    expect(inserted).toEqual([
      {
        organization_id: 'o1',
        created_by: 'u1',
        reasons: ['no_results'],
        message: 'Not seeing results yet.',
        choice: 'wait',
        plan: 'starter',
        subscription_status: 'trialing',
      },
    ]);
    expect(deliverEmail).toHaveBeenCalledTimes(1);
    const mail = deliverEmail.mock.calls[0][0];
    expect(mail.to).toEqual(['cg@ansvisor.com', 'support@ansvisor.com']);
    expect(mail.replyTo).toBe('ada@acme.example');
    expect(mail.subject).toBe('Acme Coffee asks us to act within 3 days before cancelling');
    expect(updated).toEqual([{ email_status: 'sent' }]);
  });

  it('still keeps the answer when the e-mail does not go out', async () => {
    deliverEmail.mockResolvedValue('skipped');
    const res = await send({ choice: 'cancel' });
    expect(res.status).toBe(201);
    expect(inserted).toHaveLength(1);
    expect(updated).toEqual([{ email_status: 'skipped' }]);
  });

  it('takes a few answers a day per organization', async () => {
    sentToday = 5;
    const res = await send({ choice: 'cancel' });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('too_many');
    expect(inserted).toHaveLength(0);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('refuses a malformed answer, or a user with no organization', async () => {
    expect((await send({ choice: 'later' })).status).toBe(400);
    profile = { organization_id: null, role: 'admin', full_name: null };
    expect((await send({ choice: 'cancel' })).status).toBe(403);
    expect(inserted).toHaveLength(0);
  });
});
