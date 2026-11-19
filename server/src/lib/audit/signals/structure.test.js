import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { altText, faqSchema, jsonLdRelevance, jsonLdValidity } from './structure.js';

/** Structured data as the audit reads it: a @graph's nodes in its wrapper's context. */

const page = (json) => ({
  $: cheerio.load(
    `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body></body></html>`,
  ),
});

/** One @graph, the context on the wrapper alone, as WordPress's SEO plugins write it. */
const GRAPH = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebPage', '@id': 'https://acme.example/#webpage', name: 'Pricing' },
    { '@type': 'Organization', '@id': 'https://acme.example/#org', name: 'Acme' },
  ],
};

describe('json-ld-validity', () => {
  it('passes one @graph whose context is on the wrapper alone', () => {
    expect(jsonLdValidity.evaluate(page(GRAPH))).toMatchObject({
      status: 'pass',
      evidence: { wellFormedNodes: 2 },
    });
  });

  it('keeps a node’s own context, and fails a @graph with none anywhere', () => {
    const own = {
      '@context': 'https://example.org/vocab',
      '@graph': [{ '@context': 'https://schema.org', '@type': 'Product', name: 'Boot' }],
    };
    expect(jsonLdValidity.evaluate(page(own)).status).toBe('pass');
    const none = { '@graph': GRAPH['@graph'] };
    expect(jsonLdValidity.evaluate(page(none)).status).toBe('fail');
  });

  it('reads a large shared context once, not once per node', () => {
    // About 500 KB: a wrapper context of ~250 KB and thousands of tiny nodes.
    const vocab = {};
    for (let i = 0; i < 7_300; i++) vocab[`t${i}`] = `https://schema.org/T${i}`;
    const nodes = [];
    for (let i = 0; i < 9_500; i++) nodes.push({ '@type': 'Thing', n: i });
    const big = { '@context': ['https://schema.org', vocab], '@graph': nodes };
    const started = Date.now();
    expect(jsonLdValidity.evaluate(page(big)).status).toBe('pass');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('json-ld-relevance', () => {
  it('reads the types inside a @graph', () => {
    expect(jsonLdRelevance.evaluate(page(GRAPH)).status).not.toBe('fail');
  });
});

describe('faq-schema', () => {
  const qa = (n) =>
    Array.from({ length: n }, (_, i) => ({
      '@type': 'Question',
      name: `Question ${i + 1}?`,
      acceptedAnswer: { '@type': 'Answer', text: 'An answer.' },
    }));

  it('finds a FAQPage set as a WebPage’s mainEntity in a @graph (ansvisor.com, 2026-11-19)', () => {
    const result = faqSchema.evaluate(
      page({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebPage',
            name: 'Ansvisor vs Profound',
            mainEntity: { '@type': 'FAQPage', mainEntity: qa(7) },
          },
        ],
      }),
    );
    expect(result).toMatchObject({ status: 'pass', evidence: { faqPage: true, questionCount: 7 } });
  });

  it('still finds one at the top, and fails without one', () => {
    expect(faqSchema.evaluate(page({ '@type': 'FAQPage', mainEntity: qa(3) })).status).toBe('pass');
    expect(faqSchema.evaluate(page({ '@type': 'WebPage', name: 'x' })).status).toBe('fail');
  });
});

describe('alt-text', () => {
  const imgs = (html) => ({ $: cheerio.load(`<html><body>${html}</body></html>`) });
  const many = (n, attrs) => Array.from({ length: n }, () => `<img src="x.png" ${attrs}>`).join('');

  it('leaves decorative images (alt="") out of the ratio, as its fix asks', () => {
    // ansvisor.com's home (2026-11-19): 73 described, 53 decorative on purpose.
    const result = altText.evaluate(imgs(many(73, 'alt="A chart"') + many(53, 'alt=""')));
    expect(result).toMatchObject({
      status: 'pass',
      score: 1,
      evidence: { images: 126, decorative: 53, withAlt: 73, ratio: 1 },
    });
  });

  it('counts a missing alt as a miss, and reads role and aria-hidden as decorative', () => {
    const result = altText.evaluate(
      imgs(
        many(3, 'alt="Team photo"') +
          many(2, '') +
          '<img src="a.png" role="presentation"><img src="b.png" aria-hidden="true">',
      ),
    );
    expect(result).toMatchObject({
      status: 'warn',
      score: 0.6,
      evidence: { images: 7, decorative: 2, withAlt: 3 },
    });
  });

  it('has nothing to judge when every image is decorative, or there are none', () => {
    expect(altText.evaluate(imgs(many(4, 'alt=""'))).status).toBe('na');
    expect(altText.evaluate(imgs('<p>No images</p>')).status).toBe('na');
  });
});
