import { mrkdwn } from './format.js';

/** What each kind is called in the test message. */
const KIND_WORDS = {
  pulse: 'Daily Pulse',
  drops: 'drop alerts',
  suggestion: 'daily suggestion',
  needsYou: 'messages for agents that need someone',
};

/** "a", "a and b", "a, b and c". */
function listOf(words) {
  return words.length < 2
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * Send a test message (Settings › Integrations): says the brand's channel is
 * set, and what will come to it: the kinds Ansvisor posts that the brand has
 * on (connection.js POSTED_KINDS).
 * @param {{ brand: string, by: string|null, kinds: string[] }} input the brand's name, who
 *   sent it, and the kinds it will get
 */
export function connectedMessage({ brand, by, kinds }) {
  const words = kinds.map((kind) => KIND_WORDS[kind]).filter(Boolean);
  const text = words.length
    ? `Ansvisor is connected. ${brand}’s ${listOf(words)} will be posted here.`
    : `Ansvisor is connected. Nothing is turned on for ${brand} yet: choose what to post in Settings › Integrations.`;
  return {
    text: mrkdwn(text),
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
