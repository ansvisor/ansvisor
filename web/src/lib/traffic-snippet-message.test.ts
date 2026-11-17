// @vitest-environment node
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../messages/en.json';
import { trackingSnippetTag } from './conversion-tracking';
import {
  MAILTO_MAX_LENGTH,
  snippetMailto,
  snippetMessage,
  type SnippetMessageTranslate,
} from './traffic-snippet-message';

/**
 * "Email this to my developer" (traffic-snippet-message.ts): the message in
 * en.json, filled with the brand's tag and domain, and the mailto: link
 * that opens it in the person's own mail app.
 */

const translate = createTranslator({ locale: 'en', messages, namespace: 'traffic.snippetMessage' });
const t: SnippetMessageTranslate = (key, values) => translate(key, values);

const API = 'https://api.ansvisor.com';
const TAG = trackingSnippetTag(API, 'abc123')!;
const TAG_WITH_CONVERSIONS = trackingSnippetTag(API, 'abc123', 'wait')!;

/** The subject and body a mail app reads from the link. */
function opened(href: string) {
  const url = new URL(href);
  return {
    to: url.pathname,
    subject: url.searchParams.get('subject'),
    body: url.searchParams.get('body'),
  };
}

describe('snippetMessage', () => {
  it('says what the tag is, gives it whole, and where it goes', () => {
    const { subject, body } = snippetMessage(t, TAG, 'acme.com');
    expect(subject).toBe('Please add the Ansvisor tracking code to acme.com');
    expect(body).toBe(
      [
        'Hi,',
        'Could you add the Ansvisor tracking code to acme.com? It counts visits from AI assistants like ChatGPT, Gemini and Perplexity, and the pages they land on.',
        "Here's the code:",
        TAG,
        'Paste it just before the closing </head> tag on every page, the 404 page included, then publish the change.',
        'Using a tag manager? Add it there instead, as a Custom HTML tag on all pages.',
        "It loads with defer and doesn't change how the page looks.",
        'Thanks!',
      ].join('\n\n'),
    );
  });

  it('keeps a tag with conversions as it is, both lines', () => {
    expect(snippetMessage(t, TAG_WITH_CONVERSIONS, 'acme.com').body).toContain(
      `\n\n${TAG_WITH_CONVERSIONS}\n\n`,
    );
  });

  it('names "our website" without a domain', () => {
    for (const domain of [undefined, null, '', '  ']) {
      const { subject, body } = snippetMessage(t, TAG, domain);
      expect(subject).toBe('Please add the Ansvisor tracking code to our website');
      expect(body).toContain('Could you add the Ansvisor tracking code to our website?');
    }
  });
});

describe('snippetMailto', () => {
  it('opens the message with no recipient, subject and body intact, lines as CRLF', () => {
    const message = snippetMessage(t, TAG, 'acme.com');
    const href = snippetMailto(message)!;
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    // Spaces as %20, never "+", which some mail apps show as a plus.
    expect(href).not.toContain('+');
    expect(href).toContain('%0D%0A%0D%0A');
    const mail = opened(href);
    expect(mail.to).toBe('');
    expect(mail.subject).toBe(message.subject);
    expect(mail.body).toBe(message.body.replace(/\n/g, '\r\n'));
  });

  it('stays well under the limit, a tag with conversions and a long domain too', () => {
    const plain = snippetMailto(snippetMessage(t, TAG, 'acme.com'))!;
    const longest = snippetMailto(
      snippetMessage(t, TAG_WITH_CONVERSIONS, 'shop.a-rather-long-brand-name-example.co.uk'),
    )!;
    expect(plain.length).toBeLessThan(1200);
    expect(longest.length).toBeLessThan(1500);
    expect(MAILTO_MAX_LENGTH).toBe(1800);
  });

  it('gives no link past the limit, so only "Copy message" is offered', () => {
    expect(snippetMailto({ subject: 'Tag', body: 'x'.repeat(MAILTO_MAX_LENGTH) })).toBeNull();
  });
});
