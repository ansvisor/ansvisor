import { describe, expect, it } from 'vitest';
import {
  buildCancelFeedbackEmail,
  canWait,
  cancelFeedbackSchema,
  feedbackRecipients,
} from './cancel-feedback.js';

/**
 * Why a customer cancels, or asks for three days first: what is accepted,
 * who it goes to, and the e-mail the team reads.
 */

describe('cancelFeedbackSchema', () => {
  it('takes the reasons once each and a trimmed message, both optional', () => {
    expect(
      cancelFeedbackSchema.parse({
        reasons: ['too_expensive', 'too_expensive', 'switching'],
        message: '  Too pricey for us.  ',
        choice: 'cancel',
      }),
    ).toEqual({
      reasons: ['too_expensive', 'switching'],
      message: 'Too pricey for us.',
      choice: 'cancel',
    });
    expect(cancelFeedbackSchema.parse({ choice: 'wait' })).toEqual({
      reasons: [],
      message: '',
      choice: 'wait',
    });
  });

  it('refuses an unknown reason or choice, and a message over 2,000 characters', () => {
    expect(cancelFeedbackSchema.safeParse({ reasons: ['bored'], choice: 'cancel' }).success).toBe(
      false,
    );
    expect(cancelFeedbackSchema.safeParse({ choice: 'pause' }).success).toBe(false);
    expect(
      cancelFeedbackSchema.safeParse({ choice: 'cancel', message: 'x'.repeat(2001) }).success,
    ).toBe(false);
  });
});

describe('feedbackRecipients', () => {
  it('reads the comma-separated addresses, and none when unset', () => {
    expect(feedbackRecipients(' owner@example.com, support@example.com ,')).toEqual([
      'owner@example.com',
      'support@example.com',
    ]);
    expect(feedbackRecipients('')).toEqual([]);
  });
});

