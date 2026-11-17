import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * The trial reminder (Stripe's trial_will_end → Resend's trial.ending): who
 * is owed it, what it says, and the claim on the subscription's metadata
 * that keeps it to one per trial.
 */

/** The organization and its members, as the admin client reads them, with the filters used. */
const db = vi.hoisted(() => ({
  org: null as Record<string, unknown> | null,
  members: [] as Record<string, unknown>[],
  orgFilters: [] as [string, unknown][],
  memberFilters: [] as [string, unknown][],
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters = table === 'organizations' ? db.orgFilters : db.memberFilters;
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        order: async () => ({ data: db.members, error: null }),
        maybeSingle: async () => ({ data: db.org, error: null }),
      };
      return chain;
    },
  },
}));

const memberEmails = vi.hoisted(() => vi.fn());
vi.mock('@/lib/member-emails', () => ({ readMemberEmails: memberEmails }));

const sendEvent = vi.hoisted(() => vi.fn());
vi.mock('@/lib/resend-event', () => ({ sendResendEvent: sendEvent }));

const capture = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog-server', () => ({ capturePostHog: capture }));

const { handleTrialWillEnd, TRIAL_ENDING_EVENT, formatAmount } = await import('./trial-ending');

const ACCEPTED = { result: 'accepted', reason: 'accepted' };
const refused = (status: number) => ({ result: 'refused', reason: `refused:${status}` });
const unknown = (what: string | number) => ({ result: 'unknown', reason: `unknown:${what}` });

const NOW = '2026-11-17T10:00:00Z';
/** The trial ends in 3 days. */
const TRIAL_END = Date.parse('2026-11-20T10:00:00Z') / 1000;

/** The Stripe subscription as Stripe holds it now; metadata writes merge, '' removes a key. */
let sub: Record<string, unknown>;
const meta = () => sub.metadata as Record<string, string>;
const stripe = {
  subscriptions: {
    retrieve: vi.fn(async () => structuredClone(sub)),
    update: vi.fn(async (_id: string, { metadata }: { metadata: Record<string, string> }) => {
      const next = { ...meta() };
      for (const [key, value] of Object.entries(metadata)) {
        if (value === '') delete next[key];
        else next[key] = value;
      }
      sub = { ...sub, metadata: next };
      return structuredClone(sub);
    }),
  },
  customers: { retrieve: vi.fn() },
  invoices: { createPreview: vi.fn() },
};
const client = stripe as unknown as Stripe;

/** One delivery of the event, with the claim's wait run through. */
async function deliver() {
  const done = handleTrialWillEnd(client, 'sub_1');
  await vi.runAllTimersAsync();
  return done;
}

