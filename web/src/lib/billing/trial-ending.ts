import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCloud, PLANS, PLAN_ORDER, type PlanId } from '@/config/plans';
import { firstNameOf } from '@/lib/action-center/first-day';
import { readMemberEmails } from '@/lib/member-emails';
import { sendResendEvent } from '@/lib/resend-event';
import { capturePostHog } from '@/lib/posthog-server';
import type { SendOutcome } from '@/lib/send-outcome';

/**
 * The trial reminder: Stripe's `customer.subscription.trial_will_end`, sent
 * 3 days before a free trial ends, becomes Resend's `trial.ending` event,
 * which starts the trial reminder Automation set up in Resend (like the
 * welcome's `user.signed_up`, lib/signup-event.ts). Cloud only.
 *
 * Only a subscription that, read again from Stripe now, is still trialing,
 * ends its trial later than now, and will be charged then: not one set to
 * cancel at its period end or before the trial ends.
 *
 * To the Stripe customer's e-mail (the person who started the subscription);
 * without one, to the organization's admins.
 *
 * Once per trial, without a table: the reminder is claimed on the Stripe
 * subscription's metadata before it is sent (`trial_reminder_sent_at`, the
 * trial end it was for, a claim id), left to settle and read back, so of two
 * deliveries of the event at once only one sends. After the send
 * (lib/send-outcome.ts): accepted, the claim stays; unknown (a 5xx, a
 * timeout), it stays too, as Resend may have the event and a second e-mail is
 * worse than a missed one. Refused (a 4xx) by kind:
 * - rate limited (429): the claim is released and the webhook answers 500,
 *   so Stripe sends the event again and that try can send it;
 * - any other 4xx (a bad address, a bad request, a bad key): it won't go
 *   through on a retry, so the claim stays, marked
 *   `trial_reminder_outcome: refused`, and the webhook answers 200 (Stripe
 *   would otherwise retry for 3 days). Clearing the `trial_reminder_*`
 *   metadata and resending the event from Stripe sends it again.
 * A trial whose end moves later (staff extended it) is a new trial end and
 * gets its own reminder.
 *
 * Writing the metadata makes Stripe send `customer.subscription.updated`,
 * whose handler rewrites the same plan, status and period end: no change.
 *
 * Every step logs one short `[trial-ending]` line with a reason code and the
 * subscription id, never an e-mail address or a name.
 *
 * Plain module, server only.
 */

/** Resend's event name: the trial reminder Automation starts on it. */
export const TRIAL_ENDING_EVENT = 'trial.ending';

/** Where the plan is changed or canceled: the app's Billing page. */
export const BILLING_PATH = '/dashboard/settings/billing';

// The claim, on the Stripe subscription's metadata.
/** When the reminder was claimed; kept once sent (or maybe sent). */
const SENT_AT_KEY = 'trial_reminder_sent_at';
/** The trial end (Unix seconds) the reminder was for. */
const TRIAL_END_KEY = 'trial_reminder_trial_end';
/** A new id with every claim: the one read back is the one that stayed. */
const CLAIM_ID_KEY = 'trial_reminder_claim';
/** `refused` when Resend refused it for good (a 4xx other than 429); else absent. */
const OUTCOME_KEY = 'trial_reminder_outcome';

/** Resend's answer when it is rate limited: the one 4xx a retry can get past. */
const RATE_LIMITED = 'refused:429';

/**
 * How long a written claim is left before it is read back: two deliveries
 * that read the subscription before either claimed it both write, and the
 * last write stays. One Stripe round trip is well under this.
 */
const CLAIM_SETTLE_MS = 1500;

type StripeClient = Pick<Stripe, 'subscriptions' | 'customers' | 'invoices'>;

/** `retry`: the webhook answers 500 so Stripe sends the event again. */
export type TrialEndingResult = 'done' | 'retry';

type Member = { id: string; full_name: string | null; role: string | null };
type Recipient = { email: string; firstName: string | null };

function log(line: string, level: 'log' | 'warn' | 'error' = 'log'): void {
  console[level](`[trial-ending] ${line}`);
}

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  typeof ref === 'string' ? ref : (ref?.id ?? null);

/** A known paid plan's id and name, or null: never a guessed one. */
function planOf(id: string | null | undefined): { id: PlanId; name: string } | null {
  return id && (PLAN_ORDER as string[]).includes(id)
    ? { id: id as PlanId, name: PLANS[id as PlanId].name }
    : null;
}

/** The trial end as the e-mail says it: "November 20, 2026", in UTC. */
export function humanDateUtc(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Stripe's amount (in the currency's smallest unit) as the e-mail says it:
 * "$49.00". Null for a currency Intl doesn't know.
 */
export function formatAmount(minor: number, currency: string): string | null {
  try {
    const format = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(minor / 10 ** digits);
  } catch {
    return null;
  }
}

