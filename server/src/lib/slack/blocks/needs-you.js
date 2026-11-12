import { link, mrkdwn } from './format.js';

/**
 * "An agent needs you" as a Slack message (#2139, N6): the agent, the
 * person it waits for (mentioned when their Slack account was found, else
 * named), the brand, and a link to the run. Approve and Skip from Slack come
 * later; this one opens the run in Chat. Pure.
 */

/**
 * @param {{ agent: string, brand: string, person: { name: string|null, slackId: string|null },
 *   runUrl: string }} input
 */
export function needsYouMessage({ agent, brand, person, runUrl }) {
  const who = person.slackId ? `<@${person.slackId}>` : null;
  const name = person.name ?? 'its person';
  const lead = who
    ? `${who} *${mrkdwn(agent)}* needs you on ${mrkdwn(brand)}.`
    : `*${mrkdwn(agent)}* needs ${mrkdwn(name)} on ${mrkdwn(brand)}.`;
  return {
    text: who
      ? `${who} ${mrkdwn(agent)} needs you on ${mrkdwn(brand)}`
      : `${mrkdwn(agent)} needs ${mrkdwn(name)} on ${mrkdwn(brand)}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lead } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'It stopped to ask something or to wait for an OK on a change. Nothing was changed or sent while it waits.',
        },
      },
      { type: 'section', text: { type: 'mrkdwn', text: link(runUrl, 'Open the run') } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Posted because ${who ?? mrkdwn(name)} chose Inbox + Slack in their Chat settings. Once per run.`,
          },
        ],
      },
    ],
  };
}
