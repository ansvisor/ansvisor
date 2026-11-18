import {
  childLine,
  childName,
  dayWords,
  headline,
  tally,
  totalLine,
  whyLine,
} from '../../chat-notices/plan-summary.js';
import { clip, link, mrkdwn } from './format.js';

/**
 * An AEO Operator's summary as a Slack message (AEO Operator plan §4.2 step
 * 7): the person it is for (mentioned when their Slack account was found,
 * else named), the Operator, the brand and the plan's day; each agent of
 * the plan, where it is, what it did, counted, and its AI against its
 * share, with its chat; what the plan used of the day's budget; how many
 * wait for the person, with Approve all in the Inbox where it applies; and
 * the summary in the Operator's chat. Links only: nothing here is decided
 * from Slack. Its only words not the app's own are the names of the agents
 * the person sees. Pure.
 */

/** A section's text at most (Slack takes 3,000). */
const SECTION_MAX = 2900;

/**
 * @param {{ operator: string, brand: string, day: string,
 *   person: { name: string|null, slackId: string|null },
 *   summary: ReturnType<typeof import('../../chat-notices/plan-summary.js').readPlanSummary>,
 *   chatUrl: string, chatUrlOf: (chatId: string) => string, approveAllUrl: string }} input
 */
export function agentPlanMessage({
  operator,
  brand,
  day,
  person,
  summary,
  chatUrl,
  chatUrlOf,
  approveAllUrl,
}) {
  const who = person.slackId ? `<@${person.slackId}>` : null;
  const name = person.name ?? 'its person';
  const head = headline(summary);
  const lead = `${who ? `${who} ` : ''}*${mrkdwn(operator)}* · ${mrkdwn(brand)} · ${dayWords(day)}: ${mrkdwn(head)}.`;
  const lines = summary.children.map(
    (child) =>
      `• *${mrkdwn(childName(child))}* · ${mrkdwn(childLine(child))}${
        child.chatId ? ` · ${link(chatUrlOf(child.chatId), 'Open its chat')}` : ''
      }`,
  );
  const total = totalLine(summary);
  const n = tally(summary);
  const waits = n.waiting
    ? `*Waits for you:* ${n.waiting === 1 ? '1 agent' : `${n.waiting} agents`}.${
        summary.approveAll
          ? ` Several wait on changes to the same draft: ${link(approveAllUrl, 'Approve all in the Inbox')}.`
          : ''
      }`
    : null;
  return {
    text: `${who ? `${who} ` : ''}${mrkdwn(operator)} on ${mrkdwn(brand)}: ${mrkdwn(head)}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lead } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: clip(
            [mrkdwn(whyLine(summary, { operator, brand, day })), ...lines].join('\n'),
            SECTION_MAX,
          ),
        },
      },
      ...(total || waits
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: [total && mrkdwn(total), waits].filter(Boolean).join('\n'),
              },
            },
          ]
        : []),
      { type: 'section', text: { type: 'mrkdwn', text: link(chatUrl, 'Open the summary') } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Posted because ${who ?? mrkdwn(name)} chose Inbox + Slack in their Chat settings. Once per plan.`,
          },
        ],
      },
    ],
  };
}
