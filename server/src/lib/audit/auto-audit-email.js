import supabaseAdmin from '../../config/supabase.js';
import { sendEmail } from '../email.js';

/**
 * The e-mail after an auto-audit run (SA-006), when the org turned it on in
 * Site Audit settings: "25 pages audited · 6 critical issues · next run Oct
 * 28", per brand when the run covered several. Sent through Resend
 * (email.js), a silent no-op where it isn't configured.
 */

/** The dashboard's origin, for the e-mail's links. */
function appOrigin() {
  const raw = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const monthDay = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "25 pages audited · 6 critical issues" */
function summary({ completed, criticalIssues }) {
  return `${plural(completed, 'page', 'pages')} audited · ${plural(criticalIssues, 'critical issue', 'critical issues')}`;
}

/**
 * @param {{ brands: Array<{ name: string, pages: number, completed: number, criticalIssues: number }>, nextRunAt: string }} run
 * @returns {{ subject: string, html: string }}
 */
export function renderAutoAuditEmail({ brands, nextRunAt }) {
  const total = {
    pages: brands.reduce((n, b) => n + b.pages, 0),
    completed: brands.reduce((n, b) => n + b.completed, 0),
    criticalIssues: brands.reduce((n, b) => n + b.criticalIssues, 0),
  };
  const failed = total.pages - total.completed;
  const url = `${appOrigin()}/dashboard/audit`;

  const brandItems =
    brands.length > 1
      ? `<ul style="margin:0 0 16px 0;padding-left:20px;">${brands
          .map(
            (b) =>
              `<li style="margin:0 0 6px 0;color:#374151;font-size:14px;">${escapeHtml(b.name)}: ${escapeHtml(summary(b))}</li>`,
          )
          .join('')}</ul>`
      : '';
  const failedNote = failed
    ? `<p style="font-size:13px;color:#6b7280;margin:0 0 16px 0;">${escapeHtml(plural(failed, "page couldn't", "pages couldn't"))} be audited; they're left to the next run.</p>`
    : '';

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 8px 0;">Auto-audit finished</h1>
  <p style="font-size:14px;color:#111827;margin:0 0 16px 0;">${escapeHtml(summary(total))} · next run ${escapeHtml(monthDay(nextRunAt))}</p>
  ${brandItems}
  ${failedNote}
  <div style="margin:24px 0;">
    <a href="${escapeHtml(url)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;">Open Site Audit</a>
  </div>
  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
    You're receiving this because auto-audit e-mails are on in Site Audit settings.
    <a href="${escapeHtml(url)}" style="color:#6b7280;">Change them</a>
  </p>
</div>`;

  return { subject: `Site Audit: ${summary(total)}`, html };
}

/** Every member's e-mail address, as Daily Pulse sends to by default. */
async function orgMemberEmails(orgId) {
  const { data: members, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', orgId);
  if (error) throw new Error(error.message);
  const emails = [];
  for (const member of members ?? []) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(member.id);
    if (data?.user?.email) emails.push(data.user.email);
  }
  return emails;
}

/** Render and send the run's e-mail to the org's members. True when accepted. */
export async function sendAutoAuditEmail(orgId, run) {
  const to = await orgMemberEmails(orgId);
  if (to.length === 0) return false;
  const { subject, html } = renderAutoAuditEmail(run);
  return sendEmail({ to, subject, html });
}
