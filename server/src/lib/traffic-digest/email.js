import { sendEmail } from '../email.js';
import { changeText } from './summary.js';

/**
 * The AI Traffic weekly digest as an e-mail (AT-013, spec §3.8): the week's
 * summary line and its top three changes, with a way to the AI Traffic page
 * and to the notification settings. English, like the Daily Pulse.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "Oct 12": calendar days in UTC, so written in UTC. */
function day(isoDay) {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * @param {{ brandName: string, week: { firstDay: string, lastDay: string },
 *   visits: number, change: number | null, sentences: string[], changes: object[],
 *   trafficUrl: string, settingsUrl: string }} digest
 * @returns {{ subject: string, html: string }}
 */
export function renderTrafficDigestEmail({
  brandName,
  week,
  visits,
  change,
  sentences,
  changes,
  trafficUrl,
  settingsUrl,
}) {
  const range = `${day(week.firstDay)} – ${day(week.lastDay)}`;
  const count = `${visits.toLocaleString('en-US')} AI ${visits === 1 ? 'visit' : 'visits'}`;
  const pct = change === null ? '' : ` (${change > 0 ? '+' : '−'}${Math.abs(change)}%)`;
  const subject = `${brandName} AI traffic last week: ${count}${pct}`;

  const items = changes
    .map(
      (c) =>
        `<li style="margin:0 0 8px 0;color:#374151;font-size:14px;line-height:1.5;">${escapeHtml(changeText(c))}</li>`,
    )
    .join('');

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 4px 0;">AI Traffic weekly — ${escapeHtml(brandName)}</h1>
  <p style="font-size:13px;color:#6b7280;margin:0 0 20px 0;">Visits from AI assistants to your site, ${escapeHtml(range)}.</p>

  <p style="font-size:15px;color:#111827;line-height:1.6;margin:0 0 20px 0;">${escapeHtml(sentences.join(' '))}</p>

  ${
    items
      ? `<h2 style="font-size:14px;color:#111827;margin:20px 0 8px 0;">Top changes</h2>
         <ul style="margin:0;padding-left:20px;">${items}</ul>`
      : ''
  }

  <div style="margin:28px 0;">
    <a href="${escapeHtml(trafficUrl)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;">Open AI Traffic</a>
  </div>

  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
    You're receiving this because the AI Traffic weekly digest is on for ${escapeHtml(brandName)}.
    <a href="${escapeHtml(settingsUrl)}" style="color:#6b7280;">Manage notification settings</a>
  </p>
</div>`;

  return { subject, html };
}

/** Sends through the Resend HTTP API; false when it isn't configured or refuses. */
export function sendTrafficDigestEmail({ to, subject, html, settingsUrl }) {
  return sendEmail({ to, subject, html, headers: { 'List-Unsubscribe': `<${settingsUrl}>` } });
}
