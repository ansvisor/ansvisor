import { runInNewContext } from 'vm';
import { describe, expect, it } from 'vitest';
import {
  AI_SOURCES,
  AI_SOURCES_VERSION,
  classifyAiSource,
  classifyAiSurface,
  landingMedium,
} from './ai-sources.js';
import { buildTrackingScript } from './tracking-script.js';

/**
 * The tracking snippet (AT-004) counts what the AI source list counts, the
 * same way the Google Analytics sync does, and sends the source's key and the
 * list version. Run here in a stand-in browser.
 */

const SCRIPT = buildTrackingScript();

/**
 * Runs t.js on a page, then lets the page go on: `then` changes it after the
 * script ran (a single-page app setting its title), and pending timers run.
 * Returns the visit's beacon (or null), every beacon it sent, its timers and
 * a way to fire the page's events.
 */
function run({
  referrer = '',
  search = '',
  alreadyTracked = false,
  title = 'Menu · Acme Coffee',
  navigation,
  readyState = 'complete',
  then,
  runTimers = true,
} = {}) {
  const sent = [];
  const timers = [];
  const listeners = {};
  const on = (scope) => (type, fn) => (listeners[`${scope}:${type}`] ||= []).push(fn);
  const fire = (key) => (listeners[key] || []).forEach((fn) => fn());
  const window = alreadyTracked ? { __at: 1 } : {};
  window.addEventListener = on('window');
  const document = {
    title,
    referrer,
    readyState,
    visibilityState: 'visible',
    addEventListener: on('document'),
    currentScript: {
      src: 'https://api.ansvisor.test/t.js',
      getAttribute: (name) => (name === 'data-t' ? 'abcdef123' : null),
    },
  };
  const location = { href: `https://acme.example/menu${search}`, search };
  runInNewContext(SCRIPT, {
    window,
    // A browser without the navigation entry (older Safari) has none.
    ...(navigation === undefined
      ? {}
      : { performance: { getEntriesByType: () => (navigation ? [navigation] : []) } }),
    document,
    location,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
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
  then?.({ document, location });
  if (runTimers) for (const timer of timers) timer.fn();
  // Read when asked, so a beacon sent after a later event or timer counts.
  const parse = () => sent.map((b) => ({ url: b.url, ...JSON.parse(b.blob.text) }));
  return {
    get beacon() {
      return parse()[0] ?? null;
    },
    get beacons() {
      return parse();
    },
    timers,
    fire,
  };
}

/** The beacon a visit sent, or null. */
const visit = (options) => run(options).beacon;

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

  // #1283: a ChatGPT Shopping product card opens the product's feed link.
  it('counts a ChatGPT Shopping product card as ChatGPT, sending the URL that says so', () => {
    const search = '?utm_source=chatgpt.com&utm_medium=feed';
    for (const referrer of ['', 'https://chatgpt.com/']) {
      const beacon = visit({ referrer, search });
      expect(beacon, referrer).toMatchObject({
        s: 'chatgpt.com',
        v: AI_SOURCES_VERSION,
        u: `https://acme.example/menu${search}`,
      });
      // The server reads the surface from that URL.
      expect(classifyAiSurface(beacon.s, landingMedium(beacon.u))).toBe('shopping');
    }
    // A ChatGPT answer's link: plain ChatGPT.
    const answer = visit({ search: '?utm_source=chatgpt.com' });
    expect(answer.s).toBe('chatgpt.com');
    expect(classifyAiSurface(answer.s, landingMedium(answer.u))).toBeNull();
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
    // A 2xx page that only mentions 404s is an ordinary page.
    expect(
      visit({ ...from, navigation: { responseStatus: 200 }, title: 'How we fixed our 404s' }),
    ).toMatchObject({ st: 200, nf: 0 });
    // Any other status says it all, whatever the title.
    expect(
      visit({ ...from, navigation: { responseStatus: 404 }, title: 'Page not found' }),
    ).toMatchObject({ st: 404, nf: 0 });
  });

  // gkhngyk on #1192: a single-page app answers 200 and shows its own
  // not-found route, so soft 404s were never seen.
  it("reads a 2xx page's title as a soft 404 only when it's the not-found page's own", () => {
    const ok = { referrer: 'https://chatgpt.com/', navigation: { responseStatus: 200 } };
    for (const title of [
      '404',
      '404 | Acme Coffee',
      '404 Not Found',
      'Page Not Found – Acme',
      'Acme Coffee - Page not found',
      'Error 404 · Acme',
    ]) {
      expect(visit({ ...ok, title }), title).toMatchObject({ st: 200, nf: 1 });
    }
    for (const title of ['Error 404 explained', 'Lost and not found | Books', 'Menu · Acme']) {
      expect(visit({ ...ok, title }), title).toMatchObject({ st: 200, nf: 0 });
    }
  });

  // gkhngyk on #1247: the visit's beacon waited for load on every page.
  it('sends the visit at once, and says so later when the app shows its not-found page', () => {
    const { beacons, timers } = run({
      referrer: 'https://chatgpt.com/',
      navigation: { responseStatus: 200 },
      title: 'Acme Coffee',
      // The app's router resolves the route and shows its not-found page.
      then: ({ document, location }) => {
        document.title = 'Page not found | Acme Coffee';
        location.href = 'https://acme.example/elsewhere';
      },
    });
    expect(timers.map((t) => t.ms)).toEqual([1500]);
    expect(beacons).toHaveLength(2);
    expect(beacons[0]).toMatchObject({ st: 200, nf: 0, u: 'https://acme.example/menu' });
    // The address the visit landed on, not where the app went since; a mark, not a visit.
    expect(beacons[1]).toEqual({
      url: 'https://api.ansvisor.test/track/abcdef123',
      k: 'nf',
      u: 'https://acme.example/menu',
      s: 'chatgpt.com',
      a: 'Mozilla/5.0',
      st: 200,
    });
  });

  it("doesn't wait for the page to load, and checks the title again only after it", () => {
    const loading = run({
      referrer: 'https://chatgpt.com/',
      navigation: { responseStatus: 200 },
      readyState: 'loading',
      runTimers: false,
    });
    expect(loading.beacons).toHaveLength(1);
    expect(loading.timers).toHaveLength(0);
    loading.fire('window:load');
    expect(loading.timers).toHaveLength(1);
    // The title still reads as a page: nothing more.
    loading.timers[0].fn();
    expect(loading.beacons).toHaveLength(1);

    // Nothing to check again: a 404, or a title that already said not found.
    expect(
      run({ referrer: 'https://chatgpt.com/', navigation: { responseStatus: 404 } }).timers,
    ).toHaveLength(0);
    expect(
      run({ referrer: 'https://chatgpt.com/', navigation: { responseStatus: 200 }, title: '404' })
        .timers,
    ).toHaveLength(0);
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
