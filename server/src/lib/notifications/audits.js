import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { sendEmail } from '../email.js';
import { translator, uiLanguagesOf } from '../i18n.js';
import { emailsOf } from '../pulse/audience.js';
import { brandAudience, choosing, ofActiveWorkspaces } from './choices.js';
import { claimSend, dayKey, markSent } from './sends.js';
import { appOrigin, notificationHtml } from './email-shell.js';

/**
 * Two Site Audit e-mails (Settings › Notifications), only for brands the
 * person may see, in their language, Off until they pick them:
 *
 *   * audit_finished, "Audit finished": audits that completed, a bulk run's
 *     or a scheduled run's, with each page's score. Right away gathers the
 *     audits finished since the last sweep in one e-mail per brand, so a bulk
 *     run of 25 pages isn't 25 e-mails; Daily summary sends the day's.
 *   * score_dropped, "Score dropped": a page whose new audit scored 5 points
 *     or more below its previous one, Right away or in the day's summary.
 *
 * Each audit goes to each person once (notification_sends, 00556): Right
 * away claims each audit, the summary claims the day.
 */

export const FINISHED_KIND = 'audit_finished';
export const DROPPED_KIND = 'score_dropped';

/** A drop of this many points or more is told (the page's own wording: 5). */
export const DROP_POINTS = 5;

/** How far back Right away looks: older audits never mail. */
export const INSTANT_WINDOW_MS = 2 * 60 * 60 * 1000;

/** The pages an e-mail names; the rest are counted. */
export const LISTED = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

const emailReady = () => !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL;

const auditUrl = (id) => `${appOrigin()}/dashboard/audit/${id}`;
const pagesUrl = () => `${appOrigin()}/dashboard/audit?tab=pages`;

/** "acme.com/pricing": a page as people read it. */
const pageOf = (audit) =>
  String(audit.final_url || audit.url || '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');

const scoreOf = (audit) => Math.round(Number(audit.total_score ?? 0));

/** Completed audits since `since`, of brands that aren't the demo's, oldest first. */
async function completedSince(since) {
  const { data, error } = await supabaseAdmin
    .from('site_audits')
    .select(
      'id, brand_id, url, final_url, page_key, total_score, completed_at, brands!inner(name, organization_id)',
    )
    .eq('status', 'completed')
    .not('total_score', 'is', null)
    .gte('completed_at', since.toISOString())
    // Nobody is mailed about a demo brand, or one turned off.
    .eq('brands.is_demo', false)
    .eq('brands.is_active', true)
    .order('completed_at', { ascending: true });
  if (error) throw new Error(`site_audits: ${error.message}`);
  return data ?? [];
}

/** The page's audit before `audit`, by its page key, else its address; null for its first. */
async function previousAudit(audit) {
  let query = supabaseAdmin
    .from('site_audits')
    .select('id, total_score, completed_at')
    .eq('brand_id', audit.brand_id)
    .eq('status', 'completed')
    .not('total_score', 'is', null)
    .lt('completed_at', audit.completed_at);
  query = audit.page_key ? query.eq('page_key', audit.page_key) : query.eq('url', audit.url);
  const { data, error } = await query.order('completed_at', { ascending: false }).limit(1);
  if (error) throw new Error(`site_audits: ${error.message}`);
  return data?.[0] ?? null;
}

/** The audits of `audits` whose score fell DROP_POINTS or more, each with its previous score. */
async function drops(audits) {
  const out = [];
  for (const audit of audits) {
    const before = await previousAudit(audit);
    if (before && scoreOf(before) - scoreOf(audit) >= DROP_POINTS) {
      out.push({ ...audit, before: scoreOf(before) });
    }
  }
  return out;
}

function byBrand(rows) {
  const brands = new Map();
  for (const row of rows) {
    const group = brands.get(row.brand_id) ?? {
      brandId: row.brand_id,
      brand: row.brands.name,
      organizationId: row.brands.organization_id,
      audits: [],
    };
    group.audits.push(row);
    brands.set(row.brand_id, group);
  }
  return [...brands.values()];
}

/**
 * @param {'finished'|'dropped'} which
 * @param {{ brand: string, audits: Array<{ id: string, url: string, final_url?: string, total_score: number, before?: number }> }} what
 * @param {string} locale
 */
