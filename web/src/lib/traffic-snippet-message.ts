/**
 * "Email this to my developer", beside the tracking snippet (AI Traffic's
 * Install, and onboarding's "Connect your site"): most owners don't edit
 * their site's code, their developer or agency does. A mailto: link opens
 * the person's own mail app with the message ready and no recipient, so
 * nothing is sent from our servers; "Copy message" copies the same text for
 * someone without a mail app (webmail).
 *
 * A plain module: the snippet's UI (traffic/_snippet-code.tsx) builds the
 * message with it.
 */

/** Some mail apps and browsers cut a longer mailto: link; the message stays well under. */
export const MAILTO_MAX_LENGTH = 1800;

/** The closing tag the message names: a value, since the message format reads `<…>` as markup. */
const HEAD_CLOSE = '</head>';

export interface SnippetMessage {
  subject: string;
  body: string;
}

/** traffic.snippetMessage's keys, translated (useTranslations('traffic.snippetMessage')). */
export type SnippetMessageTranslate = (
  key: 'subject' | 'body' | 'ourSite',
  values?: Record<string, string>,
) => string;

/**
 * The message for the brand's snippet tag: what it is, the tag, where it
 * goes, and the tag manager's way. Without a domain it names "our website".
 */
export function snippetMessage(
  t: SnippetMessageTranslate,
  snippet: string,
  domain?: string | null,
): SnippetMessage {
  const site = domain?.trim() || t('ourSite');
  return {
    subject: t('subject', { domain: site }),
    body: t('body', { domain: site, snippet, tag: HEAD_CLOSE }),
  };
}

/**
 * The mailto: link that opens the message in the person's mail app, with no
 * recipient: they add their developer's address. Line breaks go as CRLF, as
 * mailto: asks (RFC 6068). Null when the link would pass MAILTO_MAX_LENGTH:
 * then only "Copy message" is offered.
 */
export function snippetMailto({ subject, body }: SnippetMessage): string | null {
  const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    body.replace(/\r?\n/g, '\r\n'),
  )}`;
  return href.length <= MAILTO_MAX_LENGTH ? href : null;
}
