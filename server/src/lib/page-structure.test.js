import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { extractPageContent } from './page-content.js';
import { keepStructure } from './page-structure.js';

/**
 * Pages brought into the Content Editor keep their structure (Content test
 * 2026-11-19, item 2): saved copies of the patterns ansvisor.com's blog
 * (Webflow) and other sites are built with.
 */

const fixture = (name) =>
  readFileSync(new URL(`./__fixtures__/page-structure/${name}`, import.meta.url), 'utf8');

const imported = (name, url) => {
  const content = extractPageContent(fixture(name), url, { forEditor: true });
  return { ...content, $: cheerio.load(content.html) };
};

const POST = 'https://www.ansvisor.com/blog/aeo-vs-seo-vs-geo';
const GUIDE = 'https://northwind.example/pricing-guide';

/** Each top-level block of the content, as its tag and words. */
const blocks = ($, selector = 'body') =>
  $(selector)
    .find('p, h1, h2, h3, li, td, th')
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, ' ').trim());

describe('extractPageContent for the editor: structure', () => {
  it('turns a grid of rows into a table, a short row’s last cell spanning the rest', () => {
    const { $ } = imported('webflow-post.html', POST);
    const table = $('table');
    expect(table).toHaveLength(1);
    const rows = table
      .find('tr')
      .toArray()
      .map((tr) =>
        $(tr)
          .children()
          .toArray()
          .map((cell) => $(cell).text().trim()),
      );
    expect(rows).toEqual([
      [
        'Full name',
        'Search engine optimization',
        'Answer engine optimization',
        'Generative engine optimization',
      ],
      [
        'Where visibility happens',
        'Search result pages',
        'Direct answers',
        'AI-generated responses',
      ],
      [
        'Typical platforms',
        'Google and Bing results',
        'ChatGPT, Google AI Overviews, AI Mode, Gemini, Copilot and Claude',
      ],
    ]);
    expect(table.find('tr').eq(2).children().last().attr('colspan')).toBe('2');
    // No run-on line left of it.
    expect(blocks($).some((line) => line.includes('Full nameSearch'))).toBe(false);
  });

  it('turns a list of <div>s into a list', () => {
    const { $ } = imported('webflow-post.html', POST);
    const takeaways = $('h2:contains("Key takeaways")').next('ul').children('li');
    expect(takeaways.toArray().map((li) => $(li).text().trim())).toEqual([
      'The term GEO comes from a research paper first published in November 2023.',
      'AEO and GEO cover the same platforms: ChatGPT, Google AI Overviews, AI Mode and Gemini.',
      'Pick one term for your team. What you track matters more than the label.',
    ]);
  });

  it('keeps a card’s title apart from its text', () => {
    const { $ } = imported('webflow-post.html', POST);
    const lines = blocks($);
    for (const [title, text] of [
      ['Prompt tracking', 'It tracks your prompts across'],
      ['Cited URLs', 'Citation monitoring shows'],
      ['Query fan-out', 'AI features use query fan-out'],
      ['Definition', 'Search engine optimization is the practice'],
    ]) {
      const at = lines.lastIndexOf(title);
      expect(at, title).toBeGreaterThan(-1);
      expect(lines[at + 1]).toMatch(new RegExp(`^${text}`));
    }
    expect($('strong:contains("Prompt tracking")').first().parent().is('p')).toBe(true);
    expect(lines.some((line) => /trackingIt tracks|URLsCitation/.test(line))).toBe(false);
  });

  it('reads the author from the page’s Person schema, not its author box', () => {
    const { author, html } = imported('webflow-post.html', POST);
    expect(author).toEqual({
      name: 'Cihan Geyik',
      title: 'Co-founder at Ansvisor',
      photoUrl: null,
      sameAs: ['https://www.linkedin.com/in/cihangeyik/'],
    });
    // The author box itself is the site's, not the page's text.
    expect(html).not.toContain('About the Author');
  });

  it('keeps a real table, its caption’s words aside', () => {
    const { $ } = imported('table-and-lists.html', GUIDE);
    const rows = $('table tr')
      .toArray()
      .map((tr) =>
        $(tr)
          .children()
          .toArray()
          .map((cell) => `${cell.name}:${$(cell).text().trim()}`),
      );
    expect(rows).toEqual([
      ['th:Plan', 'th:Seats', 'th:Price'],
      ['td:Starter', 'td:3', 'td:$29'],
      ['td:Growth', 'td:10', 'td:$99'],
    ]);
  });

  it('turns ARIA’s list and stray <li>s into lists', () => {
    const { $ } = imported('table-and-lists.html', GUIDE);
    const lists = $('ul')
      .toArray()
      .map((ul) =>
        $(ul)
          .children('li')
          .toArray()
          .map((li) => $(li).text().trim()),
      );
    expect(lists).toEqual([
      [
        'Unlimited projects and boards for the whole team.',
        'Daily backups, kept for thirty days after each one.',
      ],
      ['Check how many seats your team uses today.', 'Export any reports you want to keep.'],
    ]);
  });

  it('keeps a sentence of styled words in one paragraph, and stats apart', () => {
    const { $ } = imported('table-and-lists.html', GUIDE);
    const lines = blocks($);
    expect(lines).toContain('Questions? Our support team answers within a day.');
    expect(lines).toEqual(
      expect.arrayContaining([
        '90+',
        'Integrations ready to switch on',
        '6',
        'Regions to keep your data in',
      ]),
    );
  });

  it('reads the author from the author meta tag when the schema names none', () => {
    expect(imported('table-and-lists.html', GUIDE).author).toEqual({
      name: 'Ada Lovelace',
      title: null,
      photoUrl: null,
      sameAs: [],
    });
  });

  it('reads the author from an author box when nothing else names one', () => {
    const page = fixture('webflow-post.html').replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      '',
    );
    const { author } = extractPageContent(page, POST, { forEditor: true });
    expect(author).toEqual({
      name: 'Cihan Geyik',
      title: null,
      photoUrl: 'https://cdn.example/cihan.jpg',
      sameAs: ['https://www.linkedin.com/in/cihangeyik/'],
    });
  });

  it('names no author for a page the schema says an organization wrote', () => {
    const page = `<html><head><script type="application/ld+json">{"@type":"Article","author":{"@type":"Organization","name":"Northwind"}}</script></head>
      <body><main><h1>Plans</h1><p>Every plan is billed monthly, and you can change plans at any time.</p></main></body></html>`;
    expect(extractPageContent(page, GUIDE, { forEditor: true }).author).toBeNull();
  });

  it('leaves the content as it was for every other reader', () => {
    const content = extractPageContent(fixture('webflow-post.html'), POST);
    expect(content).not.toHaveProperty('author');
    expect(content.html).not.toContain('<table');
    expect(content.html).toContain('class="comparison-row"');
  });
});

