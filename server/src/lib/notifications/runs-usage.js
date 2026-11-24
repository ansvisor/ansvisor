import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { sendEmail } from '../email.js';
import { translator, uiLanguagesOf } from '../i18n.js';
import { aiBudgetOf, getAiUsage } from '../plan-guard.js';
import { isCloud } from '../../config/plans.js';
import { emailsOf } from '../pulse/audience.js';
import { KIND_DEFAULTS, brandAudience, ofActiveWorkspaces } from './choices.js';
import { claimSend, dayKey, markSent } from './sends.js';
import { appOrigin, notificationHtml } from './email-shell.js';

/**
 * Two e-mails (Settings › Notifications), in each reader's language, each
 * once (notification_sends, 00556):
 *
 *   * run_finished, "Run finished": an agent's run that acted as the person
 *     ended (done, failed or stopped), with the agent, how it ended and a
 *     link to its chat; Right away or in the day's summary, for a brand they
 *     may still see. Off by default.
 *   * ai_usage, "AI usage", Admins: the workspace reached 80%, then 100%, of
 *     its monthly AI limit; once per threshold and month. On by default;
 *     never for an unlimited plan, a limit of 0 or a workspace not active.
 */

export const RUN_KIND = 'run_finished';
export const USAGE_KIND = 'ai_usage';

/** A run that ended: done, failed or stopped. */
const ENDED = ['done', 'failed', 'stopped'];

/** How far back Right away looks: older runs never mail. */
export const INSTANT_WINDOW_MS = 2 * 60 * 60 * 1000;

/** The shares of the monthly AI limit an Admin is told of. */
export const THRESHOLDS = [80, 100];

const DAY_MS = 24 * 60 * 60 * 1000;
const MISSING_TABLE = new Set(['42P01', 'PGRST205']);

const emailReady = () => !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL;

// ─── Run finished ───────────────────────────────────────────────────────────

/** Runs that ended since `since`, with their agent, brand and chat. */
async function endedSince(since) {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select(
      'id, organization_id, brand_id, acting_user_id, status, finished_at, chat_agents(name), brands!inner(name)',
    )
    .in('status', ENDED)
    .not('acting_user_id', 'is', null)
    .gte('finished_at', since.toISOString())
    // Nobody is mailed about a demo brand, or one turned off.
    .eq('brands.is_demo', false)
    .eq('brands.is_active', true)
    .order('finished_at', { ascending: true });
  if (error) throw new Error(`chat_agent_runs: ${error.message}`);
  const runs = data ?? [];
  if (runs.length === 0) return runs;
  const { data: chats, error: chatError } = await supabaseAdmin
    .from('chat_conversations')
    .select('id, agent_run_id')
    .in(
      'agent_run_id',
      runs.map((run) => run.id),
    );
  if (chatError) throw new Error(`chat_conversations: ${chatError.message}`);
  const chatOf = new Map((chats ?? []).map((chat) => [chat.agent_run_id, chat.id]));
  return runs.map((run) => ({ ...run, chatId: chatOf.get(run.id) ?? null }));
}

/**
 * @param {{ brand: string, runs: Array<{ status: string, chatId: string|null, chat_agents?: { name: string }|null }> }} what
 * @param {string} locale
 */
export function renderRunsEmail({ brand, runs }, locale) {
  const t = translator(locale);
  const count = runs.length;
  const nameOf = (run) => run.chat_agents?.name || t('notifications.runs.deletedAgent');
  const statusOf = (run) => t(`notifications.runs.status.${run.status}`);
  const items = runs.map((run) =>
    t('notifications.runs.item', { agent: nameOf(run), status: statusOf(run) }),
  );
  const one = count === 1 ? runs[0] : null;
  const url =
    one?.chatId != null
      ? `${appOrigin()}/dashboard/chat/${one.chatId}`
      : `${appOrigin()}/dashboard/agents`;
  return {
    subject: one
      ? t('notifications.runs.subjectOne', { brand, agent: nameOf(one), status: statusOf(one) })
      : t('notifications.runs.subjectMany', { brand, count }),
    html: notificationHtml({
      title: t('notifications.runs.title', { count }),
      lines: [t('notifications.runs.line', { brand, count })],
      items,
      button: { label: t('notifications.runs.button', { count }), url },
      why: t('notifications.runs.why'),
      change: t('notifications.change'),
    }),
  };
}