/** The app's Billing page, absolute. */
export function billingUrl(): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${appUrl}${BILLING_PATH}`;
}

/**
 * The first charge, from the invoice Stripe will raise when the trial ends:
 * its amount due (tax, discounts and add-ons included) and currency. Null
 * when Stripe can't say: the e-mail then leaves the amount out.
 */
async function firstCharge(
  client: StripeClient,
  subscriptionId: string,
): Promise<{ amount: string; currency: string } | null> {
  try {
    const invoice = await client.invoices.createPreview({ subscription: subscriptionId });
    if (typeof invoice.amount_due !== 'number' || !invoice.currency) {
      log(`amount_unknown:no_amount sub=${subscriptionId}`, 'warn');
      return null;
    }
    const amount = formatAmount(invoice.amount_due, invoice.currency);
    if (!amount) {
      log(`amount_unknown:currency sub=${subscriptionId}`, 'warn');
      return null;
    }
    return { amount, currency: invoice.currency.toUpperCase() };
  } catch (err) {
    // Stripe's error code (e.g. resource_missing), never its message.
    const code = (err as { code?: unknown } | null)?.code;
    log(
      `amount_unknown:${typeof code === 'string' ? code : 'error'} sub=${subscriptionId}`,
      'warn',
    );
    return null;
  }
}

/** Why the subscription gets no reminder, or null when it does. */
function notOwed(sub: Stripe.Subscription, now: number): string | null {
  if (sub.status !== 'trialing') return `not_trialing:${sub.status}`;
  if (!sub.trial_end || sub.trial_end * 1000 <= now) return 'trial_over';
  if (sub.cancel_at_period_end) return 'cancel_at_period_end';
  if (sub.cancel_at && sub.cancel_at <= sub.trial_end) return 'cancels_before_charge';
  const meta = sub.metadata ?? {};
  if (meta[SENT_AT_KEY] && (!meta[TRIAL_END_KEY] || meta[TRIAL_END_KEY] === `${sub.trial_end}`)) {
    return 'already_sent';
  }
  return null;
}

/**
 * The subscription's organization: the one its metadata names, holding its
 * Stripe customer. Throws when it can't be read, so Stripe tries again.
 */
async function readOrganization(
  orgId: string | null,
  customerId: string,
): Promise<{ id: string; name: string; plan: string | null } | null> {
  let query = supabaseAdmin
    .from('organizations')
    .select('id, name, plan')
    .eq('stripe_customer_id', customerId);
  if (orgId) query = query.eq('id', orgId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`organization read failed: ${error.message}`);
  return (data as { id: string; name: string; plan: string | null } | null) ?? null;
}

/** The organization's members, first joined first. Throws when they can't be read. */
async function readMembers(orgId: string): Promise<Member[]> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`members read failed: ${error.message}`);
  return (data as Member[] | null) ?? [];
}

/** The Stripe customer's e-mail and who made it; nothing for a deleted one. */
async function readCustomer(
  client: StripeClient,
  customerId: string,
): Promise<{ email: string | null; userId: string | null }> {
  const customer = await client.customers.retrieve(customerId);
  if ('deleted' in customer && customer.deleted) return { email: null, userId: null };
  const live = customer as Stripe.Customer;
  return { email: live.email ?? null, userId: live.metadata?.supabase_user_id ?? null };
}

async function writeClaim(
  client: StripeClient,
  subscriptionId: string,
  metadata: Record<string, string>,
): Promise<void> {
  await client.subscriptions.update(subscriptionId, { metadata });
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, CLAIM_SETTLE_MS));

/** The outcome of sending to every recipient: refused only if every one was. */
function overall(outcomes: SendOutcome[]): SendOutcome {
  const unknown = outcomes.find((o) => o.result === 'unknown');
  if (unknown) return unknown;
  const accepted = outcomes.find((o) => o.result === 'accepted');
  return accepted ?? outcomes[0];
}

/**
 * Handle one `customer.subscription.trial_will_end`: send the trial reminder
 * once, if the subscription is owed it. Throws when Stripe or the database
 * can't be read before anything is sent (the webhook answers 500 and Stripe
 * tries again); says `retry` when Resend rate limited the event (a 429).
 */
export async function handleTrialWillEnd(
  client: StripeClient,
  subscriptionId: string,
): Promise<TrialEndingResult> {
  const sub$ = `sub=${subscriptionId}`;
  if (!isCloud()) {
    log(`skip: self_hosted ${sub$}`);
    return 'done';
  }
  if (!process.env.RESEND_API_KEY) {
    log(`skip: no_key ${sub$} (RESEND_API_KEY is not set)`, 'warn');
    return 'done';
  }

  // Read again: the event's copy may be days old (a retry), and the claim lives here.
  const sub = await client.subscriptions.retrieve(subscriptionId);
  const skip = notOwed(sub, Date.now());
  if (skip) {
    log(`skip: ${skip} ${sub$}`);
    return 'done';
  }
  const trialEnd = sub.trial_end as number;

  const customerId = idOf(sub.customer);
  const org = customerId
    ? await readOrganization(sub.metadata?.organization_id || null, customerId)
    : null;
  if (!customerId || !org) {
    log(`skip: no_org ${sub$}`);
    return 'done';
  }

  const [customer, members] = await Promise.all([
    readCustomer(client, customerId),
    readMembers(org.id),
  ]);
  const starter = members.find((m) => m.id === customer.userId) ?? null;
  const admins = members.filter((m) => m.role === 'admin');

  let recipients: Recipient[];
  let to: 'customer' | 'admins';
  if (customer.email) {
    to = 'customer';
    recipients = [{ email: customer.email, firstName: firstNameOf(starter?.full_name) }];
  } else {
    to = 'admins';
    const emails = await readMemberEmails(admins.map((a) => a.id));
    recipients = admins.flatMap((a) => {
      const email = emails.get(a.id);
      return email ? [{ email, firstName: firstNameOf(a.full_name) }] : [];
    });
  }
  if (!recipients.length) {
    log(`skip: no_recipient ${sub$}`, 'warn');
    return 'done';
  }

  const plan = planOf(sub.metadata?.plan_id) ?? planOf(org.plan);
  const endsAt = new Date(trialEnd * 1000).toISOString();
  const charge = await firstCharge(client, subscriptionId);
  const shared: Record<string, string> = {
    workspace_name: org.name,
    ...(plan ? { plan_name: plan.name } : {}),
    trial_ends_at: endsAt,
    trial_ends_on: humanDateUtc(endsAt),
    ...(charge ? { amount: charge.amount, currency: charge.currency } : {}),
    manage_url: billingUrl(),
  };

  // Claim, settle, read back: only the delivery whose claim stayed sends.
  const claimId = randomUUID();
  const claim = {
    [SENT_AT_KEY]: new Date().toISOString(),
    [TRIAL_END_KEY]: `${trialEnd}`,
    [CLAIM_ID_KEY]: claimId,
    // A refused mark left from a claim cleared by hand.
    [OUTCOME_KEY]: '',
  };
  await writeClaim(client, subscriptionId, claim);
  await settle();
  let stayed: Record<string, string>;
  try {
    stayed = (await client.subscriptions.retrieve(subscriptionId)).metadata ?? {};
  } catch {
    // Claimed but not confirmed: send nothing. A missed reminder is better than two.
    log(`readback_failed ${sub$} (claim kept)`, 'error');
    return 'done';
  }
  if (stayed[CLAIM_ID_KEY] !== claimId) {
    log(`skip: claimed_elsewhere ${sub$}`, 'warn');
    return 'done';
  }
  log(`claimed: ${to}(${recipients.length}) ${sub$}`);

  const outcomes = await Promise.all(
    recipients.map(({ email, firstName }) =>
      sendResendEvent(TRIAL_ENDING_EVENT, email, {
        ...(firstName ? { first_name: firstName } : {}),
        ...shared,
      }),
    ),
  );
  const outcome = overall(outcomes);
  const refusals = outcomes.filter((o) => o.result === 'refused').map((o) => o.reason);

  // PostHog: as the person who started the subscription, else the first admin.
  const distinctId = starter?.id ?? admins[0]?.id ?? members[0]?.id ?? '';
  const posthog = await capturePostHog('trial_ending_notified', distinctId, {
    organization_id: org.id,
    plan: plan?.id ?? null,
    outcome: outcome.result,
    recipient: to,
    recipient_count: recipients.length,
    has_amount: Boolean(charge),
  });
  if (posthog.result !== 'accepted' && posthog.reason !== 'no_key') {
    log(`posthog_${posthog.reason} ${sub$}`, 'warn');
  }

  // Some admins' sends refused while others went: said with the outcome.
  const also = refusals.length ? ` (refused for ${refusals.length}: ${refusals.join(',')})` : '';
  if (outcome.result === 'accepted') {
    log(`sent: accepted ${sub$}${also}`);
    return 'done';
  }
  if (outcome.result === 'unknown') {
    log(`sent: ${outcome.reason} ${sub$} (marked sent, not retried)${also}`, 'warn');
    return 'done';
  }

  // Refused for everyone. Rate limited: release the claim, so Stripe's next try sends it.
  if (refusals.includes(RATE_LIMITED)) {
    try {
      await writeClaim(client, subscriptionId, {
        [SENT_AT_KEY]: '',
        [TRIAL_END_KEY]: '',
        [CLAIM_ID_KEY]: '',
      });
    } catch {
      log(`resend_${RATE_LIMITED} ${sub$} (release failed, claim kept)`, 'error');
      return 'done';
    }
    log(`resend_${RATE_LIMITED} ${sub$} (released: Stripe sends the event again)`, 'warn');
    return 'retry';
  }
  // Refused for good: kept, marked refused, and Stripe not asked to retry.
  try {
    await writeClaim(client, subscriptionId, { [OUTCOME_KEY]: 'refused' });
  } catch {
    // The claim stays either way: only the mark is missing.
  }
  log(
    `resend_${refusals.join(',')} ${sub$} (claim kept, not retried: clear the trial_reminder_* metadata to resend)`,
    'error',
  );
  return 'done';
}
