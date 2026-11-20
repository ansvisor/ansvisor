import { sendEmail } from '../email.js';
import { DEFAULT_LOCALE, formatNumberIn, formatPercentIn, translator } from '../i18n.js';
import { platformLabel } from './format.js';

/**
 * Daily Pulse email rendering + delivery via the Resend HTTP API (#540).
 *
 * Cloud-only: the caller gates on isCloud(). No SDK — a single fetch to
 * https://api.resend.com/emails with RESEND_API_KEY. When the key is
 * missing the send is a silent no-op so self-host / misconfigured
 * environments never crash the tracking pipeline.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CAMPAIGN_TAGS = { utm_source: 'pulse', utm_medium: 'email', utm_campaign: 'daily_pulse' };

/**
 * Campaign tags for PostHog on links into the app. Only the app's own origin
 * is tagged (never a cited third-party URL), and an existing query string is
 * kept.
 */
export function tagAppLink(
  link,
  appOrigin = process.env.PUBLIC_APP_URL || 'http://localhost:3000',
) {
  try {
    const url = new URL(link);
    if (url.origin !== new URL(appOrigin).origin) return link;
    for (const [key, value] of Object.entries(CAMPAIGN_TAGS)) url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return link;
  }
}

/**
 * The numbers' formats in the reader's language: as written before in
 * English ("2.1", "-4"), "2,1" in German. No grouping, so a count reads as
 * it always has.
 */
function numbersIn(locale) {
  const format = (value) =>
    formatNumberIn(locale, value, { useGrouping: false, maximumFractionDigits: 10 });
  /** A change with its sign, to one decimal: "+2.1", "-4", "0". */
  const signedIn = (n) => {
    const v = Math.round(n * 10) / 10;
    if (v > 0) return `+${format(v)}`;
    if (v < 0) return `-${format(-v)}`;
    return format(0);
  };
  return { format, signedIn };
}

/**
 * One KPI tile. `changeText` words the signed change ("+0.3 pts vs the 7 days
 * before"); without it the bare signed number shows. `note` is a small line
 * under the value that names what the number counts.
 */
function kpiCell(label, value, change, signedIn, { changeText = null, note = null } = {}) {
  const roundedChange = change === null ? null : Math.round(change * 10) / 10;
  const changeHtml =
    change === null
      ? ''
      : `<div style="font-size:12px;color:${roundedChange >= 0 ? '#059669' : '#dc2626'};">${escapeHtml(roundedChange >= 0 ? '▲' : '▼')} ${escapeHtml(changeText ? changeText(signedIn(roundedChange)) : signedIn(roundedChange))}</div>`;
  const noteHtml = note
    ? `<div style="font-size:11px;color:#6b7280;">${escapeHtml(note)}</div>`
    : '';
  return `<td style="padding:12px 16px;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</div>
    <div style="font-size:22px;font-weight:600;color:#111827;">${escapeHtml(value)}</div>
    ${changeHtml}${noteHtml}
  </td>`;
}

function listItem(text) {
  return `<li style="margin:0 0 8px 0;color:#374151;font-size:14px;line-height:1.5;">${text}</li>`;
}

const strong = (text) => `<strong>${escapeHtml(text)}</strong>`;

function highlightLine(h, t, { format, signedIn }) {
  switch (h.type) {
    case 'first_citation': {
      const link = `<a href="${escapeHtml(h.url)}" style="color:#2563eb;">${escapeHtml(h.label || h.url)}</a>`;
      return listItem(
        h.promptText
          ? t('pulse.highlight.firstCitationPrompt', { link, prompt: escapeHtml(h.promptText) })
          : t('pulse.highlight.firstCitation', { link }),
      );
    }
    case 'prompt_gain':
      return listItem(
        t('pulse.highlight.promptGain', {
          prompt: escapeHtml(h.promptText),
          gain: strong(t('pulse.pts', { value: signedIn(h.gain) })),
        }),
      );
    case 'competitor_overtaken':
      return listItem(
        t('pulse.highlight.competitorOvertaken', {
          competitor: strong(h.competitorName),
          brandRate: escapeHtml(format(h.brandRate)),
          competitorRate: escapeHtml(format(h.competitorRate)),
        }),
      );
    case 'new_engine':
      return listItem(
        t('pulse.highlight.newEngine', { platform: strong(platformLabel(h.platform)) }),
      );
    default:
      return '';
  }
}

function warningLine(w, t, { format }) {
  const fromTo = () => strong(`${format(w.from)} → ${format(w.to)}`);
  switch (w.type) {
    case 'sharp_drop':
      return listItem(t('pulse.warning.sharpDrop', { change: fromTo() }));
    case 'visibility_slipping':
      return listItem(t('pulse.warning.slipping', { change: fromTo() }));
    case 'competitor_surge':
      return listItem(
        t('pulse.warning.competitorSurge', {
          competitor: strong(w.competitorName),
          from: escapeHtml(format(w.from)),
          to: escapeHtml(format(w.to)),
        }),
      );
    case 'competitor_crossed':
      return listItem(
        t('pulse.warning.competitorCrossed', {
          competitor: strong(w.competitorName),
          competitorRate: escapeHtml(format(w.competitorRate)),
          brandRate: escapeHtml(format(w.brandRate)),
        }),
      );
    case 'lost_citations':
      return listItem(t('pulse.warning.lostCitations', { prompt: escapeHtml(w.promptText) }));
    default:
      return '';
  }
}