describe('keepStructure', () => {
  const structured = (html) => {
    const $ = cheerio.load(`<div id="root">${html}</div>`);
    keepStructure($, $('#root')[0]);
    return $('#root').html();
  };

  it('leaves the editor’s own blocks alone', () => {
    const html =
      '<h2>Plans</h2><p>Start <a href="/x">free</a>.</p><ul><li>One</li><li>Two</li></ul>';
    expect(structured(html)).toBe(html);
  });

  it('keeps pieces that are spaced as one line', () => {
    expect(structured('<div><span>Hello </span><span>world</span></div>')).toBe(
      '<div><p><span>Hello </span><span>world</span></p></div>',
    );
  });

  it('splits a list item whose title runs into its text', () => {
    expect(
      structured('<ul><li><strong>Fast</strong><span>Loads in a second.</span></li></ul>'),
    ).toBe('<ul><li><p><strong>Fast</strong></p><p><span>Loads in a second.</span></p></li></ul>');
  });

  it('leaves a grid of cards with headings as blocks, not a table or a list', () => {
    const out = structured(
      '<div class="cards-list"><div class="card-row"><h3>A</h3><p>One</p><p>Two</p></div><div class="card-row"><h3>B</h3><p>Three</p><p>Four</p></div></div>',
    );
    expect(out).not.toContain('<table');
    expect(out).not.toContain('<ul');
    expect(out).toContain('<h3>A</h3><p>One</p>');
  });

  it('reads a deep page in one walk each, without recursion', () => {
    const depth = 2_000;
    const html = `${'<div>'.repeat(depth)}<strong>Deep</strong><span>text</span>${'</div>'.repeat(depth)}`;
    expect(structured(html)).toContain('<p><strong>Deep</strong></p><p><span>text</span></p>');
  });
});
