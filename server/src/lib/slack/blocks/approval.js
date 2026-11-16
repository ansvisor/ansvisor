import { cardLine } from './needs-you.js';
import { link, mrkdwn } from './format.js';

/**
 * The answers to Approve and Reject in Slack (#2139, N7, lib/slack/approvals.js),
 * through the click's response_url: the message, decided, with who decided
 * and when and no buttons left (it replaces the original); and the replies
 * only the person who clicked sees (ephemeral), saying why nothing changed.
 * Worded here, as the other Slack messages are. Pure.
 */

/** A time in Slack's date markup: each reader's own time zone, the ISO time as its fallback. */
function slackTime(iso) {
  const seconds = Math.floor(Date.parse(iso) / 1000);
  return Number.isFinite(seconds) ? `<!date^${seconds}^{date_short_pretty} at {time}|${iso}>` : '';
}

const ENDS = {
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'No answer in 7 days',
  closed: 'No longer waiting',
};

/** How the card ended, who decided it, where and when: "Approved by Sam Lee in Slack · …". */
export function decidedStatus(card, decided) {
  const by =
    (decided.how === 'approved' || decided.how === 'rejected') && card.person
      ? ` by ${mrkdwn(card.person)}`
      : '';
  const where = decided.where ? ` in ${decided.where === 'slack' ? 'Slack' : 'Ansvisor'}` : '';
  const when = decided.at ? ` · ${slackTime(decided.at)}` : '';
  return `${ENDS[decided.how] ?? ENDS.closed}${by}${where}${when}`;
}

/**
 * The message once its card is decided, in Slack or in Ansvisor.
 * @param {{ agent: string|null, brand: string, runUrl: string,
 *   card: { title: string|null, target: string|null, person: string|null },
 *   decided: { how: keyof typeof ENDS, at: string|null, where: 'slack'|'ansvisor'|null } }} input
 */
export function decidedMessage({ agent, brand, runUrl, card, decided }) {
  const status = decidedStatus(card, decided);
  const asks = cardLine(card);
  return {
    replace_original: true,
    text: `${agent ? `${mrkdwn(agent)} on ` : ''}${mrkdwn(brand)}: ${status}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${agent ? `*${mrkdwn(agent)}* on ` : ''}${mrkdwn(brand)} asked for an OK${asks ? ` on: ${asks}` : '.'}`,
        },
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: status }] },
      { type: 'section', text: { type: 'mrkdwn', text: link(runUrl, 'Open in Ansvisor') } },
    ],
  };
}

/** Why a click changed nothing, for the person who clicked. `{person}`: who the card waits for. */
export const REFUSALS = Object.freeze({
  already: 'This was already decided: {status}. Nothing changed.',
  not_found: 'This button no longer works, so nothing changed.',
  connection:
    'This brand’s Slack connection changed, so it can’t be decided from Slack. Nothing changed.',
  other_workspace:
    'This brand is connected to another Slack workspace, so it can’t be decided from yours. Nothing changed.',
  plan: 'Approving from Slack isn’t on this workspace’s plan. Nothing changed: decide it in Ansvisor.',
  not_member: '{person} is no longer a member of the Ansvisor workspace, so nothing changed.',
  not_linked:
    'Ansvisor couldn’t find {person}’s Slack account: it looks for the one with their Ansvisor sign-in e-mail. Nothing changed: decide it in Ansvisor.',
  not_yours: 'Only {person} can approve or reject this, as in Ansvisor. Nothing changed.',
  needs_app: 'This change needs {person} signed in to Ansvisor to approve it. Nothing changed.',
  changed: 'This step changed since the message was posted. Nothing changed: see it in Ansvisor.',
  forbidden: 'Your role or brand access doesn’t allow this change now. Nothing changed.',
  read_only: 'This Ansvisor workspace is read-only, so nothing can be approved. Nothing changed.',
  chat_off: 'Chat is off for this Ansvisor workspace. Nothing changed.',
  demo: 'The sample brand changes nothing.',
  failed: 'Something went wrong, so nothing changed. Try again, or decide it in Ansvisor.',
});

/**
 * A reply only the person who clicked sees, with Open in Ansvisor.
 * @param {keyof typeof REFUSALS} reason
 * @param {{ runUrl: string, person?: string|null, status?: string }} input
 */
export function refusalMessage(reason, { runUrl, person = null, status = '' }) {
  const words = (REFUSALS[reason] ?? REFUSALS.failed)
    .replace('{person}', mrkdwn(person ?? 'the person it waits for'))
    .replace('{status}', status);
  return {
    response_type: 'ephemeral',
    replace_original: false,
    text: words,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `${words}\n${link(runUrl, 'Open in Ansvisor')}` },
      },
    ],
  };
}