describe('buildCancelFeedbackEmail', () => {
  const org = {
    name: 'Acme Coffee',
    plan: 'growth',
    subscription_status: 'active',
    subscription_ends_at: '2026-11-03T10:00:00Z',
  };
  const user = { name: 'Ada', email: 'ada@acme.example', role: 'admin' };
  const now = new Date('2026-10-21T12:00:00Z');

  it('says in the subject that the customer waits, and by when to act', () => {
    const { subject, html } = buildCancelFeedbackEmail({
      org,
      user,
      feedback: { reasons: ['missing_feature'], message: 'We need Slack alerts.', choice: 'wait' },
      now,
    });
    expect(subject).toBe('Acme Coffee asks us to act within 3 days before cancelling');
    expect(html).toContain('Wait 3 days for us to act');
    // The moment to act by, with its time: the customer sees it in their own zone.
    expect(html).toContain('October 24, 2026, 12:00 UTC');
    expect(html).toContain('November 3, 2026');
    expect(html).toContain('growth · active');
    expect(html).toContain('Ada &lt;ada@acme.example&gt; (admin)');
    expect(html).toContain('Missing a feature they need');
    expect(html).toContain('We need Slack alerts.');
  });

  it('says the plan was cancelled, with no reasons or message given', () => {
    const { subject, html } = buildCancelFeedbackEmail({
      org,
      user,
      feedback: { reasons: [], message: '', choice: 'cancel' },
      now,
    });
    expect(subject).toBe('Acme Coffee cancelled their plan');
    expect(html).toContain('Cancel at the end of the period');
    expect(html).not.toContain('Act by');
    expect(html).toContain('None ticked');
    expect(html).toContain('No message');
  });

  it('escapes what the customer wrote', () => {
    const { html } = buildCancelFeedbackEmail({
      org: { ...org, name: '<b>Acme</b>' },
      user,
      feedback: { reasons: [], message: '<script>alert(1)</script>', choice: 'cancel' },
      now,
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Acme</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  const feedback = { reasons: [], message: 'Bye.', choice: 'cancel' };
  const activity = {
    ok: true,
    days: 14,
    pageviews: 1234,
    sessions: 5,
    activeDays: 3,
    lastSeen: '2026-10-20T16:45:00.000Z',
    topPages: [
      { path: '/dashboard/brands/:id/prompts', views: 20 },
      { path: '/dashboard', views: 12 },
    ],
    events: [
      { event: 'cancel_dialog_opened', count: 2 },
      { event: 'chat_starter_clicked', count: 1 },
    ],
    personUrl: 'https://us.posthog.com/project/12345/person/u1',
  };

  it('adds what they did in the last 14 days after the message, with their PostHog link', () => {
    const { html } = buildCancelFeedbackEmail({ org, user, feedback, now, activity });
    expect(html).toContain('Last 14 days in Ansvisor');
    expect(html.indexOf('Last 14 days in Ansvisor')).toBeGreaterThan(html.indexOf('Bye.'));
    expect(html.indexOf('Last 14 days in Ansvisor')).toBeLessThan(
      html.indexOf('Reply to this e-mail'),
    );
    for (const [label, value] of [
      ['Sessions', '5'],
      ['Active days', '3'],
      ['Page views', '1,234'],
      ['Last seen', 'October 20, 2026, 16:45 UTC'],
    ]) {
      expect(html).toMatch(new RegExp(`>${label}</td><td[^>]*>${value}</td>`));
    }
    expect(html).toContain('Top pages');
    expect(html).toContain('/dashboard/brands/:id/prompts <span style="color:#464442;">· 20');
    expect(html).toContain('Top events');
    expect(html).toContain('cancel_dialog_opened <span style="color:#464442;">· 2');
    expect(html).toContain(
      '<a href="https://us.posthog.com/project/12345/person/u1" style="color:#1C1A17;">Open their PostHog profile and replays</a>',
    );
  });

  it('says when they did nothing in those days', () => {
    const { html } = buildCancelFeedbackEmail({
      org,
      user,
      feedback,
      now,
      activity: {
        ...activity,
        pageviews: 0,
        sessions: 0,
        activeDays: 0,
        lastSeen: null,
        topPages: [],
        events: [],
      },
    });
    expect(html).toContain('Not in these days');
    expect(html).toContain('No pages viewed');
    expect(html).toContain('No product events');
  });

  it('says in one line that PostHog didn’t answer', () => {
    const { html } = buildCancelFeedbackEmail({
      org,
      user,
      feedback,
      now,
      activity: { ok: false },
    });
    expect(html).toContain("PostHog didn't answer, so there is no activity summary.");
    expect(html).not.toContain('Last 14 days in Ansvisor');
    expect(html).not.toContain('PostHog profile');
  });

  it('is unchanged without a summary (PostHog not set up)', () => {
    const without = buildCancelFeedbackEmail({ org, user, feedback, now });
    expect(buildCancelFeedbackEmail({ org, user, feedback, now, activity: null })).toEqual(without);
    expect(without.html).not.toContain('PostHog');
    expect(without.html).not.toContain('Last 14 days');
    // The message is followed by the reply line, as before.
    expect(without.html).toContain(
      'Bye.</p>\n<p style="margin:16px 0 0;font-size:12px;color:#464442;">Reply to this e-mail',
    );
  });

  it('escapes the pages, events and link', () => {
    const { html } = buildCancelFeedbackEmail({
      org,
      user,
      feedback,
      now,
      activity: {
        ...activity,
        topPages: [{ path: '/<img src=x onerror=alert(1)>', views: 1 }],
        events: [{ event: '<script>evil()</script>', count: 1 }],
        personUrl: 'https://us.posthog.com/project/1/person/"><script>x</script>',
      },
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('/&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;');
    expect(html).toContain(
      'href="https://us.posthog.com/project/1/person/&quot;&gt;&lt;script&gt;',
    );
  });
});

describe('canWait', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  it('offers three days only with a day to spare before the plan renews', () => {
    expect(canWait('2026-10-25T12:00:01Z', now)).toBe(true);
    expect(canWait('2026-10-25T12:00:00Z', now)).toBe(false);
    expect(canWait('2026-10-24T13:00:00Z', now)).toBe(false);
    expect(canWait(null, now)).toBe(false);
    expect(canWait('not a date', now)).toBe(false);
  });
});
