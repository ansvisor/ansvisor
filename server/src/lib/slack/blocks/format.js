/**
 * Slack's mrkdwn, for the messages worded here (owner, 2026-11-10: Slack
 * messages are worded on the server, as the e-mails are). Pure.
 */

/** Text for Slack's mrkdwn: the three characters Slack reads as markup, escaped. */
export function mrkdwn(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** A link in mrkdwn: `<url|label>`, the label escaped and without a `|`. */
export function link(url, label) {
  return `<${String(url).replace(/[<>|\s]/g, encodeURIComponent)}|${mrkdwn(label).replace(/\|/g, '/')}>`;
}

/** At most `max` characters, an ellipsis marking a cut. */
export function clip(value, max) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
