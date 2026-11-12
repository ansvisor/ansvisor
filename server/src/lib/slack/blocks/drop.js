import { platformLabel } from '../../pulse/format.js';
import { link, mrkdwn } from './format.js';

/**
 * A drop alert as a Slack message (#2139, N4): which rate fell, from what to
 * what, how far normal swing goes for these prompts, over which days and
 * engines, with "Ask Chat why" (when the new Chat is on for the workspace)
 * and Visibility. Pure.
 */

const WORDS = {
  visibility: {
    name: 'visibility',
    title: 'Visibility',
    of: 'of prompts',
    question: 'Why did my visibility drop last week?',
  },
  citations: {
    name: 'citation rate',
    title: 'Citation rate',
    of: 'of answers',
    question: 'Why did my citations drop last week?',
  },
};

const pct = (value) => `${Math.round(value * 10) / 10}%`;
const pts = (value) => `${Math.round(Math.abs(value) * 10) / 10} pts`;
const day = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
const range = ({ from, to }) => `${day(from)}–${day(to)}`;

/**
 * @param {{ brandName: string, drop: { metric: string, from: number, to: number, delta: number,
 *   se: number, prompts: number, platforms: string[] }, periods: { a: object, b: object },
 *   appUrl: string, askChat: boolean, nextAfter: string }} input
 */
export function dropMessage({ brandName, drop, periods, appUrl, askChat, nextAfter }) {
  const words = WORDS[drop.metric];
  const text = `${mrkdwn(brandName)}’s ${words.name} fell more than usual: ${pct(drop.from)} → ${pct(drop.to)} (−${pts(drop.delta)}), the last 7 days against the 7 before`;
  const links = [
    ...(askChat
      ? [
          link(
            `${appUrl}/dashboard/chat?${new URLSearchParams({ compose: words.question })}`,
            'Ask Chat why',
          ),
        ]
      : []),
    link(`${appUrl}/dashboard/insights`, 'Open Visibility'),
  ];
  const engines = drop.platforms.map(platformLabel).join(', ');
  return {
    text,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🔻 ${brandName}’s ${words.name} fell more than usual`.slice(0, 150),
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${words.title} went from *${pct(drop.from)}* to *${pct(drop.to)}* ${words.of} (−${pts(drop.delta)}), the last 7 days against the 7 before. Normal swing for these prompts is about ±${pts(2 * drop.se)}, so this is beyond it.`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: mrkdwn(
              [
                `Prompts tracked in both weeks only (${drop.prompts})`,
                ...(engines ? [engines] : []),
                `${range(periods.b)} against ${range(periods.a)}`,
              ].join(' · '),
            ),
          },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: links.join('  ·  ') } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `No other ${words.name} alert for ${mrkdwn(brandName)} before ${day(nextAfter)}.`,
          },
        ],
      },
    ],
  };
}
