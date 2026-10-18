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
function visit({ referrer = '', search = '', alreadyTracked = false } = {}) {
  const sent = [];
  const window = alreadyTracked ? { __at: 1 } : {};
  runInNewContext(SCRIPT, {
    window,
    document: {
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
