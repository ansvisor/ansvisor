import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { sendEmail } from '../email.js';
import { translator, uiLanguagesOf } from '../i18n.js';
import { emailsOf } from '../pulse/audience.js';
import { brandAudience, choosing, ofActiveWorkspaces } from './choices.js';
import { claimSend, dayKey, markSent, weekKey } from './sends.js';
import { appOrigin, notificationHtml } from './email-shell.js';

/**
 * "Drafts waiting for your review" (Settings › Notifications, drafts_review):
 * a brand's Content drafts in review (content_drafts.status in_review, from
 * any source, as Library › In review lists them) in one e-mail per brand,
 * daily or on Mondays, as each person chose (Weekly by default). Nothing goes
 * when no draft waits. Each person sees only the brands they may see, and
 * gets each e-mail once (notification_sends, 00556).
 */

export const KIND = 'drafts_review';

/** The drafts an e-mail names; the rest are counted. */
export const LISTED = 10;

const emailReady = () => !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL;

/** Each brand with drafts in review: brand id → { brand, organizationId, drafts (newest first) }. */
async function waitingByBrand() {
  const { data, error } = await supabaseAdmin
    .from('content_drafts')
    .select('id, brand_id, title, updated_at, brands!inner(name, organization_id)')
    .eq('status', 'in_review')
    // Nobody is mailed about a demo brand, or one turned off.
    .eq('brands.is_demo', false)
    .eq('brands.is_active', true)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`content_drafts: ${error.message}`);
  const brands = new Map();
  for (const row of data ?? []) {
    const group = brands.get(row.brand_id) ?? {
      brandId: row.brand_id,
      brand: row.brands.name,
      organizationId: row.brands.organization_id,
      drafts: [],
    };
    group.drafts.push(row);
    brands.set(row.brand_id, group);
  }
  return [...brands.values()];
}

/**
 * @param {{ brand: string, drafts: Array<{ title: string }> }} what
 * @param {string} locale
 */
export function renderDraftsEmail({ brand, drafts }, locale) {
  const t = translator(locale);
  const count = drafts.length;
  const items = drafts
    .slice(0, LISTED)
    .map((draft) => draft.title?.trim() || t('notifications.drafts.untitled'));
  if (count > LISTED) items.push(t('notifications.drafts.more', { count: count - LISTED }));
  return {
    subject: t('notifications.drafts.subject', { brand, count }),
    html: notificationHtml({
      title: t('notifications.drafts.title', { count }),
      lines: [t('notifications.drafts.line', { brand, count })],
      items,
      button: {
        label: t('notifications.drafts.button'),
        url: `${appOrigin()}/dashboard/content/library?tab=in_review`,
      },
      why: t('notifications.drafts.why'),
      change: t('notifications.change'),
    }),
  };
}

/**
 * Daily for those who chose Daily summary; on Mondays (UTC) also for those
 * who chose Weekly summary.
 * @returns {Promise<number>} e-mails sent
 */
export async function sendDraftsReview(now = new Date()) {
  if (!emailReady()) return 0;
  const monday = new Date(now).getUTCDay() === 1;
  const periods = [{ choice: 'daily', key: `daily:${dayKey(now)}` }];
  if (monday) periods.push({ choice: 'weekly', key: `weekly:${weekKey(now)}` });
  let sent = 0;
  for (const group of await ofActiveWorkspaces(await waitingByBrand())) {
    try {
      const audience = await brandAudience(group.organizationId, group.brandId, KIND);
      for (const { choice, key } of periods) {
        const ids = choosing(audience, choice);
        if (ids.length === 0) continue;
        const languages = await uiLanguagesOf(ids);
        for (const id of ids) {
          const subject = `${key}:${group.brandId}`;
          const [address] = await emailsOf([id]);
          if (!address) continue;
          if (!(await claimSend({ kind: KIND, userId: id, brandId: group.brandId, subject })))
            continue;
          const mail = renderDraftsEmail(group, languages.get(id));
          if (await sendEmail({ to: [address], subject: mail.subject, html: mail.html })) {
            await markSent({ kind: KIND, userId: id, subject });
            sent += 1;
          }
        }
      }
    } catch (err) {
      logger.error(
        { err, brandId: group.brandId },
        '[notifications] drafts review failed for a brand',
      );
    }
  }
  return sent;
}
