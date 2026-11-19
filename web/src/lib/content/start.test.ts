import { describe, expect, it } from 'vitest';
import { fileTitle, startPageType, summarizeContent } from './start';

describe('summarizeContent', () => {
  it('names content by its first heading, and counts headings and text', () => {
    expect(
      summarizeContent('<p>Intro</p><h2>Returns policy</h2><p>30 days.</p><h3>Refunds</h3>'),
    ).toEqual({
      title: 'Returns policy',
      headings: 2,
      // As the editor's counter counts: no space between blocks.
      characters: 'IntroReturns policy30 days.Refunds'.length,
    });
  });

  it('falls back to the file’s name, then the first paragraph, cut at a word', () => {
    expect(summarizeContent('<p>Plans start at $9.</p>', 'Pricing notes').title).toBe(
      'Pricing notes',
    );
    expect(summarizeContent('<p>Short one</p><p>Next</p>').title).toBe('Short one');
    const long = summarizeContent(`<p>${'word '.repeat(30)}</p>`).title;
    expect(long.endsWith('word…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(81);
  });

  it('counts characters as the editor will, its schema JSON-LD as one', () => {
    const html =
      '<p>One</p><ul><li>two</li><li>three</li></ul>' +
      '<script type="application/ld+json">{"@type":"Organization","name":"Ansvisor"}</script>';
    // The import test of 2026-11-19: 18,075 here where the editor said 11,058.
    expect(summarizeContent(html).characters).toBe('Onetwothree'.length + 1);
  });

  it('counts nothing for content with no words', () => {
    expect(summarizeContent('<p> </p>').characters).toBe(0);
  });
});

describe('fileTitle', () => {
  it('drops the extension', () => {
    expect(fileTitle('Q3 brief.docx')).toBe('Q3 brief');
    expect(fileTitle('notes')).toBe('notes');
  });
});

describe('startPageType', () => {
  it('picks the type the title or content shows, else a blog post', () => {
    expect(startPageType({ title: 'Northwind vs HubSpot' }, 'b2b')).toEqual({
      pageType: 'comparison',
      detected: true,
    });
    expect(
      startPageType(
        {
          title: 'Trail Runner X',
          html: '<script type="application/ld+json">{"@type":"Product"}</script>',
        },
        'ecommerce',
      ),
    ).toEqual({ pageType: 'product_page', detected: true });
    expect(startPageType({ title: 'Our story' }, 'b2c')).toEqual({
      pageType: 'blog_post',
      detected: false,
    });
  });
});
