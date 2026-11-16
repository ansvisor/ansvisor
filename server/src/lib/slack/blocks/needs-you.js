import { clip, link, mrkdwn } from './format.js';

/**
 * "An agent needs you" as a Slack message (#2139, N6): the agent, the
 * person it waits for (mentioned when their Slack account was found, else
 * named), the brand, and a link to the run. With the card it waits on
 * (N7), what the card asks in its own words, cut short (the app shows the
 * rest); with `buttons`, Approve, Reject and Open in Ansvisor, which only
 * that person can use (lib/slack/approvals.js). Pure.
 */

/** The buttons' action ids, which the interactivity route takes. */
export const APPROVE_ACTION = 'ansvisor_approve';
export const REJECT_ACTION = 'ansvisor_reject';
export const OPEN_ACTION = 'ansvisor_open';

/** A button's value: its post, and the card's step and digest it was posted for. */
export const buttonValue = ({ postId, n, digest }) => `${postId}:${n}:${digest}`;

/** What a card asks, as its step says it: the change, and its target. Never more than the app shows. */
export function cardLine(card) {
  const title = clip(card?.title ?? '', 150);
  const target = clip(card?.target ?? '', 200);
  return [title && `*${mrkdwn(title)}*`, target && mrkdwn(target)].filter(Boolean).join(' · ');
}

const button = (text, extra) => ({
  type: 'button',
  text: { type: 'plain_text', text },
  ...extra,
});

/**
 * @param {{ agent: string, brand: string, person: { name: string|null, slackId: string|null },
 *   runUrl: string, card?: { kind: string|null, title: string|null, target: string|null,
 *   n: number|null, digest: string|null } | null, buttons?: { postId: string } | null }} input
 */
export function needsYouMessage({ agent, brand, person, runUrl, card = null, buttons = null }) {
  const who = person.slackId ? `<@${person.slackId}>` : null;
  const name = person.name ?? 'its person';
  const lead = who
    ? `${who} *${mrkdwn(agent)}* needs you on ${mrkdwn(brand)}.`
    : `*${mrkdwn(agent)}* needs ${mrkdwn(name)} on ${mrkdwn(brand)}.`;
  const asks = card && card.kind !== 'question' ? cardLine(card) : '';
  const decides = buttons && asks && card.n && card.digest;
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
          text: asks
            ? `Waiting for an OK on: ${asks}\nNothing was changed or sent while it waits.`
            : 'It stopped to ask something or to wait for an OK on a change. Nothing was changed or sent while it waits.',
        },
      },
      decides
        ? {
            type: 'actions',
            elements: [
              button('Approve', {
                action_id: APPROVE_ACTION,
                style: 'primary',
                value: buttonValue({ postId: buttons.postId, n: card.n, digest: card.digest }),
                confirm: {
                  title: { type: 'plain_text', text: 'Approve this step?' },
                  text: { type: 'mrkdwn', text: clip(asks, 300) },
                  confirm: { type: 'plain_text', text: 'Approve' },
                  deny: { type: 'plain_text', text: 'Cancel' },
                },
              }),
              button('Reject', {
                action_id: REJECT_ACTION,
                style: 'danger',
                value: buttonValue({ postId: buttons.postId, n: card.n, digest: card.digest }),
              }),
              button('Open in Ansvisor', { action_id: OPEN_ACTION, url: runUrl }),
            ],
          }
        : { type: 'section', text: { type: 'mrkdwn', text: link(runUrl, 'Open the run') } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Posted because ${who ?? mrkdwn(name)} chose Inbox + Slack in their Chat settings. Once per run.${
              decides ? ` Only ${who ?? mrkdwn(name)} can approve or reject it.` : ''
            }`,
          },
        ],
      },
    ],
  };
}
