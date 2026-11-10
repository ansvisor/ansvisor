import { mrkdwn } from './format.js';

/**
 * Send a test message (Settings › Integrations): says the brand's channel is
 * set, and what will come to it: the Daily Pulse for now; the drop alerts,
 * the daily suggestion and "an agent needs you" join it as they arrive.
 * @param {{ brand: string, by: string|null }} input the brand's name, and who sent it
 */
export function connectedMessage({ brand, by }) {
  const text = `Ansvisor is connected. ${brand}’s Daily Pulse will be posted here.`;
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: mrkdwn(text) } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: by
              ? `Sent by ${mrkdwn(by)} from Settings › Integrations`
              : 'Sent from Settings › Integrations',
          },
        ],
      },
    ],
  };
}
