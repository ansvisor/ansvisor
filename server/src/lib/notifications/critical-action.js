import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { sendEmail } from '../email.js';
import { translator, uiLanguagesOf } from '../i18n.js';
import { actionCode } from '../action-center/action-code.js';
import { emailsOf } from '../pulse/audience.js';
import { brandAudience, choosing, ofActiveWorkspaces } from './choices.js';
import { claimSend, dayKey, markSent } from './sends.js';
import { appOrigin, notificationHtml } from './email-shell.js';

/**
 * "A new Critical action" (Settings › Notifications, critical_action): for
 * each Action Center action that reaches Critical priority (90+) while open,
 * the brand's people who chose Right away get one e-mail per action, and
 * those who chose Daily summary one e-mail a day per brand listing the day's.
 * Each person sees only the brands they may see, and gets each e-mail once
 * (notification_sends, 00556). Off by default: nobody gets it until they
 * pick it.
 */

export const KIND = 'critical_action';

/** Open: still to be worked on. */
const OPEN = ['new', 'in_progress'];

/** How far back "Right away" looks: a run that missed a few sweeps still catches up, older ones never mail. */
export const INSTANT_WINDOW_MS = 2 * 60 * 60 * 1000;

const emailReady = () => !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL;

const actionUrl = (id) => `${appOrigin()}/dashboard/action-center/actions?action=${id}`;

/** Open Critical actions created since `since`, with their brand. */
async function criticalSince(since) {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select(
      'id, brand_id, action_no, brand_no, category, created_at, brands!inner(name, organization_id)',
    )
    .eq('priority_level', 'critical')
    // Nobody is mailed about a demo brand, or one turned off.
    .eq('brands.is_demo', false)
    .eq('brands.is_active', true)
    .in('status', OPEN)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });
  if (error) throw new Error(`actions: ${error.message}`);
  return data ?? [];
}

/** Rows grouped by brand: brand id → { brand, organizationId, actions }. */
function byBrand(rows) {
  const brands = new Map();
  for (const row of rows) {
    const group = brands.get(row.brand_id) ?? {
      brandId: row.brand_id,
      brand: row.brands.name,
      organizationId: row.brands.organization_id,
      actions: [],
    };
    group.actions.push(row);
    brands.set(row.brand_id, group);
  }
  return [...brands.values()];
}

/**
 * @param {{ brand: string, actions: Array<{ id: string, action_no: number, brand_no?: number|null, category: string }> }} what
 * @param {string} locale
 */
export function renderCriticalEmail({ brand, actions }, locale) {
  const t = translator(locale);
  const one = actions.length === 1 ? actions[0] : null;
  const line = (a) =>
    t('notifications.critical.item', {
      code: actionCode(a),
      category: t(`notifications.categories.${a.category}`),
    });
  const subject = one
    ? t('notifications.critical.subjectOne', { brand, code: actionCode(one) })
    : t('notifications.critical.subjectMany', { brand, count: actions.length });
  const html = notificationHtml({
    title: t('notifications.critical.title', { count: actions.length }),
    lines: [
      one
        ? t('notifications.critical.lineOne', { brand, item: line(one) })
        : t('notifications.critical.lineMany', { brand, count: actions.length }),
    ],
    items: one ? [] : actions.map(line),
    button: {
      label: t('notifications.critical.button', { count: actions.length }),
      url: one ? actionUrl(one.id) : `${appOrigin()}/dashboard/action-center/actions`,
    },
    why: t('notifications.critical.why'),
    change: t('notifications.change'),
  });
  return { subject, html };
}

/** Sends one person their e-mail, once: claimed first, marked sent after. */
async function sendOnce({ userId, brandId, subject, locale, what, address }) {
  if (!(await claimSend({ kind: KIND, userId, brandId, subject }))) return false;
  const mail = renderCriticalEmail(what, locale);
  const sent = await sendEmail({ to: [address], subject: mail.subject, html: mail.html });
  if (sent) await markSent({ kind: KIND, userId, subject });
  return sent;
}

/** The people of `ids` with an address, each with their language. */
async function readers(ids) {
  if (ids.length === 0) return [];
  const languages = await uiLanguagesOf(ids);
  const out = [];
  for (const id of ids) {
    const [address] = await emailsOf([id]);
    if (address) out.push({ id, address, locale: languages.get(id) });
  }
  return out;
}

/**
 * Right away: every few minutes. Each open Critical action of the last two
 * hours goes once to each person who chose it.
 * @returns {Promise<number>} e-mails sent
 */
export async function sendCriticalActionAlerts(now = new Date()) {
  if (!emailReady()) return 0;
  let sent = 0;
  const groups = byBrand(await criticalSince(new Date(now - INSTANT_WINDOW_MS)));
  for (const group of await ofActiveWorkspaces(groups)) {
    try {
      const audience = await brandAudience(group.organizationId, group.brandId, KIND);
      for (const person of await readers(choosing(audience, 'instant'))) {
        for (const action of group.actions) {
          const ok = await sendOnce({
            userId: person.id,
            brandId: group.brandId,
            subject: `action:${action.id}`,
            locale: person.locale,
            what: { brand: group.brand, actions: [action] },
            address: person.address,
          });
          if (ok) sent += 1;
        }
      }
    } catch (err) {
      logger.error(
        { err, brandId: group.brandId },
        '[notifications] critical alerts failed for a brand',
      );
    }
  }
  return sent;
}

/**
 * Daily summary: once a day, the last day's open Critical actions of each
 * brand to each person who chose it, one e-mail per brand.
 * @returns {Promise<number>} e-mails sent
 */
export async function sendCriticalActionSummaries(now = new Date()) {
  if (!emailReady()) return 0;
  let sent = 0;
  const day = dayKey(now);
  const groups = byBrand(await criticalSince(new Date(now - 24 * 60 * 60 * 1000)));
  for (const group of await ofActiveWorkspaces(groups)) {
    try {
      const audience = await brandAudience(group.organizationId, group.brandId, KIND);
      for (const person of await readers(choosing(audience, 'daily'))) {
        const ok = await sendOnce({
          userId: person.id,
          brandId: group.brandId,
          subject: `daily:${day}:${group.brandId}`,
          locale: person.locale,
          what: group,
          address: person.address,
        });
        if (ok) sent += 1;
      }
    } catch (err) {
      logger.error(
        { err, brandId: group.brandId },
        '[notifications] critical summary failed for a brand',
      );
    }
  }
  return sent;
}
