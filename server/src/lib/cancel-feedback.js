import { z } from 'zod';

/**
 * Why a customer cancels, or asks for three days first (Settings › Billing ›
 * Cancel Subscription): the reasons they ticked and their message, both
 * optional, and what they chose —
 *   - 'cancel': the plan is cancelled at the end of the period (the web app
 *     has already done that through Stripe when this is sent);
 *   - 'wait': the team acts within three days, and the plan stays as it is.
 *
 * E-mailed to the team (CANCEL_FEEDBACK_EMAILS) with replies going to the
 * customer, and kept in cancellation_feedback (00222).
 */

export const CANCEL_REASONS = [
  'too_expensive',
  'missing_feature',
  'no_results',
  'switching',
  'temporary',
  'other',
];

const REASON_LABELS = {
  too_expensive: 'Too expensive',
  missing_feature: 'Missing a feature they need',
  no_results: 'Not seeing results',
  switching: 'Switching to another tool',
  temporary: 'Only needed it for a while',
  other: 'Something else',
};

/** How long the team has to act when the customer waits. */
export const WAIT_DAYS = 3;

/** Answers an organization can send in a day: room to change their mind, not a flood of e-mail. */
export const DAILY_LIMIT = 5;

export const MESSAGE_MAX = 2000;

export const cancelFeedbackSchema = z.object({
  reasons: z
    .array(z.enum(CANCEL_REASONS))
    .max(CANCEL_REASONS.length)
    .default([])
    .transform((reasons) => [...new Set(reasons)]),
  message: z.string().trim().max(MESSAGE_MAX).default(''),
  choice: z.enum(['cancel', 'wait']),
});

/** The team's addresses, from CANCEL_FEEDBACK_EMAILS (comma-separated). None: nothing is sent. */
export function feedbackRecipients(value = process.env.CANCEL_FEEDBACK_EMAILS) {
  return String(value ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const formatDate = (date) =>
  new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

/**
 * The e-mail to the team: what the customer chose in the subject, then who
 * they are, their plan, and what they said. Plain tables and inline styles,
 * for any mail client.
 */
export function buildCancelFeedbackEmail({ org, user, feedback, now = new Date() }) {
  const orgName = org?.name || 'An organization';
  const wait = feedback.choice === 'wait';
  const subject = wait
    ? `${orgName} asks us to act within ${WAIT_DAYS} days before cancelling`
    : `${orgName} cancelled their plan`;

  const who = user.name ? `${user.name} <${user.email ?? ''}>` : (user.email ?? 'Unknown');
  const rows = [
    ['Chose', wait ? `Wait ${WAIT_DAYS} days for us to act` : 'Cancel at the end of the period'],
    ...(wait ? [['Act by', formatDate(now.getTime() + WAIT_DAYS * 86_400_000)]] : []),
    ['Organization', orgName],
    ['Plan', [org?.plan, org?.subscription_status].filter(Boolean).join(' · ') || '—'],
    ...(org?.subscription_ends_at
      ? [['Current period ends', formatDate(org.subscription_ends_at)]]
      : []),
    ['Who', user.role ? `${who} (${user.role})` : who],
    [
      'Reasons',
      feedback.reasons.length
        ? feedback.reasons.map((reason) => REASON_LABELS[reason]).join(', ')
        : 'None ticked',
    ],
  ];

  const cell = 'padding:6px 12px 6px 0;vertical-align:top;font-size:14px;';
  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1C1A17;">
<p style="margin:0 0 16px;font-size:16px;font-weight:600;">${escapeHtml(subject)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${rows
  .map(
    ([label, value]) =>
      `<tr><td style="${cell}color:#464442;white-space:nowrap;">${escapeHtml(label)}</td><td style="${cell}">${escapeHtml(value)}</td></tr>`,
  )
  .join('\n')}
</table>
<p style="margin:16px 0 4px;font-size:14px;color:#464442;">Message</p>
<p style="margin:0;padding:12px;background:#F0EEEA;border-radius:8px;font-size:14px;white-space:pre-wrap;">${
    feedback.message ? escapeHtml(feedback.message) : '<em>No message</em>'
  }</p>
<p style="margin:16px 0 0;font-size:12px;color:#464442;">Reply to this e-mail to answer the customer.</p>
</body></html>`;

  return { subject, html };
}
