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

const DAY_MS = 86_400_000;

/** The subscription states with a plan to cancel or keep. */
export const SUBSCRIBED_STATUSES = ['active', 'trialing', 'past_due'];

/**
 * Whether waiting can be offered: the plan renews (or the trial ends) at
 * least a day after the team's answer is due, so the customer still has
 * time to cancel after hearing back. The web's canWait is the same rule.
 */
export function canWait(periodEnd, now = new Date()) {
  if (!periodEnd) return false;
  const end = new Date(periodEnd).getTime();
  return Number.isFinite(end) && end > now.getTime() + (WAIT_DAYS + 1) * DAY_MS;
}

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
 * The moment with its time, in UTC: "October 24, 2026, 17:00 UTC". The
 * customer sees the same moment in their own time zone, which can fall on
 * another day.
 */
const formatMoment = (date) => {
  const d = new Date(date);
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${formatDate(d)}, ${time} UTC`;
};

const numberFormat = new Intl.NumberFormat('en-US');

/**
 * What the person who cancelled did lately, from PostHog
 * (posthog-person-summary.js): a few counts, their top pages and product
 * events, and a link to their profile and replays. { ok: false }: one line
 * saying PostHog didn't answer. None (PostHog isn't set up): nothing.
 */
function activitySection(activity) {
  if (!activity) return '';
  if (activity.ok === false) {
    return `<p style="margin:16px 0 0;font-size:14px;color:#464442;">PostHog didn't answer, so there is no activity summary.</p>\n`;
  }
  const cell = 'padding:4px 12px 4px 0;vertical-align:top;font-size:14px;';
  const rows = [
    ['Sessions', numberFormat.format(activity.sessions ?? 0)],
    ['Active days', numberFormat.format(activity.activeDays ?? 0)],
    ['Page views', numberFormat.format(activity.pageviews ?? 0)],
    ['Last seen', activity.lastSeen ? formatMoment(activity.lastSeen) : 'Not in these days'],
  ];
  const list = (items, empty) =>
    items?.length
      ? `<ul style="margin:0;padding:0 0 0 20px;font-size:14px;">${items
          .map(
            ([text, n]) =>
              `<li style="margin:0 0 2px;">${escapeHtml(text)} <span style="color:#464442;">· ${escapeHtml(numberFormat.format(n ?? 0))}</span></li>`,
          )
          .join('')}</ul>`
      : `<p style="margin:0;font-size:14px;color:#464442;">${escapeHtml(empty)}</p>`;
  const label = (text) =>
    `<p style="margin:12px 0 4px;font-size:14px;color:#464442;">${escapeHtml(text)}</p>`;

  return `<p style="margin:24px 0 8px;font-size:15px;font-weight:600;">Last ${escapeHtml(activity.days ?? 14)} days in Ansvisor</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${rows
  .map(
    ([name, value]) =>
      `<tr><td style="${cell}color:#464442;white-space:nowrap;">${escapeHtml(name)}</td><td style="${cell}">${escapeHtml(value)}</td></tr>`,
  )
  .join('\n')}
</table>
${label('Top pages')}
${list(
  activity.topPages?.map((page) => [page.path, page.views]),
  'No pages viewed',
)}
${label('Top events')}
${list(
  activity.events?.map((item) => [item.event, item.count]),
  'No product events',
)}
${
  activity.personUrl
    ? `<p style="margin:12px 0 0;font-size:14px;"><a href="${escapeHtml(activity.personUrl)}" style="color:#1C1A17;">Open their PostHog profile and replays</a></p>`
    : ''
}
`;
}

/**
 * The e-mail to the team: what the customer chose in the subject, then who
 * they are, their plan, and what they said, then (with `activity`) what they
 * did in Ansvisor before. Plain tables and inline styles, for any mail client.
 */
export function buildCancelFeedbackEmail({ org, user, feedback, now = new Date(), activity }) {
  const orgName = org?.name || 'An organization';
  const wait = feedback.choice === 'wait';
  const subject = wait
    ? `${orgName} asks us to act within ${WAIT_DAYS} days before cancelling`
    : `${orgName} cancelled their plan`;

  const who = user.name ? `${user.name} <${user.email ?? ''}>` : (user.email ?? 'Unknown');
  const rows = [
    ['Chose', wait ? `Wait ${WAIT_DAYS} days for us to act` : 'Cancel at the end of the period'],
    ...(wait ? [['Act by', formatMoment(now.getTime() + WAIT_DAYS * DAY_MS)]] : []),
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
${activitySection(activity)}<p style="margin:16px 0 0;font-size:12px;color:#464442;">Reply to this e-mail to answer the customer.</p>
</body></html>`;

  return { subject, html };
}