/**
 * Render the pulse into { subject, html }, in `locale`: the reader's
 * interface language (LOC-008), English when none.
 */
export function renderPulseEmail({
  brandName,
  metrics,
  insightsUrl,
  settingsUrl,
  locale = DEFAULT_LOCALE,
}) {
  const t = translator(locale);
  const numbers = numbersIn(locale);
  const { format, signedIn } = numbers;
  const { kpis, highlights, warnings, degradedPlatforms, windowDays } = metrics;
  const windowLabel = windowDays === 7 ? t('pulse.windowWeek') : t('pulse.windowDay');
  // The weekly frequency reads a 7-day window; daily and notable read a day.
  const title = windowDays === 7 ? t('pulse.titleWeek') : t('pulse.titleDay');
  // The visibility score is points out of 100, never a share of prompts (D2).
  const score = (value) => t('pulse.score', { value: format(value) });

  const trend = kpis.weekTrend;
  const subject = t('pulse.subject', {
    brand: brandName,
    title,
    rate: format(kpis.visibilityRate),
    weekRate: format(kpis.weekRate),
    trend: signedIn(trend),
  });

  const highlightItems = highlights
    .map((h) => highlightLine(h, t, numbers))
    .filter(Boolean)
    .join('');
  const warningItems = warnings
    .map((w) => warningLine(w, t, numbers))
    .filter(Boolean)
    .join('');

  const degradedNote = degradedPlatforms.length
    ? `<p style="font-size:12px;color:#92400e;background:#fef3c7;border-radius:6px;padding:8px 12px;">
        ${escapeHtml(t('pulse.degraded', { platforms: degradedPlatforms.map(platformLabel).join(', '), count: degradedPlatforms.length }))}
      </p>`
    : '';

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 4px 0;">${t('pulse.heading', { title, brand: escapeHtml(brandName) })}</h1>
  <p style="font-size:13px;color:#6b7280;margin:0 0 20px 0;">${t('pulse.intro', { window: windowLabel })}</p>

  <table role="presentation" cellspacing="8" style="border-collapse:separate;width:100%;margin-bottom:8px;">
    <tr>
      ${kpiCell(t('pulse.kpi.visibility'), score(kpis.visibilityRate), null, signedIn)}
      ${kpiCell(t('pulse.kpi.trend'), score(kpis.weekRate), kpis.weekTrend, signedIn, {
        changeText: (change) => t('pulse.trendChange', { change }),
      })}
    </tr>
    <tr>
      ${kpiCell(t('pulse.kpi.mentions'), format(kpis.mentions), kpis.mentionsChange, signedIn)}
      ${kpiCell(t('pulse.kpi.citations'), format(kpis.citations), kpis.citationsChange, signedIn)}
    </tr>
    <tr>
      ${kpiCell(t('pulse.kpi.sentiment'), formatPercentIn(locale, kpis.sentimentPct, 10), kpis.sentimentChange, signedIn)}
      ${kpiCell(t('pulse.kpi.prompts'), t('pulse.promptsValue', { visible: format(kpis.visiblePrompts), total: format(kpis.promptCount) }), null, signedIn, { note: t('pulse.promptsNote', { count: kpis.promptCount, total: format(kpis.promptCount), window: windowLabel }) })}
    </tr>
  </table>

  ${degradedNote}

  ${
    highlightItems
      ? `<h2 style="font-size:14px;color:#059669;margin:20px 0 8px 0;">${t('pulse.highlights')}</h2>
         <ul style="margin:0;padding-left:20px;">${highlightItems}</ul>`
      : ''
  }

  ${
    warningItems
      ? `<h2 style="font-size:14px;color:#dc2626;margin:20px 0 8px 0;">${t('pulse.warnings')}</h2>
         <ul style="margin:0;padding-left:20px;">${warningItems}</ul>`
      : ''
  }

  <div style="margin:28px 0;">
    <a href="${escapeHtml(tagAppLink(insightsUrl))}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;">${t('pulse.button')}</a>
  </div>

  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
    ${t('pulse.footer', { brand: escapeHtml(brandName) })}
    <a href="${escapeHtml(tagAppLink(settingsUrl))}" style="color:#6b7280;">${t('pulse.manage')}</a>
  </p>
</div>`;

  return { subject, html };
}

/**
 * Send a pulse email through the Resend HTTP API.
 * Returns true when accepted, false otherwise (missing key, HTTP error).
 */
export function sendPulseEmail({ to, subject, html, settingsUrl }) {
  return sendEmail({ to, subject, html, headers: { 'List-Unsubscribe': `<${settingsUrl}>` } });
}
