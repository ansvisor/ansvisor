import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Cancel Subscription's answers: kept, then e-mailed to the team with replies
 * going to the customer; a few a day per organization. With PostHog set up,
 * an analysis follows that e-mail in its thread, after the answer.
 */

let profile;
let org;
let sentToday;
let draftRow = null;
const inserted = [];
const updated = [];

function table(name) {
  const state = {};
  const result = () => {
    if (name === 'profiles') return { data: profile, error: null };
    if (name === 'organizations') return { data: org, error: null };
    if (name === 'content_drafts') return { data: draftRow, error: null };
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
const getAiUsage = vi.fn();
const getDraftAiUsage = vi.fn();
const getOrgIdForUser = vi.fn();
const assertBrandAccess = vi.fn();
// The analysis reads PostHog and asks the AI: both stand in here, the rest is real.
const readPersonRows = vi.fn();
vi.mock('../lib/cancel-analysis/posthog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readPersonRows: (...args) => readPersonRows(...args),
}));
const analyseCancel = vi.fn();
vi.mock('../lib/cancel-analysis/ai.js', async (importOriginal) => ({
  ...(await importOriginal()),
  analyseCancel: (...args) => analyseCancel(...args),
}));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => assertBrandAccess(...args),
}));
vi.mock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../lib/email.js', () => ({ deliverEmail: (...args) => deliverEmail(...args) }));
class PlanLimitError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}
vi.mock('../lib/plan-guard.js', () => ({
  PlanLimitError,
  getAiUsage: (...args) => getAiUsage(...args),
  getDraftAiUsage: (...args) => getDraftAiUsage(...args),
  getOrgIdForUser: (...args) => getOrgIdForUser(...args),
}));

const { default: router } = await import('./billing.js');
const { buildCancelFeedbackEmail } = await import('../lib/cancel-feedback.js');

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('CANCEL_FEEDBACK_EMAILS', 'owner@example.com,support@example.com');
  profile = { organization_id: 'o1', role: 'admin', full_name: 'Ada' };
  org = {
    name: 'Acme Coffee',
    plan: 'starter',
    subscription_status: 'trialing',
    // Ten days on: room for the three days and a day to spare.
    subscription_ends_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    stripe_subscription_id: 'sub_1',
  };
  sentToday = 0;
  inserted.length = 0;
  updated.length = 0;
  deliverEmail.mockReset().mockResolvedValue('sent');
  // PostHog not set up, as on a self-hosted install.
  vi.stubEnv('POSTHOG_PERSONAL_API_KEY', '');
  vi.stubEnv('POSTHOG_PROJECT_ID', '');
  vi.stubEnv('RESEND_FROM_EMAIL', 'Ansvisor <hello@mail.example>');
  readPersonRows.mockReset().mockResolvedValue({ ok: false });
  analyseCancel.mockReset().mockResolvedValue({ ok: false });
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

