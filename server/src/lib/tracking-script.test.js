import { runInNewContext } from 'vm';
import { describe, expect, it } from 'vitest';
import { AI_SOURCES, AI_SOURCES_VERSION, classifyAiSource } from './ai-sources.js';
import { buildTrackingScript } from './tracking-script.js';

/**
 * The tracking snippet (AT-004) counts what the AI source list counts, the
 * same way the Google Analytics sync does, and sends the source's key and the
 * list version. Run here in a stand-in browser.
 */

const SCRIPT = buildTrackingScript();

/** Runs t.js on a page; returns the beacon it sent, or null. */
function visit({
  referrer = '',
  search = '',
  alreadyTracked = false,
  title = 'Menu · Acme Coffee',
  navigation,
} = {}) {
  const sent = [];
  const window = alreadyTracked ? { __at: 1 } : {};
  runInNewContext(SCRIPT, {
    window,
    // A browser without the navigation entry (older Safari) has none.
    ...(navigation === undefined
      ? {}
      : { performance: { getEntriesByType: () => (navigation ? [navigation] : []) } }),
    document: {
      title,
      referrer,
      currentScript: {
        src: 'https://api.ansvisor.test/t.js',
        getAttribute: (name) => (name === 'data-t' ? 'abcdef123' : null),
      },
    },
    location: { href: `https://acme.example/menu${search}`, search },
    navigator: {
      userAgent: 'Mozilla/5.0',
      language: 'en-US',
      sendBeacon: (url, blob) => sent.push({ url, blob }),
    },
    screen: { width: 1440, height: 900 },
    URL,
    URLSearchParams,
    Blob: class {
      constructor(parts) {
        this.text = parts.join('');
      }
    },
    JSON,
    Date,
    String,
  });
  if (sent.length === 0) return null;
  return { url: sent[0].url, ...JSON.parse(sent[0].blob.text) };
}

describe('the tracking snippet', () => {
  it("sends the source's key and the list version to the brand's beacon", () => {
    const beacon = visit({ referrer: 'https://chat.openai.com/c/123' });
    expect(beacon).toMatchObject({
      url: 'https://api.ansvisor.test/track/abcdef123',
      s: 'chatgpt.com',
      v: AI_SOURCES_VERSION,
      r: 'https://chat.openai.com/c/123',
      u: 'https://acme.example/menu',
    });
  });

  it('counts a subdomain, and engines the old snippet missed', () => {
    expect(visit({ referrer: 'https://m.perplexity.ai/' }).s).toBe('perplexity.ai');
    expect(visit({ referrer: 'https://grok.com/' }).s).toBe('grok.com');
    expect(visit({ referrer: 'https://chat.deepseek.com/' }).s).toBe('deepseek.com');
  });

  it('falls back to utm_source, matched the same way', () => {
    expect(
      visit({ referrer: 'https://www.google.com/', search: '?utm_source=chatgpt.com' }).s,
    ).toBe('chatgpt.com');
    expect(visit({ search: '?utm_source=Perplexity' }).s).toBe('perplexity.ai');
    // A name inside another tag isn't an engine.
    expect(visit({ search: '?utm_source=newsletter-chatgpt-tips' })).toBeNull();
  });

  it('counts Bing only from a Copilot answer link', () => {
    expect(visit({ referrer: 'https://www.bing.com/ck/a?!&&p=abc' }).s).toBe('bing.com');
    expect(visit({ referrer: 'https://www.bing.com/search?q=coffee' })).toBeNull();
    expect(visit({ search: '?utm_source=bing' })).toBeNull();
  });

  it('sends nothing for other traffic, or twice on one page', () => {
    expect(visit({ referrer: 'https://notchatgpt.com/' })).toBeNull();
    expect(visit({ referrer: 'https://example.com/' })).toBeNull();
    expect(visit({ referrer: 'https://chatgpt.com/', alreadyTracked: true })).toBeNull();
  });

  it("sends the landing page's status as the browser saw it (AT-012)", () => {
    const from = { referrer: 'https://chatgpt.com/' };
    expect(visit({ ...from, navigation: { responseStatus: 404 } })).toMatchObject({
      st: 404,
      nf: 0,
    });
    // A status says it all, whatever the title.
    expect(
      visit({ ...from, navigation: { responseStatus: 200 }, title: 'How we fixed our 404s' }),
    ).toMatchObject({ st: 200, nf: 0 });
  });

  it('says whether the title reads "not found" when the browser gives no status', () => {
    const from = { referrer: 'https://chatgpt.com/' };
    // Safari: no responseStatus on the entry, or no entry at all.
    expect(visit({ ...from, navigation: {}, title: 'Page Not Found – Acme' })).toMatchObject({
      st: 0,
      nf: 1,
    });
    expect(visit({ ...from, title: '404 | Acme Coffee' })).toMatchObject({ st: 0, nf: 1 });
    expect(visit({ ...from, navigation: null, title: 'Error 404' })).toMatchObject({ nf: 1 });
    // Not a 404: a number that contains 404, or an ordinary page.
    expect(visit({ ...from, title: 'Order #14045 shipped' })).toMatchObject({ st: 0, nf: 0 });
    expect(visit({ ...from, title: 'Menu · Acme Coffee' })).toMatchObject({ st: 0, nf: 0 });
  });

  it('names every listed host and alias as the server does', () => {
    for (const source of AI_SOURCES) {
      for (const host of source.hosts) {
        const path = source.referrerPath ?? '/';
        expect(visit({ referrer: `https://${host}${path}` })?.s, host).toBe(classifyAiSource(host));
      }
      for (const alias of source.aliases) {
        expect(visit({ search: `?utm_source=${alias}` })?.s ?? null, alias).toBe(
          classifyAiSource(alias, { origin: 'utm' }),
        );
      }
    }
  });
});