export function renderAuditEmail(which, { brand, audits }, locale) {
  const t = translator(locale);
  const count = audits.length;
  const items = audits.slice(0, LISTED).map((audit) =>
    which === 'dropped'
      ? t('notifications.audits.droppedItem', {
          page: pageOf(audit),
          before: audit.before,
          score: scoreOf(audit),
        })
      : t('notifications.audits.finishedItem', { page: pageOf(audit), score: scoreOf(audit) }),
  );
  if (count > LISTED) items.push(t('notifications.audits.more', { count: count - LISTED }));
  const average = Math.round(audits.reduce((sum, a) => sum + scoreOf(a), 0) / Math.max(count, 1));
  return {
    subject: t(`notifications.audits.${which}Subject`, { brand, count }),
    html: notificationHtml({
      title: t(`notifications.audits.${which}Title`, { count }),
      lines: [
        which === 'dropped'
          ? t('notifications.audits.droppedLine', { brand, count, points: DROP_POINTS })
          : t('notifications.audits.finishedLine', { brand, count, average }),
      ],
      items,
      button: {
        label: t('notifications.audits.button', { count }),
        url: count === 1 ? auditUrl(audits[0].id) : pagesUrl(),
      },
      why: t(`notifications.audits.${which}Why`),
      change: t('notifications.change'),
    }),
  };
}

/** The ids of the people who chose `choice` for `kind` on the group's brand. */
async function audienceFor(group, kind, choice) {
  return choosing(await brandAudience(group.organizationId, group.brandId, kind), choice);
}

/**
 * Sends a brand's audits to the people who chose `choice` for `kind`: Right
 * away claims each audit and sends those newly claimed together; the
 * summary claims the day.
 */
async function sendBrand({ kind, which, group, choice, dayKeyed, ids: chosen }) {
  const ids = chosen ?? (await audienceFor(group, kind, choice));
  if (ids.length === 0) return 0;
  const languages = await uiLanguagesOf(ids);
  let sent = 0;
  for (const id of ids) {
    const [address] = await emailsOf([id]);
    if (!address) continue;
    let audits = group.audits;
    let subjects;
    if (dayKeyed) {
      const subject = `daily:${dayKeyed}:${group.brandId}`;
      if (!(await claimSend({ kind, userId: id, brandId: group.brandId, subject }))) continue;
      subjects = [subject];
    } else {
      audits = [];
      subjects = [];
      for (const audit of group.audits) {
        const subject = `audit:${audit.id}`;
        if (await claimSend({ kind, userId: id, brandId: group.brandId, subject })) {
          audits.push(audit);
          subjects.push(subject);
        }
      }
      if (audits.length === 0) continue;
    }
    const mail = renderAuditEmail(which, { brand: group.brand, audits }, languages.get(id));
    if (await sendEmail({ to: [address], subject: mail.subject, html: mail.html })) {
      for (const subject of subjects) await markSent({ kind, userId: id, subject });
      sent += 1;
    }
  }
  return sent;
}

/** Both kinds over `audits`: finished as they are, dropped once checked against the page's last audit. */
async function sendAll(audits, choice, dayKeyed) {
  let sent = 0;
  for (const group of await ofActiveWorkspaces(byBrand(audits))) {
    try {
      sent += await sendBrand({ kind: FINISHED_KIND, which: 'finished', group, choice, dayKeyed });
      // Nobody chose Score dropped here: the previous audits aren't read.
      const ids = await audienceFor(group, DROPPED_KIND, choice);
      const fallen = ids.length ? await drops(group.audits) : [];
      if (fallen.length) {
        sent += await sendBrand({
          kind: DROPPED_KIND,
          which: 'dropped',
          group: { ...group, audits: fallen },
          choice,
          dayKeyed,
          ids,
        });
      }
    } catch (err) {
      logger.error(
        { err, brandId: group.brandId },
        '[notifications] audit e-mails failed for a brand',
      );
    }
  }
  return sent;
}

/**
 * Right away: every few minutes, the audits finished in the last two hours
 * that a person hasn't been told of, in one e-mail per brand.
 * @returns {Promise<number>} e-mails sent
 */
export async function sendAuditAlerts(now = new Date()) {
  if (!emailReady()) return 0;
  return sendAll(await completedSince(new Date(now - INSTANT_WINDOW_MS)), 'instant', null);
}

/**
 * Daily summary: once a day, the last day's audits.
 * @returns {Promise<number>} e-mails sent
 */
export async function sendAuditSummaries(now = new Date()) {
  if (!emailReady()) return 0;
  return sendAll(await completedSince(new Date(now - DAY_MS)), 'daily', dayKey(now));
}