/** A moment for whatever the route left to run after its answer. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

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
    expect(mail.to).toEqual(['owner@example.com', 'support@example.com']);
    expect(mail.replyTo).toBe('ada@acme.example');
    expect(mail.subject).toBe('Acme Coffee asks us to act within 3 days before cancelling');
    expect(updated).toEqual([{ email_status: 'sent' }]);
  });

  it('sends the first e-mail as it was when PostHog isn’t set up, and nothing after it', async () => {
    const res = await send({
      reasons: ['too_expensive'],
      message: 'Too pricey.',
      choice: 'cancel',
    });
    expect(res.status).toBe(201);
    expect(deliverEmail).toHaveBeenCalledTimes(1);
    const { subject, html } = buildCancelFeedbackEmail({
      org,
      user: { name: 'Ada', email: 'ada@acme.example', role: 'admin' },
      feedback: { reasons: ['too_expensive'], message: 'Too pricey.', choice: 'cancel' },
    });
    // Exactly the e-mail and the call there were before the analysis: no headers.
    expect(deliverEmail.mock.calls[0][0]).toEqual({
      to: ['owner@example.com', 'support@example.com'],
      subject,
      html,
      replyTo: 'ada@acme.example',
    });
    await settle();
    expect(readPersonRows).not.toHaveBeenCalled();
    expect(analyseCancel).not.toHaveBeenCalled();
    expect(deliverEmail).toHaveBeenCalledTimes(1);
  });

  describe('with PostHog set up', () => {
    beforeEach(() => {
      vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_test');
      vi.stubEnv('POSTHOG_PROJECT_ID', '12345');
    });

    it('answers first, then follows the e-mail in its thread with the analysis', async () => {
      let release;
      readPersonRows.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      analyseCancel.mockResolvedValue({ ok: true, why: 'Veri az.', fixes: [] });
      const res = await send({ reasons: ['no_results'], choice: 'cancel' });
      // The customer has their answer while PostHog is still being read.
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ok: true });
      expect(deliverEmail).toHaveBeenCalledTimes(1);

      // The first e-mail is the same, with a Message-ID for the follow-up to answer.
      const first = deliverEmail.mock.calls[0][0];
      expect(first.subject).toBe('Acme Coffee cancelled their plan');
      expect(first.replyTo).toBe('ada@acme.example');
      expect(first.headers).toEqual({ 'Message-ID': '<cancel-feedback-f1@mail.example>' });
      expect(first.html).toBe(
        buildCancelFeedbackEmail({
          org,
          user: { name: 'Ada', email: 'ada@acme.example', role: 'admin' },
          feedback: { reasons: ['no_results'], message: '', choice: 'cancel' },
        }).html,
      );

      await vi.waitFor(() => expect(readPersonRows).toHaveBeenCalledWith('u1', undefined));
      release({ ok: false });
      await vi.waitFor(() => expect(deliverEmail).toHaveBeenCalledTimes(2));
      const followUp = deliverEmail.mock.calls[1][0];
      expect(followUp.to).toEqual(['owner@example.com', 'support@example.com']);
      expect(followUp.subject).toBe('Re: Acme Coffee cancelled their plan');
      expect(followUp.headers).toEqual({
        'In-Reply-To': '<cancel-feedback-f1@mail.example>',
        References: '<cancel-feedback-f1@mail.example>',
      });
      expect(followUp).not.toHaveProperty('replyTo');
      expect(followUp.html).toContain('Veri az.');
      // The model got the answer, not who gave it.
      const facts = analyseCancel.mock.calls[0][0];
      expect(facts).toMatchObject({ reasons: ['Not seeing results'], plan: 'starter' });
      expect(JSON.stringify(facts)).not.toMatch(/Acme|Ada|acme\.example/);
      // What is kept is the first e-mail's outcome only.
      expect(updated).toEqual([{ email_status: 'sent' }]);
    });

    it('answers a wait as before, and follows it only when the team was told', async () => {
      const res = await send({ reasons: ['no_results'], choice: 'wait' });
      expect(res.status).toBe(201);
      await vi.waitFor(() => expect(deliverEmail).toHaveBeenCalledTimes(2));
      expect(deliverEmail.mock.calls[1][0].subject).toBe(
        'Re: Acme Coffee asks us to act within 3 days before cancelling',
      );

      for (const status of ['skipped', 'refused']) {
        deliverEmail.mockReset().mockResolvedValue(status);
        readPersonRows.mockClear();
        const refused = await send({ reasons: ['no_results'], choice: 'wait' });
        expect(refused.status).toBe(503);
        expect((await refused.json()).code).toBe('not_sent');
        await settle();
        expect(readPersonRows).not.toHaveBeenCalled();
        expect(deliverEmail).toHaveBeenCalledTimes(1);
      }
    });

    it('lets nothing in the follow-up change the answer or what is kept', async () => {
      analyseCancel.mockRejectedValue(new Error('boom'));
      const res = await send({ choice: 'cancel' });
      expect(res.status).toBe(201);
      await vi.waitFor(() => expect(analyseCancel).toHaveBeenCalled());
      await settle();
      expect(deliverEmail).toHaveBeenCalledTimes(1);
      expect(updated).toEqual([{ email_status: 'sent' }]);

      // A follow-up Resend refuses isn't kept either.
      updated.length = 0;
      analyseCancel.mockResolvedValue({ ok: false });
      deliverEmail.mockResolvedValueOnce('sent').mockResolvedValueOnce('refused');
      expect((await send({ choice: 'cancel' })).status).toBe(201);
      await vi.waitFor(() => expect(deliverEmail).toHaveBeenCalledTimes(3));
      expect(updated).toEqual([{ email_status: 'sent' }]);
    });

    it('reads nothing when the team has no addresses set', async () => {
      vi.stubEnv('CANCEL_FEEDBACK_EMAILS', '');
      deliverEmail.mockResolvedValue('skipped');
      const res = await send({ choice: 'cancel' });
      expect(res.status).toBe(201);
      // As before: the send is skipped for no one to send to, and the answer kept.
      expect(deliverEmail.mock.calls[0][0].to).toEqual([]);
      expect(deliverEmail.mock.calls[0][0]).not.toHaveProperty('headers');
      await settle();
      expect(readPersonRows).not.toHaveBeenCalled();
      expect(analyseCancel).not.toHaveBeenCalled();
      expect(updated).toEqual([{ email_status: 'skipped' }]);
    });
  });

  it('still keeps the answer when the e-mail does not go out', async () => {
    deliverEmail.mockResolvedValue('skipped');
    const res = await send({ choice: 'cancel' });
    expect(res.status).toBe(201);
    expect(inserted).toHaveLength(1);
    expect(updated).toEqual([{ email_status: 'skipped' }]);
  });

  it('says a wait the team was never told about was not sent, and keeps it', async () => {
    // No addresses set, then Resend refusing it.
    for (const status of ['skipped', 'refused']) {
      inserted.length = 0;
      updated.length = 0;
      deliverEmail.mockResolvedValue(status);
      const res = await send({ reasons: ['too_expensive'], choice: 'wait' });
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe('not_sent');
      expect(inserted).toHaveLength(1);
      expect(updated).toEqual([{ email_status: status }]);
    }
    // A send Resend may have made still counts.
    deliverEmail.mockResolvedValue('unknown');
    expect((await send({ reasons: ['too_expensive'], choice: 'wait' })).status).toBe(201);
  });

  it('takes a few answers a day per organization', async () => {
    sentToday = 5;
    const res = await send({ choice: 'cancel' });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('too_many');
    expect(inserted).toHaveLength(0);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('is the admins’: anyone else is refused before anything is kept or sent', async () => {
    for (const role of ['manager', 'analyst', 'agency_partner']) {
      profile = { ...profile, role };
      const res = await send({ choice: 'cancel' });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('admin_only');
    }
    expect(inserted).toHaveLength(0);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('needs a plan to cancel, and time to answer before it renews', async () => {
    org = { ...org, stripe_subscription_id: null };
    let res = await send({ choice: 'cancel' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('no_subscription');

    org = { ...org, stripe_subscription_id: 'sub_1', subscription_status: 'canceled' };
    expect((await send({ choice: 'cancel' })).status).toBe(400);

    // Renewing in three days and a few hours: no day left after the answer.
    org = {
      ...org,
      subscription_status: 'active',
      subscription_ends_at: new Date(Date.now() + 3.2 * 86_400_000).toISOString(),
    };
    res = await send({ choice: 'wait' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('too_late');
    // Cancelling then is still fine.
    expect((await send({ choice: 'cancel' })).status).toBe(201);
    expect(inserted).toHaveLength(1);
  });

  it('lets a wait through when the DB has no period end, or a past one', async () => {
    // A new trial has none until Stripe's first update; a stale one lags it.
    for (const endsAt of [null, new Date(Date.now() - 2 * 86_400_000).toISOString()]) {
      org = { ...org, subscription_ends_at: endsAt };
      expect((await send({ reasons: ['no_results'], choice: 'wait' })).status).toBe(201);
    }
    expect(inserted).toHaveLength(2);
  });

  it('refuses a malformed answer, or a user with no organization', async () => {
    expect((await send({ choice: 'later' })).status).toBe(400);
    profile = { organization_id: null, role: 'admin', full_name: null };
    expect((await send({ choice: 'cancel' })).status).toBe(403);
    expect(inserted).toHaveLength(0);
  });
});

describe('GET /ai-usage', () => {
  it('reads this period’s AI usage for the member’s organization', async () => {
    const usage = { plan: 'starter', unlimited: false, percentUsed: 42.5, features: [] };
    getOrgIdForUser.mockResolvedValue('o1');
    getAiUsage.mockResolvedValue(usage);
    const res = await fetch(`${baseUrl}/ai-usage`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(usage);
    expect(getOrgIdForUser).toHaveBeenCalledWith('u1');
    // With what Write this typically costs, which it turns into a share.
    expect(getAiUsage).toHaveBeenCalledWith('o1', {
      estimates: {
        writeThis: expect.any(Number),
        auditAiChecks: expect.any(Number),
        // The Content Editor's runs, for the Next step window.
        editorBrief: expect.any(Number),
        editorFix: expect.any(Number),
        editorRewrite: expect.any(Number),
        editorWrite: expect.any(Number),
      },
    });
    expect(getAiUsage.mock.calls[0][1].estimates.writeThis).toBeGreaterThan(0);
  });

  it('has no budget to show without an organization (self-hosted)', async () => {
    getOrgIdForUser.mockResolvedValue(null);
    getAiUsage.mockReset();
    const res = await fetch(`${baseUrl}/ai-usage`);
    expect(await res.json()).toMatchObject({ unlimited: true, percentUsed: null, features: [] });
    expect(getAiUsage).not.toHaveBeenCalled();
  });

  it('has no meter for a workspace without an active plan', async () => {
    getOrgIdForUser.mockResolvedValue('o1');
    getAiUsage.mockRejectedValue(new PlanLimitError('Choose a plan', 402));
    const res = await fetch(`${baseUrl}/ai-usage`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'plan_limit' });
  });

  it('says it failed when the usage can’t be read', async () => {
    getOrgIdForUser.mockResolvedValue('o1');
    getAiUsage.mockRejectedValue(new Error('db down'));
    const res = await fetch(`${baseUrl}/ai-usage`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to read AI usage' });
  });
});

describe('GET /ai-usage/draft/:draftId', () => {
  const draftId = 'c0ffee00-0000-4000-8000-000000000001';

  it('reads a page’s share of this period’s AI usage for the member’s organization', async () => {
    getOrgIdForUser.mockResolvedValue('o1');
    getDraftAiUsage.mockResolvedValue({ unlimited: false, percent: 3.7 });
    const res = await fetch(`${baseUrl}/ai-usage/draft/${draftId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unlimited: false, percent: 3.7 });
    expect(getDraftAiUsage).toHaveBeenCalledWith('o1', draftId);
  });

  it('shows a page’s share only to someone who reaches its brand', async () => {
    getOrgIdForUser.mockResolvedValue('o1');
    getDraftAiUsage.mockReset().mockResolvedValue({ unlimited: false, percent: 3.7 });
    draftRow = { brand_id: 'b-hidden' };
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error("You don't have access to this brand"), {
        status: 403,
        code: 'no_brand_access',
      }),
    );
    try {
      let res = await fetch(`${baseUrl}/ai-usage/draft/${draftId}`);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "You don't have access to this brand",
        code: 'no_brand_access',
      });
      expect(assertBrandAccess).toHaveBeenCalledWith('b-hidden', expect.any(String));
      expect(getDraftAiUsage).not.toHaveBeenCalled();

      assertBrandAccess.mockResolvedValueOnce({ orgId: 'o1' });
      res = await fetch(`${baseUrl}/ai-usage/draft/${draftId}`);
      expect(res.status).toBe(200);
      expect(getDraftAiUsage).toHaveBeenCalledWith('o1', draftId);
    } finally {
      draftRow = null;
    }
  });

  it('turns away an id that isn’t one', async () => {
    getDraftAiUsage.mockReset();
    const res = await fetch(`${baseUrl}/ai-usage/draft/not-an-id`);
    expect(res.status).toBe(400);
    expect(getDraftAiUsage).not.toHaveBeenCalled();
  });

  it('has no share to show without an organization (self-hosted)', async () => {
    getOrgIdForUser.mockResolvedValue(null);
    getDraftAiUsage.mockReset();
    const res = await fetch(`${baseUrl}/ai-usage/draft/${draftId}`);
    expect(await res.json()).toEqual({ unlimited: true, percent: null });
    expect(getDraftAiUsage).not.toHaveBeenCalled();
  });

  it('answers plan_limit without an active plan, and says it failed when it can’t read', async () => {
    getOrgIdForUser.mockResolvedValue('o1');
    getDraftAiUsage.mockRejectedValue(new PlanLimitError('Choose a plan', 402));
    let res = await fetch(`${baseUrl}/ai-usage/draft/${draftId}`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'plan_limit' });

    getDraftAiUsage.mockRejectedValue(new Error('db down'));
    res = await fetch(`${baseUrl}/ai-usage/draft/${draftId}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to read AI usage' });
  });
});
