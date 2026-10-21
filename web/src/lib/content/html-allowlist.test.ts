import { describe, expect, it } from 'vitest';
import {
  cleanHref,
  extractJsonLd,
  jsonLdType,
  normalizeJsonLd,
  restoreJsonLd,
} from './html-allowlist';

describe('cleanHref', () => {
  it('drops utm_*, gclid and fbclid and keeps every other parameter', () => {
    expect(
      cleanHref('https://acme.com/p?utm_source=x&id=3&utm_medium=y&gclid=z&fbclid=w#top'),
    ).toBe('https://acme.com/p?id=3#top');
    expect(cleanHref('/pricing?utm_campaign=fall&plan=pro')).toBe('/pricing?plan=pro');
    expect(cleanHref('https://acme.com/?UTM_Source=x')).toBe('https://acme.com/');
  });

  it('keeps mailto, and refuses what the toolbar refuses', () => {
    expect(cleanHref('mailto:sales@acme.com')).toBe('mailto:sales@acme.com');
    expect(cleanHref('javascript:alert(1)')).toBeNull();
    expect(cleanHref('//evil.com')).toBeNull();
  });
});

describe('normalizeJsonLd', () => {
  it('writes the JSON again with <, > and & escaped', () => {
    expect(normalizeJsonLd('{ "@type": "Product", "name": "A & B </script><b>" }')).toBe(
      '{"@type":"Product","name":"A \\u0026 B \\u003c/script\\u003e\\u003cb\\u003e"}',
    );
    expect(JSON.parse(normalizeJsonLd('[{"@type":"FAQPage"}]')!)).toEqual([{ '@type': 'FAQPage' }]);
  });

  it('refuses anything that isn’t a JSON object or list', () => {
    expect(normalizeJsonLd('alert(1)')).toBeNull();
    expect(normalizeJsonLd('"text"')).toBeNull();
    expect(normalizeJsonLd('null')).toBeNull();
    expect(normalizeJsonLd(`{"a":"${'x'.repeat(50_001)}"}`)).toBeNull();
  });

  it('names the schema type for the editor’s label', () => {
    expect(jsonLdType('{"@type":"Product"}')).toBe('Product');
    expect(jsonLdType('[{"@type":["FAQPage","WebPage"]}]')).toBe('FAQPage');
    expect(jsonLdType('{}')).toBeNull();
  });
});

describe('extractJsonLd and restoreJsonLd', () => {
  it('keeps valid schema blocks through cleaning, as script elements of our own', () => {
    const { html, blocks } = extractJsonLd(
      '<p>a</p><script type="application/ld+json" onload="x()">{"@type":"Product"}</script>' +
        "<script type='application/ld+json'>not json</script><script>alert(1)</script>",
    );
    expect(blocks).toEqual(['{"@type":"Product"}']);
    expect(html).toBe('<p>a</p><jsonld-slot data-i="0"></jsonld-slot><script>alert(1)</script>');
    expect(restoreJsonLd('<p>a</p><jsonld-slot data-i="0"></jsonld-slot>', blocks)).toBe(
      '<p>a</p><script type="application/ld+json">{"@type":"Product"}</script>',
    );
  });

  it('reads tags in any case, and skips other tags and plain scripts', () => {
    const { html, blocks } = extractJsonLd(
      '<SCRIPT TYPE="Application/LD+JSON">{"@type":"Product"}</SCRIPT>' +
        '<scripts type="application/ld+json">{}</scripts>' +
        '<script>var s = "<script type=application/ld+json>{}";</script><p>b</p>',
    );
    expect(blocks).toEqual(['{"@type":"Product"}']);
    expect(html).toBe(
      '<jsonld-slot data-i="0"></jsonld-slot><scripts type="application/ld+json">{}</scripts>' +
        '<script>var s = "<script type=application/ld+json>{}";</script><p>b</p>',
    );
  });

  it('finds a block after letters whose lower case is longer, as Turkish İ', () => {
    const { html, blocks } = extractJsonLd(
      '<h1>İstanbul İçin İyi Kahve</h1><script type="application/ld+json">{"@type":"Product"}</script><p>Sonra.</p>',
    );
    expect(blocks).toEqual(['{"@type":"Product"}']);
    expect(html).toBe(
      '<h1>İstanbul İçin İyi Kahve</h1><jsonld-slot data-i="0"></jsonld-slot><p>Sonra.</p>',
    );
  });

  it('takes time in proportion to the length on input built to backtrack', () => {
    const unclosed = '<script type=application/ld+json '.repeat(15_000);
    const unended = '<script type="application/ld+json">{"a":1}'.repeat(11_000);
    for (const input of [unclosed, unended]) {
      expect(input.length).toBeGreaterThan(450_000);
      const started = performance.now();
      const { html, blocks } = extractJsonLd(input);
      expect(performance.now() - started).toBeLessThan(500);
      expect(blocks).toEqual([]);
      expect(html).toBe(input);
    }
  });

  it('fills a slot nobody kept with nothing', () => {
    expect(restoreJsonLd('<jsonld-slot data-i="7"></jsonld-slot><p>a</p>', [])).toBe('<p>a</p>');
  });
});
