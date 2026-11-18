import logger from '../logger.js';
import { slackGet } from './api.js';
import { agentPlanMessage } from './blocks/agent-plan.js';
import { brandSlack } from './connection.js';
import { deliverToSlack } from './deliver.js';
import { namesOf, slackUserOf } from './needs-you.js';

/**
 * An AEO Operator's summary in the brand's Slack channel (AEO Operator plan
 * §4.2 step 7), for the people who chose Inbox + Slack in "Notify me when an
 * agent needs me" (chat_user_prefs.notify_via, 00408), as an agent's "needs
 * you" goes (needs-you.js): the plan's brand's channel gets one message that
 * mentions them (their Slack account found by their e-mail), else names
 * them. It follows the brand's "An agent needs you" switch, and is kept in
 * slack_posts as that kind (00515 allows no other): once per plan and
 * person (its dedupe key). Posted through deliver.js, which checks the
 * brand's Slack, the plan and its connector; the caller
 * (chat-notices/agent-plan.js) has already kept the people who can see the
 * brand.
 *
 * The people it posted for, as a Set: the others (a brand that doesn't post
 * them, a post that failed) get the e-mail instead. Never throws.
 */

/**
 * @param {{ brand: { id: string, organization_id: string, name: string, is_demo?: boolean },
 *   planId: string, operator: string, day: string, summary: object, chatUrl: string,
 *   chatUrlOf: (chatId: string) => string, approveAllUrl: string, people: string[] }} input
 * @param {{ deliver?: typeof deliverToSlack, emailOf: (id: string) => Promise<string|null>,
 *   get?: typeof slackGet }} deps
 * @returns {Promise<Set<string>>}
 */
export async function postAgentPlan(
  { brand, planId, operator, day, summary, chatUrl, chatUrlOf, approveAllUrl, people },
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
        dedupeKey: `agent_plan:${planId}:${id}`,
        message: agentPlanMessage({
          operator,
          brand: brand.name,
          day,
          person: { name: names.get(id) ?? null, slackId },
          summary,
          chatUrl,
          chatUrlOf,
          approveAllUrl,
        }),
      });
      // Posted now, or already for this plan: no e-mail.
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
      '[slack] Operator summary post failed',
    );
  }
  return posted;
}
