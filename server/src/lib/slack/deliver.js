import supabaseAdmin from '../../config/supabase.js';
import { getPlan, hasFeature, isCloud, isSubscriptionActive } from '../../config/plans.js';
import { isSlackConfigured } from '../composio.js';
import { logger } from '../logger.js';
import { applyPlanOverrides } from '../plan-guard.js';
import { CHANNEL_CODES, REFUSED_CODES, SlackError, slackPost } from './api.js';
import { brandSlack, markRefused, saveSettings, seesBrand } from './connection.js';

/**
 * Posting one message to a brand's Slack channel (#2139): the Daily Pulse
 * now, the drop alerts, the daily suggestion and "an agent needs you" as they
 * arrive. Every message goes through here, so each is posted only when:
 *
 *   * Slack is set up on this server, and the brand isn't the demo brand;
 *   * the brand uses a connected workspace, has picked a channel, and has
 *     this kind turned on (brand_integrations.settings.send);
 *   * the workspace's plan has Slack notifications, active or in its trial
 *     (every paid plan; self-host always);
 *   * the person who connected the workspace can still see the brand
 *     (owner, 2026-11-10);
 *   * it wasn't posted before: it is kept in slack_posts (00515) first,
 *     unique per brand and dedupe key.
 *
 * Slack takes about one message a second per channel: posts from this server
 * to one channel are spaced by CHANNEL_GAP_MS. A post that fails is tried
 * once more when it may pass then (a 429 after Slack's Retry-After, up to
 * MAX_RETRY_AFTER_S; a 5xx, a timeout or a lost call after RETRY_DELAY_MS).
 * Slack refusing the workspace marks it so its card asks to reconnect; a
 * channel that is gone, or that the app is no longer in, is cleared so the
 * card asks for another. Logs carry the brand, the kind and codes only,
 * never a message's words or a channel's name.
 *
 * Never throws: the job that called it goes on. The outcome:
 * `{ status: 'sent' | 'skipped' | 'failed', reason?, code? }`.
 */

/** The send switch each kind follows (connection.js SEND_KINDS). */
export const SEND_KEY = Object.freeze({
  pulse: 'pulse',
  drop: 'drops',
  suggestion: 'suggestion',
  needs_you: 'needsYou',
});

export const CHANNEL_GAP_MS = 1100;
export const RETRY_DELAY_MS = 2000;
export const MAX_RETRY_AFTER_S = 30;

/** Failures a second try may get past. */
const RETRYABLE = new Set([
  'ratelimited',
  'slack_unavailable',
  'timeout',
  'composio_failed',
  'bad_response',
]);

/** Postgres' code for a missing table, PostgREST's for one not in its cache; a duplicate key. */
const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST204']);
const DUPLICATE = '23505';
let warnedNotMigrated = false;

/** When this server last posted to each channel, or will: spacing posts per channel. */
const channelSlots = new Map();

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the channel's next slot on this server, and takes it. */
async function spaced(channelId, { now, sleep }) {
  const at = now();
  const next = Math.max(at, (channelSlots.get(channelId) ?? -Infinity) + CHANNEL_GAP_MS);
  channelSlots.set(channelId, next);
  if (next > at) await sleep(next - at);
}

/** For tests: forget the channels' slots. */
export function resetChannelSlots() {
  channelSlots.clear();
}

/** Whether the organization's plan has Slack notifications now (every paid plan; self-host). */
export async function slackAllowed(organizationId) {
  if (!isCloud()) return true;
  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('plan, subscription_status, plan_overrides')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!org || !isSubscriptionActive(org.subscription_status)) return false;
  return hasFeature(applyPlanOverrides(getPlan(org.plan), org), 'slack_notifications');
}

/** Keeps the message before it is sent: its row's id, or null when it was kept already. */
async function claim(row) {
  const { data, error } = await supabaseAdmin.from('slack_posts').insert(row).select('id').single();
  if (error?.code === DUPLICATE) return null;
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data.id;
}

async function settle(id, fields) {
  const { error } = await supabaseAdmin.from('slack_posts').update(fields).eq('id', id);
  if (error) throw new Error(error.message);
}

/** How long to wait before the one retry, or null when it isn't worth one. */
function retryDelay(err) {
  if (!(err instanceof SlackError) || !RETRYABLE.has(err.code)) return null;
  if (err.code === 'ratelimited') {
    const seconds = err.retryAfter ?? 1;
    return seconds > MAX_RETRY_AFTER_S ? null : seconds * 1000;
  }
  return RETRY_DELAY_MS;
}

