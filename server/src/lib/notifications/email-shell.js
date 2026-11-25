/**
 * The frame of a notification e-mail (Settings › Notifications): a title, a
 * few lines, one button, and why the person gets it with a link to change it.
 * Plain inline styles, as the other e-mails (audit/auto-audit-email.js).
 */

/** The dashboard's origin, for the e-mail's links. */
export function appOrigin() {
  const raw = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Where a person changes their e-mails. */
export const settingsUrl = () => `${appOrigin()}/dashboard/settings?tab=notifications`;

/**
 * @param {{ title: string, lines: string[], items?: string[], button: { label: string, url: string }, why: string, change: string }} parts
 *   lines and items are plain text (escaped here); `why` says why it came, `change` names the settings link
 * @returns {string} the e-mail's HTML
 */
export function notificationHtml({ title, lines, items = [], button, why, change }) {
  const paragraphs = lines
    .map(
      (line) =>
        `<p style="font-size:14px;color:#111827;margin:0 0 12px 0;">${escapeHtml(line)}</p>`,
    )
    .join('');
  const list = items.length
    ? `<ul style="margin:0 0 16px 0;padding-left:20px;">${items
        .map(
          (item) =>
            `<li style="margin:0 0 6px 0;color:#374151;font-size:14px;">${escapeHtml(item)}</li>`,
        )
        .join('')}</ul>`
    : '';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 12px 0;">${escapeHtml(title)}</h1>
  ${paragraphs}
  ${list}
  <div style="margin:24px 0;">
    <a href="${escapeHtml(button.url)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;">${escapeHtml(button.label)}</a>
  </div>
  <p style="font-size:12px;color:#6b7280;margin:24px 0 0 0;">${escapeHtml(why)} <a href="${escapeHtml(settingsUrl())}" style="color:#6b7280;">${escapeHtml(change)}</a></p>
</div>`;
}
