import { clip, link, mrkdwn } from './format.js';

/**
 * The daily suggestion as a Slack message (#2139, N5): the action the
 * brand's people were suggested today, its title and description as the
 * Action Center words them (the web's actionTexts), its priority, how long
 * it has waited, its category, and a link to it. Pure.
 */

const capital = (word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : '');

/**
 * @param {{ brandName: string, actionId: string, words: { title: string, description: string },
 *   priorityLevel: string|null, category: string|null, waitDays: number, appUrl: string }} input
 */
export function suggestionMessage({
  brandName,
  actionId,
  words,
  priorityLevel,
  category,
  waitDays,
  appUrl,
}) {
  const title = clip(words.title, 300);
  const facts = [
    ...(priorityLevel ? [`${capital(priorityLevel)} priority`] : []),
    waitDays === 1 ? 'waiting 1 day' : `waiting ${waitDays} days`,
    ...(category ? [capital(category)] : []),
  ];
  return {
    text: `Today’s suggestion for ${mrkdwn(brandName)}: ${mrkdwn(title)}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: clip(`Today’s suggestion for ${brandName}`, 150) },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: clip(
            `> *${mrkdwn(title)}*${words.description ? `\n> ${mrkdwn(words.description)}` : ''}`,
            2900,
          ),
        },
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: mrkdwn(facts.join(' · ')) }] },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: link(
            `${appUrl}/dashboard/action-center/actions?action=${encodeURIComponent(actionId)}`,
            'Open in Action Center',
          ),
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Sent by Ansvisor because the daily suggestion is on for ${mrkdwn(brandName)}, and this channel gets it.`,
          },
        ],
      },
    ],
  };
}
