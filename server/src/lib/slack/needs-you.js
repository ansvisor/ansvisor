import supabaseAdmin from '../../config/supabase.js';
import logger from '../logger.js';
import { slackGet } from './api.js';
import { needsYouMessage } from './blocks/needs-you.js';
import { brandSlack } from './connection.js';
import { deliverToSlack } from './deliver.js';

/**
 * "An agent needs you" in the brand's Slack channel (#2139, N6), for the
 * people who chose Inbox + Slack (chat_user_prefs.notify_via, 00408): when
 * an agent's run waits for them, the run's brand's channel gets a message
 * that mentions them (their Slack account found by their e-mail), else
 * names them, with a link to the run. Once per run and person (its dedupe
 * key). Posted through deliver.js, which checks the brand's Slack, the plan
 * and its connector; the caller (chat-notices/needs-you.js) has already
 * kept the people who can see the brand.
 *
 * The people it posted for, as a Set: the others (a brand that doesn't post
 * them, a post that failed) get the e-mail instead. Never throws.
 */

/** The person's Slack user in the brand's workspace, by e-mail; null when not found. */
async function slackUserOf(slack, email, { get = slackGet } = {}) {
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
async function namesOf(ids) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.id, p.full_name?.trim() || null]));
}

/**
 * @param {{ brand: { id: string, organization_id: string, name: string, is_demo?: boolean },
 *   runId: string, agent: string, runUrl: string, people: string[] }} input
 * @param {{ deliver?: typeof deliverToSlack, emailOf: (id: string) => Promise<string|null>,
 *   get?: typeof slackGet }} deps
 * @returns {Promise<Set<string>>}
 */
export async function postNeedsYou(
  { brand, runId, agent, runUrl, people },
  { deliver = deliverToSlack, emailOf, get = slackGet },
) {
  const posted = new Set();
  try {
    const slack = await brandSlack(brand.id);
    if (slack?.status !== 'connected' || !slack.settings.channel || !slack.settings.send.needsYou) {
      return posted;
    }
    const names = await namesOf(people);
    for (const id of people) {
      const slackId = await slackUserOf(slack, await emailOf(id), { get });
      const outcome = await deliver({
        brand,
        kind: 'needs_you',
        dedupeKey: `needs_you:${runId}:${id}`,
        message: () =>
          needsYouMessage({
            agent,
            brand: brand.name,
            person: { name: names.get(id) ?? null, slackId },
            runUrl,
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