const logged = () =>
  [console.log, console.warn, console.error].flatMap((fn) =>
    vi.mocked(fn).mock.calls.map((call) => call.join(' ')),
  );

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/');
  sub = {
    id: 'sub_1',
    status: 'trialing',
    customer: 'cus_1',
    trial_end: TRIAL_END,
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: { organization_id: 'org1', plan_id: 'growth' },
  };
  db.org = { id: 'org1', name: 'Acme Travel', plan: 'growth' };
  db.members = [
    { id: 'u1', full_name: 'Ada Lovelace', role: 'admin' },
    { id: 'u2', full_name: 'Grace Hopper', role: 'admin' },
    { id: 'u3', full_name: 'Alan Turing', role: 'member' },
  ];
  db.orgFilters = [];
  db.memberFilters = [];
  stripe.subscriptions.retrieve.mockClear();
  stripe.subscriptions.update.mockClear();
  stripe.customers.retrieve.mockReset().mockResolvedValue({
    id: 'cus_1',
    email: 'ada@example.com',
    metadata: { supabase_user_id: 'u1' },
  });
  stripe.invoices.createPreview
    .mockReset()
    .mockResolvedValue({ amount_due: 19900, currency: 'usd' });
  memberEmails.mockReset().mockResolvedValue(new Map());
  sendEvent.mockReset().mockResolvedValue(ACCEPTED);
  capture.mockReset().mockResolvedValue(ACCEPTED);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('handleTrialWillEnd', () => {
  it('sends one trial.ending event to the customer, with what the template needs', async () => {
    expect(await deliver()).toBe('done');

    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenCalledWith(TRIAL_ENDING_EVENT, 'ada@example.com', {
      first_name: 'Ada',
      workspace_name: 'Acme Travel',
      plan_name: 'Growth',
      trial_ends_at: '2026-11-20T10:00:00.000Z',
      trial_ends_on: 'November 20, 2026',
      amount: '$199.00',
      currency: 'USD',
      manage_url: 'https://app.example.com/dashboard/settings/billing',
    });
    expect(TRIAL_ENDING_EVENT).toBe('trial.ending');
    // The first charge from the invoice Stripe raises at the trial's end.
    expect(stripe.invoices.createPreview).toHaveBeenCalledWith({ subscription: 'sub_1' });
    // Marked on the subscription: when, and for which trial end.
    expect(meta()).toMatchObject({
      trial_reminder_sent_at: '2026-11-17T10:00:00.000Z',
      trial_reminder_trial_end: `${TRIAL_END}`,
    });
    // Admin reads scoped to the subscription's organization and customer.
    expect(db.orgFilters).toEqual([
      ['stripe_customer_id', 'cus_1'],
      ['id', 'org1'],
    ]);
    expect(db.memberFilters).toEqual([['organization_id', 'org1']]);
    // Never an address in the log.
    expect(logged().join('\n')).not.toContain('@');
    expect(logged()).toContain('[trial-ending] sent: accepted sub=sub_1');
  });

  it('sends PostHog trial_ending_notified as the person who started it, with plan and outcome', async () => {
    await deliver();
    expect(capture).toHaveBeenCalledWith('trial_ending_notified', 'u1', {
      organization_id: 'org1',
      plan: 'growth',
      outcome: 'accepted',
      recipient: 'customer',
      recipient_count: 1,
      has_amount: true,
    });
  });

  it('sends nothing for a subscription set to cancel at its period end', async () => {
    sub.cancel_at_period_end = true;
    expect(await deliver()).toBe('done');
    expect(sendEvent).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(logged()).toContain('[trial-ending] skip: cancel_at_period_end sub=sub_1');
  });

  it('sends nothing for one set to cancel before the trial ends', async () => {
    sub.cancel_at = TRIAL_END;
    await deliver();
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('sends nothing once the subscription is no longer trialing, or its trial is over', async () => {
    for (const status of ['active', 'canceled', 'past_due']) {
      sub.status = status;
      expect(await deliver()).toBe('done');
    }
    // Ended now ("Start my plan now"): Stripe sends trial_will_end then too.
    sub.status = 'trialing';
    sub.trial_end = Date.parse(NOW) / 1000;
    await deliver();
    expect(sendEvent).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('does nothing on a self-hosted install', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await deliver()).toBe('done');
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('does nothing without RESEND_API_KEY, and claims nothing', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    expect(await deliver()).toBe('done');
    expect(sendEvent).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('sends once when Stripe delivers the event again', async () => {
    await deliver();
    expect(await deliver()).toBe('done');
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('[trial-ending] skip: already_sent sub=sub_1');
  });

  it('reads the claim from Stripe now, not from the event’s old copy', async () => {
    await deliver();
    // The event object is never trusted: only the id is passed in.
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
  });

  it('of two deliveries at once, only the one whose claim stayed sends', async () => {
    // Another delivery writes its claim just after this one's.
    stripe.subscriptions.update.mockImplementationOnce(async (_id, { metadata }) => {
      sub = { ...sub, metadata: { ...meta(), ...metadata, trial_reminder_claim: 'other' } };
      return structuredClone(sub);
    });
    expect(await deliver()).toBe('done');
    expect(sendEvent).not.toHaveBeenCalled();
    expect(logged()).toContain('[trial-ending] skip: claimed_elsewhere sub=sub_1');
  });

  it('rate limited (a 429): released, and Stripe told to retry, whose try sends it', async () => {
    sendEvent.mockResolvedValueOnce(refused(429));
    expect(await deliver()).toBe('retry');
    expect(meta()).not.toHaveProperty('trial_reminder_sent_at');
    expect(meta()).not.toHaveProperty('trial_reminder_trial_end');
    expect(meta()).not.toHaveProperty('trial_reminder_claim');
    expect(capture).toHaveBeenCalledWith(
      'trial_ending_notified',
      'u1',
      expect.objectContaining({ outcome: 'refused' }),
    );
    expect(logged()).toContain(
      '[trial-ending] resend_refused:429 sub=sub_1 (released: Stripe sends the event again)',
    );

    expect(await deliver()).toBe('done');
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(meta()).toHaveProperty('trial_reminder_sent_at');
    expect(meta()).not.toHaveProperty('trial_reminder_outcome');
  });

  it('refused for good (another 4xx): kept, marked refused, Stripe not asked to retry', async () => {
    for (const status of [400, 401, 422]) {
      sub.metadata = { organization_id: 'org1', plan_id: 'growth' };
      sendEvent.mockReset().mockResolvedValue(refused(status));
      capture.mockClear();
      vi.mocked(console.error).mockClear();

      expect(await deliver()).toBe('done');
      expect(meta()).toMatchObject({
        trial_reminder_sent_at: expect.any(String),
        trial_reminder_trial_end: `${TRIAL_END}`,
        trial_reminder_outcome: 'refused',
      });
      expect(capture).toHaveBeenCalledWith(
        'trial_ending_notified',
        'u1',
        expect.objectContaining({ outcome: 'refused' }),
      );
      // One line, with the status.
      expect(vi.mocked(console.error).mock.calls.map((c) => c.join(' '))).toEqual([
        `[trial-ending] resend_refused:${status} sub=sub_1 (claim kept, not retried: clear the trial_reminder_* metadata to resend)`,
      ]);

      // Delivered again: no second send.
      expect(await deliver()).toBe('done');
      expect(sendEvent).toHaveBeenCalledTimes(1);
    }
  });

  it('a claim cleared by hand sends again, and drops the old refused mark', async () => {
    sendEvent.mockResolvedValueOnce(refused(422));
    await deliver();
    // Staff clear the claim's keys in Stripe, then resend the event.
    sub.metadata = {
      organization_id: 'org1',
      plan_id: 'growth',
      trial_reminder_outcome: 'refused',
    };
    expect(await deliver()).toBe('done');
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(meta()).not.toHaveProperty('trial_reminder_outcome');
  });

  it('unknown (a 5xx or a timeout): marked sent, never sent again', async () => {
    for (const outcome of [unknown(502), unknown('TimeoutError')]) {
      sub.metadata = { organization_id: 'org1', plan_id: 'growth' };
      sendEvent.mockReset().mockResolvedValue(outcome);
      expect(await deliver()).toBe('done');
      expect(meta()).toHaveProperty('trial_reminder_sent_at');
      expect(await deliver()).toBe('done');
      expect(sendEvent).toHaveBeenCalledTimes(1);
    }
    expect(logged()).toContain(
      '[trial-ending] sent: unknown:TimeoutError sub=sub_1 (marked sent, not retried)',
    );
  });

  it('without a customer e-mail, sends to the organization’s admins, each by name', async () => {
    stripe.customers.retrieve.mockResolvedValue({ id: 'cus_1', email: null, metadata: {} });
    memberEmails.mockResolvedValue(
      new Map([
        ['u1', 'ada@example.com'],
        ['u2', 'grace@example.com'],
      ]),
    );
    expect(await deliver()).toBe('done');

    // Admins only, of this organization.
    expect(memberEmails).toHaveBeenCalledWith(['u1', 'u2']);
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(sendEvent.mock.calls.map(([, email, props]) => [email, props.first_name])).toEqual([
      ['ada@example.com', 'Ada'],
      ['grace@example.com', 'Grace'],
    ]);
    expect(capture).toHaveBeenCalledWith(
      'trial_ending_notified',
      'u1',
      expect.objectContaining({ recipient: 'admins', recipient_count: 2 }),
    );
  });

  it('admins: refused for one but accepted for another is sent, and kept', async () => {
    stripe.customers.retrieve.mockResolvedValue({ id: 'cus_1', email: null, metadata: {} });
    memberEmails.mockResolvedValue(
      new Map([
        ['u1', 'ada@example.com'],
        ['u2', 'grace@example.com'],
      ]),
    );
    sendEvent.mockResolvedValueOnce(refused(429)).mockResolvedValueOnce(ACCEPTED);
    expect(await deliver()).toBe('done');
    expect(meta()).toHaveProperty('trial_reminder_sent_at');
    expect(meta()).not.toHaveProperty('trial_reminder_outcome');
    expect(logged()).toContain(
      '[trial-ending] sent: accepted sub=sub_1 (refused for 1: refused:429)',
    );
  });

  it('a deleted customer goes to the admins too; none with an e-mail sends nothing', async () => {
    stripe.customers.retrieve.mockResolvedValue({ id: 'cus_1', deleted: true });
    expect(await deliver()).toBe('done');
    expect(sendEvent).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(logged()).toContain('[trial-ending] skip: no_recipient sub=sub_1');
  });

  it('leaves the amount out when Stripe can’t say it, never a guess', async () => {
    stripe.invoices.createPreview.mockRejectedValue(
      Object.assign(new Error('No upcoming invoices'), { code: 'invoice_upcoming_none' }),
    );
    await deliver();
    const props = sendEvent.mock.calls[0][2];
    expect(props).not.toHaveProperty('amount');
    expect(props).not.toHaveProperty('currency');
    expect(props.manage_url).toBe('https://app.example.com/dashboard/settings/billing');
    expect(logged()).toContain('[trial-ending] amount_unknown:invoice_upcoming_none sub=sub_1');
  });

  it('leaves the first name out when the person isn’t known, and an unknown plan’s name', async () => {
    stripe.customers.retrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'billing@example.com',
      metadata: {},
    });
    sub.metadata = { organization_id: 'org1', plan_id: 'mystery' };
    db.org = { id: 'org1', name: 'Acme Travel', plan: 'free' };
    await deliver();
    const props = sendEvent.mock.calls[0][2];
    expect(props).not.toHaveProperty('first_name');
    expect(props).not.toHaveProperty('plan_name');
    // PostHog as the first admin, then.
    expect(capture.mock.calls[0][1]).toBe('u1');
  });

  it('sends nothing for a subscription of no organization here', async () => {
    db.org = null;
    expect(await deliver()).toBe('done');
    expect(sendEvent).not.toHaveBeenCalled();
    expect(logged()).toContain('[trial-ending] skip: no_org sub=sub_1');
  });

  it('a trial whose end moved later gets a reminder for the new end', async () => {
    await deliver();
    sub.trial_end = TRIAL_END + 7 * 86_400;
    await deliver();
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(meta().trial_reminder_trial_end).toBe(`${TRIAL_END + 7 * 86_400}`);
  });

  it('throws before sending when Stripe can’t be read, so Stripe tries again', async () => {
    stripe.customers.retrieve.mockRejectedValue(new Error('down'));
    // Before the claim, so no wait to run through.
    await expect(handleTrialWillEnd(client, 'sub_1')).rejects.toThrow('down');
    expect(sendEvent).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe('formatAmount', () => {
  it('reads Stripe’s smallest unit by the currency', () => {
    expect(formatAmount(4900, 'usd')).toBe('$49.00');
    expect(formatAmount(4700, 'eur')).toBe('€47.00');
    expect(formatAmount(5000, 'jpy')).toBe('¥5,000');
    expect(formatAmount(100, 'not-a-currency')).toBeNull();
  });
});
