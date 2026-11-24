import supabaseAdmin from '../../config/supabase.js';
import { brandReaders } from '../access.js';
import { brandAudience } from '../notifications/choices.js';
import { sendEmail } from '../email.js';
import { DEFAULT_LOCALE, formatLocale, translator, uiLanguagesOf } from '../i18n.js';

/**
 * The e-mail after an auto-audit run (SA-006), when the org turned it on in
 * Site Audit settings: "25 pages audited · 6 critical issues · next run Oct
 * 28", per brand when the run covered several. Sent through Resend
 * (email.js), a silent no-op where it isn't configured. Each person reads
 * only the brands they can see (brand access, spec §5.4): with All brands,
 * everyone gets the one e-mail, as before.
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

const monthDay = (iso, locale) =>
  new Date(iso).toLocaleDateString(formatLocale(locale), {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/**
 * @param {{ brands: Array<{ name: string, pages: number, completed: number, criticalIssues: number }>, nextRunAt: string }} run
 * @param {string} [locale] the reader's interface language (LOC-008), English when none
 * @returns {{ subject: string, html: string }}
 */
export function renderAutoAuditEmail({ brands, nextRunAt }, locale = DEFAULT_LOCALE) {
  const t = translator(locale);
  /** "25 pages audited · 6 critical issues" */
  const summary = ({ completed, criticalIssues }) =>
    t('autoAudit.summary', { pages: completed, issues: criticalIssues });
  const total = {
    pages: brands.reduce((n, b) => n + b.pages, 0),
    completed: brands.reduce((n, b) => n + b.completed, 0),
    criticalIssues: brands.reduce((n, b) => n + b.criticalIssues, 0),
  };
  const failed = total.pages - total.completed;
  // Pages, where the run's audits are, rather than the Opportunities list.
  const url = `${appOrigin()}/dashboard/audit?tab=pages`;
  const settingsUrl = `${appOrigin()}/dashboard/audit`;

  const brandItems =
    brands.length > 1
      ? `<ul style="margin:0 0 16px 0;padding-left:20px;">${brands
          .map(
            (b) =>
              `<li style="margin:0 0 6px 0;color:#374151;font-size:14px;">${escapeHtml(t('autoAudit.brandLine', { brand: b.name, summary: summary(b) }))}</li>`,
          )
          .join('')}</ul>`
      : '';
  const failedNote = failed
    ? `<p style="font-size:13px;color:#6b7280;margin:0 0 16px 0;">${escapeHtml(t('autoAudit.failed', { count: failed }))}</p>`
    : '';

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 8px 0;">${t('autoAudit.title')}</h1>
  <p style="font-size:14px;color:#111827;margin:0 0 16px 0;">${escapeHtml(t('autoAudit.headline', { summary: summary(total), date: monthDay(nextRunAt, locale) }))}</p>
  ${brandItems}
  ${failedNote}
  <div style="margin:24px 0;">
    <a href="${escapeHtml(url)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;">${t('autoAudit.button')}</a>
  </div>
  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
    ${t('autoAudit.footer')}
    <a href="${escapeHtml(settingsUrl)}" style="color:#6b7280;">${t('autoAudit.change')}</a>
  </p>
</div>`;

  return { subject: t('autoAudit.subject', { summary: summary(total) }), html };
}

/**
 * The members who can see the run's brands, grouped by the brands they see:
 * one e-mail per group, listing those brands. Each group's addresses. A brand
 * whose "Audit finished" e-mail a person chose (Settings › Notifications,
 * anything but Off) is left out of theirs: that e-mail tells them of the same
 * audits, so they never get both; with none left, they get none.
 */
async function recipientGroups(orgId, brands) {
  const readers = await brandReaders(
    orgId,
    brands.map((brand) => brand.id),
  );
  const chose = new Map();
  for (const brand of brands) {
    const audience = await brandAudience(orgId, brand.id, 'audit_finished');
    chose.set(
      brand.id,
      new Set([...audience].filter(([, choice]) => choice !== 'off').map(([id]) => id)),
    );
  }
  const languages = await uiLanguagesOf([...readers.keys()]);
  const groups = new Map();
  for (const [id, seen] of readers) {
    const key = brands
      .filter((brand) => seen.has(brand.id) && !chose.get(brand.id)?.has(id))
      .map((brand) => brand.id)
      .join(',');
    if (!key) continue;
    const { data } = await supabaseAdmin.auth.admin.getUserById(id);
    if (!data?.user?.email) continue;
    // One e-mail per brand set and language (LOC-008).
    const locale = languages.get(id) ?? DEFAULT_LOCALE;
    const groupKey = `${locale}|${key}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), data.user.email]);
  }
  return [...groups].map(([groupKey, to]) => {
    const bar = groupKey.indexOf('|');
    const ids = groupKey.slice(bar + 1).split(',');
    return {
      locale: groupKey.slice(0, bar),
      brands: brands.filter((brand) => ids.includes(brand.id)),
      to,
    };
  });
}

/**
 * Render and send the run's e-mail to the members who can see its brands,
 * each the brands they see. True when every e-mail was accepted.
 */
export async function sendAutoAuditEmail(orgId, run) {
  const groups = await recipientGroups(orgId, run.brands);
  if (groups.length === 0) return false;
  let accepted = true;
  for (const group of groups) {
    const { subject, html } = renderAutoAuditEmail({ ...run, brands: group.brands }, group.locale);
    if (!(await sendEmail({ to: group.to, subject, html }))) accepted = false;
  }
  return accepted;
}