/** Each person's ended runs per brand: "<user>|<brand>" → { userId, brandId, organizationId, brand, runs }. */
function byPersonAndBrand(runs) {
  const groups = new Map();
  for (const run of runs) {
    if (!run.brand_id) continue;
    const key = `${run.acting_user_id}|${run.brand_id}`;
    const group = groups.get(key) ?? {
      userId: run.acting_user_id,
      brandId: run.brand_id,
      organizationId: run.organization_id,
      brand: run.brands.name,
      runs: [],
    };
    group.runs.push(run);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function sendRuns(runs, choice, day) {
  let sent = 0;
  for (const group of await ofActiveWorkspaces(byPersonAndBrand(runs))) {
    try {
      const audience = await brandAudience(group.organizationId, group.brandId, RUN_KIND);
      if (audience.get(group.userId) !== choice) continue;
      const [address] = await emailsOf([group.userId]);
      if (!address) continue;
      let told = group.runs;
      let subjects;
      if (day) {
        const subject = `daily:${day}:${group.brandId}`;
        if (
          !(await claimSend({
            kind: RUN_KIND,
            userId: group.userId,
            brandId: group.brandId,
            subject,
          }))
        )
          continue;
        subjects = [subject];
      } else {
        told = [];
        subjects = [];
        for (const run of group.runs) {
          const subject = `run:${run.id}`;
          if (
            await claimSend({
              kind: RUN_KIND,
              userId: group.userId,
              brandId: group.brandId,
              subject,
            })
          ) {
            told.push(run);
            subjects.push(subject);
          }
        }
        if (told.length === 0) continue;
      }
      const languages = await uiLanguagesOf([group.userId]);
      const mail = renderRunsEmail({ brand: group.brand, runs: told }, languages.get(group.userId));
      if (await sendEmail({ to: [address], subject: mail.subject, html: mail.html })) {
        for (const subject of subjects) {
          await markSent({ kind: RUN_KIND, userId: group.userId, subject });
        }
        sent += 1;
      }
    } catch (err) {
      logger.error(
        { err, brandId: group.brandId },
        '[notifications] run e-mails failed for a brand',
      );
    }
  }
  return sent;
}

/** Right away: every few minutes, the runs ended in the last two hours not yet told. */
export async function sendRunAlerts(now = new Date()) {
  if (!emailReady()) return 0;
  return sendRuns(await endedSince(new Date(now - INSTANT_WINDOW_MS)), 'instant', null);
}

/** Daily summary: once a day, the last day's runs. */
export async function sendRunSummaries(now = new Date()) {
  if (!emailReady()) return 0;
  return sendRuns(await endedSince(new Date(now - DAY_MS)), 'daily', dayKey(now));
}

// ─── AI usage ───────────────────────────────────────────────────────────────

/** The organization's Admins and whether each wants the AI usage e-mail (their choice, else on). */
async function adminsWanting(orgId) {
  const { data: admins, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', orgId)
    .eq('role', 'admin');
  if (error) throw new Error(`profiles: ${error.message}`);
  const ids = (admins ?? []).map((row) => row.id);
  if (ids.length === 0) return ids;
  const { data: rows, error: prefError } = await supabaseAdmin
    .from('notification_preferences')
    .select('user_id, frequency')
    .eq('organization_id', orgId)
    .eq('kind', USAGE_KIND)
    .is('brand_id', null);
  if (prefError && !MISSING_TABLE.has(prefError.code)) {
    throw new Error(`notification_preferences: ${prefError.message}`);
  }
  const choice = new Map((rows ?? []).map((row) => [row.user_id, row.frequency]));
  return ids.filter((id) => (choice.get(id) ?? KIND_DEFAULTS[USAGE_KIND]) === 'on');
}

/**
 * @param {{ threshold: number, resetsAt: string }} what
 * @param {string} locale
 */
export function renderUsageEmail({ threshold, resetsAt }, locale) {
  const t = translator(locale);
  const date = new Date(resetsAt).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return {
    subject: t('notifications.usage.subject', { threshold }),
    html: notificationHtml({
      title: t('notifications.usage.title', { threshold }),
      lines: [
        t(threshold >= 100 ? 'notifications.usage.lineFull' : 'notifications.usage.line', { date }),
      ],
      button: {
        label: t('notifications.usage.button'),
        url: `${appOrigin()}/dashboard/settings?tab=billing`,
      },
      why: t('notifications.usage.why'),
      change: t('notifications.change'),
    }),
  };
}

/**
 * Hourly: each workspace that reached 80% or 100% of its monthly AI limit
 * tells its Admins who want it, once per threshold and month. Reaching 100%
 * first claims 80% too, so it never comes after.
 * @returns {Promise<number>} e-mails sent
 */
export async function sendUsageAlerts() {
  if (!emailReady()) return 0;
  // Only workspaces whose plan is active or trialing: the others have no AI
  // limit to read (getAiUsage refuses them), and get no e-mail.
  let query = supabaseAdmin.from('organizations').select('id');
  if (isCloud()) query = query.in('subscription_status', ['active', 'trialing']);
  const { data: orgs, error } = await query;
  if (error) throw new Error(`organizations: ${error.message}`);
  let sent = 0;
  for (const { id: orgId } of orgs ?? []) {
    try {
      // No limit, or a limit of 0 (an override that turns AI off): nothing to
      // warn about, and 0 would read as 100% used at once.
      const { includedUsd } = await aiBudgetOf(orgId, { credits: false });
      if (includedUsd === null || !(includedUsd > 0)) continue;
      const usage = await getAiUsage(orgId);
      if (usage.unlimited || usage.percentUsed == null) continue;
      const reached = THRESHOLDS.filter((threshold) => usage.percentUsed >= threshold);
      if (reached.length === 0) continue;
      const top = reached.at(-1);
      const admins = await adminsWanting(orgId);
      const languages = await uiLanguagesOf(admins);
      for (const userId of admins) {
        const [address] = await emailsOf([userId]);
        if (!address) continue;
        const subjectOf = (threshold) => `usage:${usage.periodStart.slice(0, 10)}:${threshold}`;
        for (const lower of reached.slice(0, -1)) {
          await claimSend({ kind: USAGE_KIND, userId, subject: subjectOf(lower) });
        }
        const subject = subjectOf(top);
        if (!(await claimSend({ kind: USAGE_KIND, userId, subject }))) continue;
        const mail = renderUsageEmail(
          { threshold: top, resetsAt: usage.periodEnd },
          languages.get(userId),
        );
        if (await sendEmail({ to: [address], subject: mail.subject, html: mail.html })) {
          await markSent({ kind: USAGE_KIND, userId, subject });
          sent += 1;
        }
      }
    } catch (err) {
      logger.error({ err, orgId }, '[notifications] AI usage e-mail failed for a workspace');
    }
  }
  return sent;
}
