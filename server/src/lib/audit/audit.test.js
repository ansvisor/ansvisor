import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { scoreAudit } from './scorer.js';
import { fleschReadingEase, classifyLinks, jsonLd, countPhrases } from './signals/helpers.js';
import { jsonLdPresence, h1Quality } from './signals/structure.js';
import { https, metaDescription } from './signals/trust.js';
import { length } from './signals/content.js';
import { withRetry } from '../retry.js';

/** Build a minimal audit context from an HTML string (no network). */
function ctxFromHtml(html, extra = {}) {
  const text = cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim();
  return {
    url: 'https://example.com/page',
    origin: 'https://example.com',
    protocol: 'https',
    statusCode: 200,
    html,
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    $: cheerio.load(html),
    text,
    wordCount: text ? text.split(/\s+/).length : 0,
    robotsTxt: null,
    llmsTxt: null,
    now: Date.UTC(2026, 0, 1),
    ...extra,
  };
}

describe('scoreAudit', () => {
  it('averages within a category and normalizes the total over evaluated categories', () => {
    const results = [
      { key: 'json-ld-presence', status: 'pass', score: 1 }, // structure
      { key: 'h1-quality', status: 'fail', score: 0 }, // structure
      { key: 'https', status: 'pass', score: 1 }, // trust
    ];
    const { totalScore, categoryScores } = scoreAudit(results);

    expect(categoryScores.structure.score).toBeCloseTo(0.5, 5);
    expect(categoryScores.structure.evaluated).toBe(2);
    expect(categoryScores.structure.total).toBe(13);
    expect(categoryScores.trust.score).toBe(1);
    // (0.25*0.5 + 0.10*1) / (0.25 + 0.10) = 0.643
    expect(totalScore).toBeCloseTo(0.6428, 3);
  });

  it('excludes na signals and reports null for categories with no evaluated signals', () => {
    const results = [
      { key: 'https', status: 'pass', score: 1 },
      { key: 'json-ld-presence', status: 'na', score: null },
    ];
    const { categoryScores } = scoreAudit(results);
    expect(categoryScores.structure.score).toBeNull();
    expect(categoryScores.structure.evaluated).toBe(0);
    expect(categoryScores.trust.score).toBe(1);
  });
});

describe('helpers', () => {
  it('fleschReadingEase returns null for short text and a number for enough text', () => {
    expect(fleschReadingEase('Too short.')).toBeNull();
    const text = Array.from({ length: 40 }, () => 'the cat sat on the mat').join('. ') + '.';
    expect(typeof fleschReadingEase(text)).toBe('number');
  });

  it('classifyLinks splits internal vs external', () => {
    const ctx = ctxFromHtml(
      `<a href="/about">a</a><a href="https://example.com/x">b</a>
       <a href="https://other.com/y">c</a><a href="#frag">d</a><a href="mailto:x@y.com">e</a>`,
    );
    const { internal, external } = classifyLinks(ctx);
    expect(internal.length).toBe(2); // /about + example.com/x
    expect(external.length).toBe(1); // other.com
  });

  it('jsonLd parses blocks and counts valid ones', () => {
    const ctx = ctxFromHtml(
      `<script type="application/ld+json">{"@type":"Article"}</script>
       <script type="application/ld+json">not json</script>`,
    );
    const { total, valid, nodes } = jsonLd(ctx);
    expect(total).toBe(2);
    expect(valid).toBe(1);
    expect(nodes).toHaveLength(1);
  });

  it('countPhrases counts case-insensitive occurrences', () => {
    expect(countPhrases('We tested it. Then WE TESTED again.', ['we tested'])).toBe(2);
  });
});

describe('withRetry', () => {
  it('returns the value on first success without retrying', async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        return 'ok';
      },
      { attempts: 3, baseDelayMs: 0 },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries transient failures then succeeds', async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('transient');
        return 'recovered';
      },
      { attempts: 3, baseDelayMs: 0 },
    );
    expect(out).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('throws the last error after exhausting attempts', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('always');
        },
        { attempts: 2, baseDelayMs: 0 },
      ),
    ).rejects.toThrow('always');
    expect(calls).toBe(2);
  });
});

describe('deterministic signals', () => {
  it('h1-quality: pass for one well-sized H1, fail for none', () => {
    const good = h1Quality.evaluate(ctxFromHtml('<h1>The Best Running Shoes for Marathons</h1>'));
    expect(good.status).toBe('pass');
    expect(good.score).toBe(1);
    expect(h1Quality.evaluate(ctxFromHtml('<p>no heading</p>')).status).toBe('fail');
  });

  it('json-ld-presence: pass when a block exists', () => {
    const r = jsonLdPresence.evaluate(
      ctxFromHtml('<script type="application/ld+json">{"@type":"Article"}</script>'),
    );
    expect(r.status).toBe('pass');
  });

  it('https: pass over TLS without mixed content, warn with an http asset', () => {
    expect(https.evaluate(ctxFromHtml('<img src="https://x/i.png">')).status).toBe('pass');
    const mixed = https.evaluate(ctxFromHtml('<img src="http://x/i.png">'));
    expect(mixed.status).toBe('warn');
    expect(https.evaluate(ctxFromHtml('<p>x</p>', { protocol: 'http' })).status).toBe('fail');
  });

  it('meta-description: pass for 80–160 chars, fail when absent', () => {
    const desc = 'x'.repeat(120);
    expect(
      metaDescription.evaluate(ctxFromHtml(`<meta name="description" content="${desc}">`)).status,
    ).toBe('pass');
    expect(metaDescription.evaluate(ctxFromHtml('<p>x</p>')).status).toBe('fail');
  });

  it('length: pass for 800–3000 words', () => {
    expect(length.evaluate(ctxFromHtml('<p>x</p>', { wordCount: 1200 })).status).toBe('pass');
    expect(length.evaluate(ctxFromHtml('<p>x</p>', { wordCount: 100 })).status).toBe('fail');
  });
});
