import supabaseAdmin from '../../config/supabase.js';
import logger from '../logger.js';
import { slackGet } from './api.js';
import { slackApprovalsReady, slackCard } from './approvals.js';
import { needsYouMessage } from './blocks/needs-you.js';
import { brandSlack } from './connection.js';
import { deliverToSlack, slackAllowed } from './deliver.js';

/**
 * "An agent needs you" in the brand's Slack channel (#2139, N6), for the
 * people who chose Inbox + Slack (chat_user_prefs.notify_via, 00408): when
 * an agent's run waits for them, the run's brand's channel gets a message
 * that mentions them (their Slack account found by their e-mail), else
 * names them, with a link to the run. Once per run and person (its dedupe
 * key). Posted through deliver.js, which checks the brand's Slack, the plan
 * and its connector; the caller (chat-notices/needs-you.js) has already
 * kept the people who can see the brand. It says what the card asks (the
 * web reads it), and with Approve and Reject when the card can be decided
 * from Slack, this server takes Slack's clicks and the plan has
 * slack_approvals (approvals.js, N7).
 *
 * The people it posted for, as a Set: the others (a brand that doesn't post
 * them, a post that failed) get the e-mail instead. Never throws.
 */

/** The person's Slack user in the brand's workspace, by e-mail; null when not found. */
export async function slackUserOf(slack, email, { get = slackGet } = {}) {
  if (!email) return null;
  try {
    const data = await get(slack, 'users.lookupByEmail', { email });
    return typeof data?.user?.id === 'string' ? data.user.id : null;
  } catch (err) {
    // users_not_found is the usual answer; a code only either way.
    if (err?.code !== 'users_not_found') {
      logger.warn({ code: err?.code ?? null }, '[slack] person not looked up');
    }
    return null;
  }
}

/** People's names by id. */
export async function namesOf(ids) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.id, p.full_name?.trim() || null]));
}

/** The card the run waits on, and whether its message gets Approve and Reject. */
async function cardOf(brand, runId, { card, allowed }) {
  try {
    const waiting = await card({
      organizationId: brand.organization_id,
      brandId: brand.id,
      agentRunId: runId,
    });
    if (waiting?.state !== 'waiting') return { card: null, buttons: false };
    const buttons =
      waiting.fromSlack === true &&
      slackApprovalsReady() &&
      (await allowed(brand.organization_id, 'slack_approvals'));
    return { card: waiting, buttons };
  } catch (err) {
    logger.warn({ brandId: brand.id, code: err?.code ?? null }, '[slack] card not read');
    return { card: null, buttons: false };
  }
}

/**
 * @param {{ brand: { id: string, organization_id: string, name: string, is_demo?: boolean },
 *   runId: string, agent: string, runUrl: string, people: string[] }} input
 * @param {{ deliver?: typeof deliverToSlack, emailOf: (id: string) => Promise<string|null>,
 *   get?: typeof slackGet, card?: typeof slackCard, allowed?: typeof slackAllowed }} deps
 * @returns {Promise<Set<string>>}
 */
export async function postNeedsYou(
  { brand, runId, agent, runUrl, people },
  { deliver = deliverToSlack, emailOf, get = slackGet, card = slackCard, allowed = slackAllowed },
) {
  const posted = new Set();
  try {
    const slack = await brandSlack(brand.id);
    if (slack?.status !== 'connected' || !slack.settings.channel || !slack.settings.send.needsYou) {
      return posted;
    }
    const waiting = await cardOf(brand, runId, { card, allowed });
    const names = await namesOf(people);
    for (const id of people) {
      const slackId = await slackUserOf(slack, await emailOf(id), { get });
      const outcome = await deliver({
        brand,
        kind: 'needs_you',
        dedupeKey: `needs_you:${runId}:${id}`,
        message: ({ postId }) =>
          needsYouMessage({
            agent,
            brand: brand.name,
            person: { name: names.get(id) ?? null, slackId },
            runUrl,
            card: waiting.card,
            buttons: waiting.buttons ? { postId } : null,
          }),
      });
      // Posted now, or already for this run: no e-mail.
      if (
        outcome.status === 'sent' ||
        (outcome.status === 'skipped' && outcome.reason === 'already_sent')
      ) {
        posted.add(id);
      }
    }
  } catch (err) {
    logger.error(
      { brandId: brand.id, err: { name: err?.name, code: err?.code ?? null } },
      '[slack] needs-you post failed',
    );
  }
  return posted;
}