/** Keeps the card true after Slack's refusal: a refused workspace, a channel that is gone. */
async function afterRefusal(code, slack, brandId) {
  if (REFUSED_CODES.has(code)) await markRefused(slack.accountId);
  else if (CHANNEL_CODES.has(code)) {
    await saveSettings(brandId, { ...slack.settings, channel: null });
  }
}

/**
 * Posts one message to the brand's channel, once.
 * @param {{
 *   brand: { id: string, organization_id: string, is_demo?: boolean },
 *   kind: 'pulse' | 'drop' | 'suggestion' | 'needs_you',
 *   dedupeKey: string,
 *   message: { text: string, blocks?: object[] } | (() => { text: string, blocks?: object[] }),
 * }} input `message`, or a function making it once every check above has passed
 * @param {{ post?: typeof slackPost, now?: () => number, sleep?: (ms: number) => Promise<void> }} [deps]
 */
export async function deliverToSlack(
  { brand, kind, dedupeKey, message },
  { post = slackPost, now = Date.now, sleep = realSleep } = {},
) {
  const log = { brandId: brand.id, kind };
  try {
    if (brand.is_demo) return { status: 'skipped', reason: 'demo_brand' };
    if (!isSlackConfigured()) return { status: 'skipped', reason: 'not_configured' };
    const slack = await brandSlack(brand.id);
    if (!slack) return { status: 'skipped', reason: 'not_connected' };
    if (slack.status !== 'connected' || !slack.composioAccountId) {
      return {
        status: 'skipped',
        reason: slack.status === 'auth_failed' ? 'refused' : 'not_connected',
      };
    }
    if (!slack.settings.send[SEND_KEY[kind]]) return { status: 'skipped', reason: 'off' };
    const channel = slack.settings.channel;
    if (!channel) return { status: 'skipped', reason: 'no_channel' };
    if (!(await slackAllowed(brand.organization_id))) return { status: 'skipped', reason: 'plan' };
    if (!(await seesBrand(brand, slack.connectedBy))) {
      return { status: 'skipped', reason: 'access_lost' };
    }

    let id;
    try {
      id = await claim({
        organization_id: brand.organization_id,
        brand_id: brand.id,
        account_id: slack.accountId,
        kind,
        dedupe_key: dedupeKey,
        channel_id: channel.id,
        status: 'sending',
      });
    } catch (err) {
      if (!NOT_MIGRATED.has(err.code)) throw err;
      if (!warnedNotMigrated) {
        warnedNotMigrated = true;
        logger.warn(
          { code: err.code, migration: '00515' },
          '[slack] slack_posts is missing: nothing is posted to Slack until 00515 is applied',
        );
      }
      return { status: 'skipped', reason: 'not_migrated' };
    }
    if (!id) return { status: 'skipped', reason: 'already_sent' };
    let body;
    try {
      body = typeof message === 'function' ? message() : message;
    } catch (err) {
      await settle(id, { status: 'failed', error_code: 'render_failed', attempts: 0 });
      throw err;
    }

    for (let attempt = 1; ; attempt++) {
      await spaced(channel.id, { now, sleep });
      try {
        const data = await post(slack, 'chat.postMessage', {
          channel: channel.id,
          ...body,
          unfurl_links: false,
          unfurl_media: false,
        });
        await settle(id, {
          status: 'sent',
          message_ts: data.ts,
          sent_at: new Date(now()).toISOString(),
          attempts: attempt,
          error_code: null,
        });
        return { status: 'sent', ts: data.ts };
      } catch (err) {
        const code = err instanceof SlackError ? err.code : 'error';
        const wait = attempt === 1 ? retryDelay(err) : null;
        if (wait !== null) {
          logger.info({ ...log, code, attempt }, '[slack] post failed, trying once more');
          await sleep(wait);
          continue;
        }
        logger.warn(
          { ...log, code, status: err?.status ?? null, attempts: attempt },
          '[slack] post failed',
        );
        await settle(id, { status: 'failed', error_code: code.slice(0, 100), attempts: attempt });
        await afterRefusal(code, slack, brand.id);
        return { status: 'failed', code };
      }
    }
  } catch (err) {
    logger.error(
      { ...log, err: { name: err?.name, code: err?.code ?? null } },
      '[slack] delivery failed',
    );
    return { status: 'failed', code: 'error' };
  }
}
