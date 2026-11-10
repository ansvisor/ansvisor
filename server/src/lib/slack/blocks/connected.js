/**
 * Slack messages are worded here, on the server, as the Pulse and "needs
 * you" e-mails are (owner, 2026-11-10): Block Kit blocks and the plain text
 * Slack shows in a notification. Pure.
 */

/** Text for Slack's mrkdwn: the three characters Slack reads as markup, escaped. */
export function mrkdwn(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send a test message (Settings › Integrations): says the brand's channel is
 * set, and what will come to it.
 * @param {{ brand: string, by: string|null }} input the brand's name, and who sent it
 */
export function connectedMessage({ brand, by }) {
  const text = `Ansvisor is connected. ${brand}’s Daily Pulse, drops, daily suggestion and agents that need someone will be posted here.`;
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
