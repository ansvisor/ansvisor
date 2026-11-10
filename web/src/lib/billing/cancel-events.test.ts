import { beforeEach, describe, expect, it, vi } from 'vitest';
import { track } from '@/lib/analytics';
import {
  CANCEL_EVENTS,
  daysLeft,
  trackCancelClosed,
  trackCancelOpened,
  trackCanceled,
  trackReactivated,
  trackWaitRequested,
} from './cancel-events';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

/**
 * The cancel flow's events: PostHog's cohort of people who cancelled starts
 * from these, so their names stay put, and a customer's message never goes.
 */

beforeEach(() => vi.clearAllMocks());

describe('CANCEL_EVENTS', () => {
  it('keeps the names PostHog cohorts and insights are built on', () => {
    expect(CANCEL_EVENTS).toEqual({
      opened: 'cancel_dialog_opened',
      closed: 'cancel_dialog_closed',
      canceled: 'subscription_canceled',
      waitRequested: 'cancel_wait_requested',
      reactivated: 'subscription_reactivated',
    });
  });
});

describe('daysLeft', () => {
  const now = new Date('2026-11-10T12:00:00Z');

  it('counts the days to the end of the paid period, a part day as one', () => {
    expect(daysLeft('2026-11-20T12:00:00Z', now)).toBe(10);
    expect(daysLeft('2026-11-10T13:00:00Z', now)).toBe(1);
  });

  it('is 0 once the period is over, and null when it is unknown', () => {
    expect(daysLeft('2026-11-01T00:00:00Z', now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft('not a date', now)).toBeNull();
  });
});

describe('the events', () => {
  const answer = { reasons: ['too_expensive', 'switching'] as const, message: '  Too pricey.  ' };

  it('sends the plan when the dialog opens', () => {
    trackCancelOpened({ plan: 'growth', interval: 'year' }, null);
    expect(track).toHaveBeenCalledWith('cancel_dialog_opened', {
      plan: 'growth',
      interval: 'year',
      days_left: null,
    });
  });

  it('sends the reasons and whether a message was written, never the message', () => {
    trackCanceled({ ...answer, reasons: [...answer.reasons] }, true);
    trackWaitRequested({ ...answer, reasons: [...answer.reasons] });
    trackCancelClosed({ reasons: [], message: '   ' });
    expect(vi.mocked(track).mock.calls).toEqual([
      [
        'subscription_canceled',
        {
          reasons: ['too_expensive', 'switching'],
          reason_count: 2,
          has_message: true,
          wait_offered: true,
        },
      ],
      [
        'cancel_wait_requested',
        { reasons: ['too_expensive', 'switching'], reason_count: 2, has_message: true },
      ],
      ['cancel_dialog_closed', { reasons: [], reason_count: 0, has_message: false }],
    ]);
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toContain('pricey');
  });

  it('sends the plan set to renew again', () => {
    trackReactivated({ plan: 'starter', interval: 'month' });
    expect(track).toHaveBeenCalledWith('subscription_reactivated', {
      plan: 'starter',
      interval: 'month',
    });
  });
});
