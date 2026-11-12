import { track } from '@/lib/analytics';
import type { CancelReason } from './cancel-feedback';

/**
 * The cancel flow's product events, sent to PostHog through lib/analytics
 * (nothing is sent self-hosted). PostHog finds who cancelled by
 * `subscription_canceled`; what they did before is the same person's page
 * views, heatmap and replays. The events carry the reasons ticked and
 * whether a message was written, never the message itself.
 */
export const CANCEL_EVENTS = {
  /** Settings › Billing › Cancel Subscription was clicked. */
  opened: 'cancel_dialog_opened',
  /** The dialog was closed without cancelling or asking the team to wait. */
  closed: 'cancel_dialog_closed',
  /** The plan was cancelled at the end of its period. */
  canceled: 'subscription_canceled',
  /** The customer gave the team three days instead (WAIT_DAYS). */
  waitRequested: 'cancel_wait_requested',
  /** A cancelled plan was set to renew again. */
  reactivated: 'subscription_reactivated',
} as const;

/** The plan the flow is about: its id and billing period. */
export type CancelPlan = { plan: string; interval: 'month' | 'year' };

/** What the customer said in the dialog: the reasons, and whether they wrote. */
export type CancelAnswer = { reasons: CancelReason[]; message: string };

function answerProperties({ reasons, message }: CancelAnswer) {
  return {
    reasons: [...reasons],
    reason_count: reasons.length,
    has_message: message.trim().length > 0,
  };
}

/** Days left in the paid period: null when it isn't known. */
export function daysLeft(periodEnd: string | null, now = new Date()): number | null {
  if (!periodEnd) return null;
  const end = new Date(periodEnd).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

export function trackCancelOpened(plan: CancelPlan, periodEnd: string | null): void {
  track(CANCEL_EVENTS.opened, { ...plan, days_left: daysLeft(periodEnd) });
}

export function trackCancelClosed(answer: CancelAnswer): void {
  track(CANCEL_EVENTS.closed, answerProperties(answer));
}

export function trackCanceled(answer: CancelAnswer, waitOffered: boolean): void {
  track(CANCEL_EVENTS.canceled, { ...answerProperties(answer), wait_offered: waitOffered });
}

export function trackWaitRequested(answer: CancelAnswer): void {
  track(CANCEL_EVENTS.waitRequested, answerProperties(answer));
}

export function trackReactivated(plan: CancelPlan): void {
  track(CANCEL_EVENTS.reactivated, plan);
}
