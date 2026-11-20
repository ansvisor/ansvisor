import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { sendEmail } from '../email.js';
import { formatLocale, translator, uiLanguagesOf } from '../i18n.js';
import { actionCode } from '../action-center/action-code.js';
import { emailsOf } from '../pulse/audience.js';
import { brandAudience, choosing, ofActiveWorkspaces } from './choices.js';
import { claimSend, dayKey, markSent, weekKey } from './sends.js';
import { appOrigin, notificationHtml } from './email-shell.js';

/**
 * Two Action Center e-mails (Settings › Notifications), one per brand, each
 * once (notification_sends, 00556), only for brands the person may see, in
 * their language:
 *
 *   * due_actions, "Overdue and due today": the open actions assigned to the
 *     person whose due date is today or past, daily or on Mondays as they
 *     chose (Weekly by default); nothing when none.
 *   * weekly_actions, "Weekly action summary", Mondays: the brand's last
 *     seven days, what was completed, what's open and the next three by
 *     priority (on by default); nothing for a brand with no action at all.
 */

export const DUE_KIND = 'due_actions';
export const WEEKLY_KIND = 'weekly_actions';

/** Still to be done (decision D6: on hold counts as open). */
const OPEN = ['new', 'in_progress', 'on_hold'];

/** The next actions a weekly e-mail names. */
export const NEXT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

const emailReady = () => !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL;

const actionUrl = (id) => `${appOrigin()}/dashboard/action-center/actions?action=${id}`;
const actionsUrl = () => `${appOrigin()}/dashboard/action-center/actions`;

