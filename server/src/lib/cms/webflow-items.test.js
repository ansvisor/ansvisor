import { describe, expect, it } from 'vitest';
import { fieldDataFor, toWebflowRichText, webflowSlug } from './webflow-items.js';

/** A page as a Webflow CMS item (Send to CMS #1331, phase 2). */

describe('toWebflowRichText', () => {
  it('keeps what Webflow’s rich text keeps, a link’s address and target only', () => {
    const { html, changed } = toWebflowRichText(
      '<h2 id="x" class="big">Why</h2><p style="color:red">Cold <strong>brew</strong> is <a href="https://acme.example/brew" target="_blank" rel="noopener" class="l">smooth</a>.</p><ul><li>One</li></ul><blockquote><p>Said so.</p></blockquote>',
    );
    expect(html).toBe(
      '<h2>Why</h2><p>Cold <strong>brew</strong> is <a href="https://acme.example/brew" target="_blank">smooth</a>.</p><ul><li>One</li></ul><blockquote><p>Said so.</p></blockquote>',
    );
    expect(changed).toEqual({ tables: 0, images: 0 });
  });

  it('turns a table into a list, a row an item, its header naming each cell', () => {
    const { html, changed } = toWebflowRichText(
      '<table><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>Starter</td><td>$49</td></tr><tr><td>Growth</td><td></td></tr></tbody></table>',
    );
    expect(html).toBe(
      '<ul><li><strong>Plan</strong>: Starter · <strong>Price</strong>: $49</li><li><strong>Plan</strong>: Growth</li></ul>',
    );
    expect(changed.tables).toBe(1);
    // No header row: the cells, one after another.
    expect(toWebflowRichText('<table><tr><td>a &lt;b&gt;</td><td>c</td></tr></table>').html).toBe(
      '<ul><li>a &lt;b&gt; · c</li></ul>',
    );
  });

  it('leaves images, media, scripts and embeds out, and counts the images', () => {
    const { html, changed } = toWebflowRichText(
      '<p>Intro</p><figure><img src="https://acme.example/a.png" alt="A"><figcaption>A</figcaption></figure><p><img src="https://acme.example/b.png"></p><script type="application/ld+json">{"@type":"Article"}</script><iframe src="https://x.example"></iframe><hr><p>End</p>',
    );
    expect(html).toBe('<p>Intro</p><p>End</p>');
    expect(changed.images).toBe(2);
  });

  it('reads a heading 1 as a heading 2, a code block and a definition list as paragraphs, and unwraps the rest', () => {
    expect(
      toWebflowRichText(
        '<div><h1>Title again</h1><section><p><span>Hi</span> <mark>there</mark></p></section><pre><code>npm i &lt;x&gt;</code></pre><dl><dt>Term</dt><dd>Meaning</dd></dl></div>',
      ).html,
    ).toBe('<h2>Title again</h2><p>Hi there</p><p>npm i &lt;x&gt;</p><p>Term</p><p>Meaning</p>');
  });
});

describe('webflowSlug', () => {
  it('makes a slug Webflow takes', () => {
    expect(webflowSlug('soğuk-demleme-kahve')).toBe('soguk-demleme-kahve');
    expect(webflowSlug('Größe_und.Preis')).toBe('grosse_und-preis');
    expect(webflowSlug('--Ilık su--')).toBe('ilik-su');
    expect(webflowSlug('…')).toBeNull();
    expect(webflowSlug('a'.repeat(250))).toHaveLength(200);
  });
});

describe('fieldDataFor', () => {
  const page = {
    title: 'Cold brew at home',
    metaTitle: '',
    metaDescription: '',
  };
  const body = `<p>${'Cold brew is coffee steeped in cold water for 12 to 18 hours. '.repeat(4)}</p>`;

  it('puts each part in the field the map gives it, falling back where a page has none', () => {
    const data = fieldDataFor(
      {
        page,
        slug: 'cold-brew-at-home',
        body,
        jsonLd: [{ '@type': 'Article', headline: '</script>' }],
      },
      {
        body: 'post-body',
        metaTitle: 'seo-title',
        metaDescription: 'post-summary',
        jsonLd: 'schema',
      },
    );
    expect(data.name).toBe('Cold brew at home');
    expect(data.slug).toBe('cold-brew-at-home');
    expect(data['post-body']).toBe(body);
    expect(data['seo-title']).toBe('Cold brew at home');
    // The opening words, cut at a word.
    expect(data['post-summary']).toMatch(/^Cold brew is coffee steeped .{60,}…$/);
    expect(data['post-summary'].length).toBeLessThanOrEqual(161);
    expect(data.schema).toBe('{"@type":"Article","headline":"<\\/script>"}');
  });

  it('sends the page’s own meta, several JSON-LD blocks as a list, and nothing for a part the map leaves out', () => {
    const data = fieldDataFor(
      {
        page: { ...page, metaTitle: 'Cold brew, simply', metaDescription: 'How to make it.' },
        slug: 's',
        body: '<p>x</p>',
        jsonLd: [{ '@type': 'Article' }, { '@type': 'FAQPage' }],
      },
      { body: 'post-body', metaDescription: 'post-summary', jsonLd: 'schema' },
    );
    expect(data).toEqual({
      name: 'Cold brew at home',
      slug: 's',
      'post-body': '<p>x</p>',
      'post-summary': 'How to make it.',
      schema: '[{"@type":"Article"},{"@type":"FAQPage"}]',
    });
    // No JSON-LD: the field is left as it is.
    expect(
      fieldDataFor(
        { page, slug: 's', body: '<p>x</p>', jsonLd: [] },
        { body: 'b', jsonLd: 'schema' },
      ),
    ).not.toHaveProperty('schema');
  });
});
