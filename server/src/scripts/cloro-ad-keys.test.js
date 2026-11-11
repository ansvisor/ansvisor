import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe as group, expect, it } from 'vitest';
import { describe, findAdKeys, isAdKey, keyWords } from './cloro-ad-keys.js';

// Hand-made, in the shapes Cloro's docs describe (search summaries, not a real
// response): ChatGPT's `ads[]`, the AI Overview's `aioverview.ads[]`, Google
// AI Mode's AdSection, and a Bing AI Mode answer without ads. The keys that
// only look like "ad" (metadata, headers, headline, thread, address,
// downloads) must not be listed.
const FIXTURE = {
  'chatgpt-web': {
    success: true,
    result: {
      model: 'gpt-5',
      markdown: 'HubSpot and Pipedrive are popular choices.',
      metadata: { headers: { thread: 't1' }, address: 'n/a', downloads: 0 },
      sources: [{ url: 'https://example.com', label: 'Example', footnote: false }],
      ads: [
        {
          brand: { name: 'Acme CRM', url: 'https://acme.example', favicon: 'x' },
          cards: [{ headline: 'Try Acme free', url: 'https://acme.example/try' }],
        },
        {
          brand: { name: 'Beta CRM', url: 'https://beta.example', favicon: 'y' },
          cards: [],
        },
      ],
    },
  },
  'google-aio': {
    success: true,
    result: {
      aioverview: {
        markdown: 'An overview.',
        sources: [],
        ads: [
          {
            position: 1,
            type: 'TEXT',
            title: 'Acme',
            url: 'https://acme.example',
            domain: 'acme.example',
          },
        ],
      },
      organic: [{ title: 'Sponsored · Acme CRM', link: 'https://www.google.com/aclk?sa=l&ai=x' }],
    },
  },
  'google-aimode': {
    success: true,
    result: {
      markdown: 'AI Mode answer.',
      shoppingCards: [{ title: 'Card', isAd: false, promotedBy: null }],
      ads: { title: 'Sponsored', ads: [{ raw: 'Acme CRM · Free trial' }] },
    },
  },
  'copilot-web': { success: true, result: { markdown: 'Bing answer.', sources: [] } },
};

const paths = (list) => list.map((entry) => entry.path);

group('keyWords / isAdKey', () => {
  it('splits camelCase, snake_case and kebab-case', () => {
    expect(keyWords('isAd')).toEqual(['is', 'ad']);
    expect(keyWords('ad_block')).toEqual(['ad', 'block']);
    expect(keyWords('AdSection')).toEqual(['ad', 'section']);
    expect(keyWords('HTMLAd')).toEqual(['html', 'ad']);
    expect(keyWords('top-ads')).toEqual(['top', 'ads']);
  });

  it('matches ad, sponsor, promot and paid as words', () => {
    for (const key of [
      'ad',
      'ads',
      'Ads',
      'isAd',
      'topAds',
      'ad_block',
      'AdSection',
      'adsection',
      'advertiser',
      'sponsored',
      'isSponsored',
      'promotedBy',
      'paid_results',
    ]) {
      expect(isAdKey(key), key).toBe(true);
    }
  });

  it('leaves words that only contain the letters "ad"', () => {
    for (const key of [
      'metadata',
      'headers',
      'headline',
      'thread',
      'address',
      'loaded',
      'downloads',
      'gradient',
      'markdown',
      'shoppingCards',
    ]) {
      expect(isAdKey(key), key).toBe(false);
    }
  });
});

group('findAdKeys', () => {
  it("lists ChatGPT's ads once, with how many items carry each key", () => {
    const found = findAdKeys(FIXTURE['chatgpt-web']);
    expect(paths(found.keys)).toEqual(['result.ads']);
    expect(found.keys[0]).toEqual({
      path: 'result.ads',
      seen: 1,
      value: 'array(2) of {brand, cards}',
    });
    expect(found.labels).toEqual([]);
    expect(found.truncated).toBe(false);
  });

  it("finds the AI Overview's ads and a sponsored search result by its text", () => {
    const found = findAdKeys(FIXTURE['google-aio']);
    expect(paths(found.keys)).toEqual(['result.aioverview.ads']);
    expect(paths(found.labels)).toEqual(['result.organic[].title', 'result.organic[].link']);
  });

  it("finds AI Mode's AdSection, its inner list and flags on cards", () => {
    const found = findAdKeys(FIXTURE['google-aimode']);
    expect(paths(found.keys)).toEqual([
      'result.shoppingCards[].isAd',
      'result.shoppingCards[].promotedBy',
      'result.ads',
      'result.ads.ads',
    ]);
    expect(found.keys.find((k) => k.path === 'result.ads').value).toBe('object {title, ads}');
    expect(paths(found.labels)).toEqual(['result.ads.title']);
  });

  it('finds nothing in an answer without ads', () => {
    expect(findAdKeys(FIXTURE['copilot-web'])).toEqual({ keys: [], labels: [], truncated: false });
  });

  it('folds array indexes and counts repeats', () => {
    const found = findAdKeys({ items: [{ isAd: true }, { isAd: false }, { isAd: true }] });
    expect(found.keys).toEqual([{ path: 'items[].isAd', seen: 3, value: 'true' }]);
  });

  it('survives odd input', () => {
    for (const value of [null, undefined, 'Sponsored', 42, [], {}]) {
      expect(() => findAdKeys(value)).not.toThrow();
    }
    expect(paths(findAdKeys('Sponsored').labels)).toEqual(['(root)']);
  });

  it('stops at a very deep or very wide response and says so', () => {
    let deep = {};
    for (let i = 0; i < 60; i++) deep = { next: deep };
    expect(findAdKeys(deep).truncated).toBe(true);

    const wide = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`ad_${i}`, i]));
    const found = findAdKeys(wide);
    expect(found.keys).toHaveLength(200);
    expect(found.truncated).toBe(true);
  });
});

group('describe', () => {
  it('summarises without dumping the value', () => {
    expect(describe([{ a: 1, b: 2 }])).toBe('array(1) of {a, b}');
    expect(describe({ a: 1 })).toBe('object {a}');
    expect(describe('x'.repeat(200))).toBe(`string "${'x'.repeat(120)}"`);
    expect(describe(undefined)).toBe('undefined');
  });
});

// The probe bills Cloro, so it only runs by hand: nothing in the app or the
// server's npm scripts may import or start it.
group('probe-cloro-ads.js stays a manual script', () => {
  const src = fileURLToPath(new URL('..', import.meta.url));
  const files = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(full);
      return entry.name.endsWith('.js') ? [full] : [];
    });

  it('is not imported outside src/scripts', () => {
    const importers = files(src)
      .filter((file) => !relative(src, file).startsWith('scripts/'))
      .filter((file) => /probe-cloro-ads|cloro-ad-keys/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(src, file));
    expect(importers).toEqual([]);
  });

  it('is not an npm script', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/probe-cloro-ads/);
  });
});