const monthDay = (day, locale) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(formatLocale(locale), {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** Days from `due` (a date) to `today` (a date): 0 due today, more when late. */
const daysLate = (due, today) =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / DAY_MS);

/** PostgREST answers at most this many rows a request: longer reads go page by page. */
const PAGE = 1000;

/** Every row of a query, page by page (`query` builds it afresh for each page). */
async function allRows(query, what) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query().range(from, from + PAGE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

/** Each brand of `rows`: brand id → { brandId, brand, organizationId, rows }. */
function byBrand(rows) {
  const brands = new Map();
  for (const row of rows) {
    const group = brands.get(row.brand_id) ?? {
      brandId: row.brand_id,
      brand: row.brands.name,
      organizationId: row.brands.organization_id,
      rows: [],
    };
    group.rows.push(row);
    brands.set(row.brand_id, group);
  }
  return [...brands.values()];
}

/** The periods a run sends: Daily every day; Weekly on Mondays (UTC). */
function periodsOf(now, choices) {
  const periods = [];
  if (choices.includes('daily')) periods.push({ choice: 'daily', key: `daily:${dayKey(now)}` });
  if (choices.includes('weekly') && new Date(now).getUTCDay() === 1) {
    periods.push({ choice: 'weekly', key: `weekly:${weekKey(now)}` });
  }
  return periods;
}

/** One e-mail to one person, once: claimed first, marked sent after. */
async function sendOnce({ kind, userId, brandId, subject, address, mail }) {
  if (!(await claimSend({ kind, userId, brandId, subject }))) return false;
  const sent = await sendEmail({ to: [address], subject: mail.subject, html: mail.html });
  if (sent) await markSent({ kind, userId, subject });
  return sent;
}

// ─── Overdue and due today ──────────────────────────────────────────────────

/**
 * @param {{ brand: string, actions: Array<{ id: string, action_no: number, brand_no?: number|null, category: string, due_date: string }>, today: string }} what
 * @param {string} locale
 */
export function renderDueEmail({ brand, actions, today }, locale) {
  const t = translator(locale);
  const count = actions.length;
  const late = actions.filter((a) => a.due_date < today).length;
  const items = actions.map((a) =>
    t('notifications.due.item', {
      code: actionCode(a),
      category: t(`notifications.categories.${a.category}`),
      date: monthDay(a.due_date, locale),
      late: daysLate(a.due_date, today),
    }),
  );
  return {
    subject: t('notifications.due.subject', { brand, count, late }),
    html: notificationHtml({
      title: t('notifications.due.title', { count }),
      lines: [t('notifications.due.line', { brand, count, late })],
      items,
      button: {
        label: t('notifications.due.button', { count }),
        url: count === 1 ? actionUrl(actions[0].id) : actionsUrl(),
      },
      why: t('notifications.due.why'),
      change: t('notifications.change'),
    }),
  };
}

/** Open assigned actions due today or before, with their brand, the latest due first. */
async function dueActions(today) {
  return allRows(
    () =>
      supabaseAdmin
        .from('actions')
        .select(
          'id, brand_id, action_no, brand_no, category, due_date, assignee_id, brands!inner(name, organization_id)',
        )
        .in('status', OPEN)
        .not('assignee_id', 'is', null)
        .lte('due_date', today)
        // Nobody is mailed about a demo brand, or one turned off.
        .eq('brands.is_demo', false)
        .eq('brands.is_active', true)
        .order('due_date', { ascending: true })
        .order('id', { ascending: true }),
    'actions',
  );
}

/**
 * Daily for Daily summary; on Mondays also for Weekly summary.
 * @returns {Promise<number>} e-mails sent
 */
export async function sendDueActions(now = new Date()) {
  if (!emailReady()) return 0;
  const today = dayKey(now);
  let sent = 0;
  for (const group of await ofActiveWorkspaces(byBrand(await dueActions(today)))) {
    try {
      const audience = await brandAudience(group.organizationId, group.brandId, DUE_KIND);
      const assigned = new Map();
      for (const row of group.rows) {
        assigned.set(row.assignee_id, [...(assigned.get(row.assignee_id) ?? []), row]);
      }
      const ids = [...assigned.keys()].filter((id) => audience.has(id));
      const languages = await uiLanguagesOf(ids);
      for (const id of ids) {
        const period = periodsOf(now, [audience.get(id)])[0];
        if (!period) continue;
        const [address] = await emailsOf([id]);
        if (!address) continue;
        const mail = renderDueEmail(
          { brand: group.brand, actions: assigned.get(id), today },
          languages.get(id),
        );
        const subject = `${period.key}:${group.brandId}`;
        if (
          await sendOnce({
            kind: DUE_KIND,
            userId: id,
            brandId: group.brandId,
            subject,
            address,
            mail,
          })
        ) {
          sent += 1;
        }
      }
    } catch (err) {
      logger.error(
        { err, brandId: group.brandId },
        '[notifications] due actions failed for a brand',
      );
    }
  }
  return sent;
}

// ─── Weekly action summary ──────────────────────────────────────────────────

/**
 * @param {{ brand: string, completed: number, open: number, next: Array<{ id: string, action_no: number, brand_no?: number|null, category: string }> }} what
 * @param {string} locale
 */
export function renderWeeklyEmail({ brand, completed, open, next }, locale) {
  const t = translator(locale);
  return {
    subject: t('notifications.weekly.subject', { brand }),
    html: notificationHtml({
      title: t('notifications.weekly.title', { brand }),
      lines: [
        t('notifications.weekly.line', { completed, open }),
        ...(next.length ? [t('notifications.weekly.next')] : []),
      ],
      items: next.map((a) =>
        t('notifications.weekly.item', {
          code: actionCode(a),
          category: t(`notifications.categories.${a.category}`),
        }),
      ),
      button: { label: t('notifications.weekly.button'), url: actionsUrl() },
      why: t('notifications.weekly.why'),
      change: t('notifications.change'),
    }),
  };
}

/** Each brand's open actions and those completed since `since`. */
async function weekOfActions(since) {
  return allRows(
    () =>
      supabaseAdmin
        .from('actions')
        .select(
          'id, brand_id, action_no, brand_no, category, status, priority_score, completed_at, brands!inner(name, organization_id)',
        )
        .or(`status.in.(${OPEN.join(',')}),completed_at.gte.${since}`)
        // Nobody is mailed about a demo brand, or one turned off.
        .eq('brands.is_demo', false)
        .eq('brands.is_active', true)
        .order('id', { ascending: true }),
    'actions',
  );
}

/**
 * Mondays (UTC): each brand's week to those who chose it.
 * @returns {Promise<number>} e-mails sent
 */
export async function sendWeeklyActions(now = new Date()) {
  if (!emailReady() || new Date(now).getUTCDay() !== 1) return 0;
  const since = new Date(new Date(now) - 7 * DAY_MS).toISOString();
  const key = `weekly:${weekKey(now)}`;
  let sent = 0;
  for (const group of await ofActiveWorkspaces(byBrand(await weekOfActions(since)))) {
    try {
      const open = group.rows.filter((a) => OPEN.includes(a.status));
      const what = {
        brand: group.brand,
        completed: group.rows.filter((a) => a.status === 'completed' && a.completed_at >= since)
          .length,
        open: open.length,
        next: [...open]
          .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
          .slice(0, NEXT),
      };
      const audience = await brandAudience(group.organizationId, group.brandId, WEEKLY_KIND);
      const ids = choosing(audience, 'weekly');
      const languages = await uiLanguagesOf(ids);
      for (const id of ids) {
        const [address] = await emailsOf([id]);
        if (!address) continue;
        const mail = renderWeeklyEmail(what, languages.get(id));
        const subject = `${key}:${group.brandId}`;
        if (
          await sendOnce({
            kind: WEEKLY_KIND,
            userId: id,
            brandId: group.brandId,
            subject,
            address,
            mail,
          })
        ) {
          sent += 1;
        }
      }
    } catch (err) {
      logger.error(
        { err, brandId: group.brandId },
        '[notifications] weekly actions failed for a brand',
      );
    }
  }
  return sent;
}
