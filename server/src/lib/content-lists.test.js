import { describe, expect, it, vi } from 'vitest';

// content-agent.js reaches the admin client at import time, whose config
// hard-exits without SUPABASE_* env (as in CI).
vi.mock('../config/supabase.js', () => ({ default: { from: vi.fn(), rpc: vi.fn() } }));
const { cleanInsertHtml } = await import('./content-agent.js');
const { withComparisonTable } = await import('./content-brief.js');
const { numberedLists, tableHtml, tableLine } = await import('./content-lists.js');
const { cleanPageHtml } = await import('./content-rewrite.js');
const { renderPage } = await import('./content-writer.js');

/**
 * Lists and tables in the Content Agent's pages (Content test 2026-11-19,
 * items 11 and 12).
 */

describe('numberedLists', () => {
  it('turns numbered paragraphs in a row into a numbered list', () => {
    // The How-to draft of the test: its steps as paragraphs, no <ol>.
    expect(
      numberedLists(
        '<h2>How to set it up</h2><p>1. Connect <strong>Search Console</strong>.</p><p>2. Add your prompts.</p><p>3. Run the first check.</p><p>Then wait a day.</p>',
      ),
    ).toBe(
      '<h2>How to set it up</h2><ol><li><p>Connect <strong>Search Console</strong>.</p></li><li><p>Add your prompts.</p></li><li><p>Run the first check.</p></li></ol><p>Then wait a day.</p>',
    );
  });

  it('takes the numbers out of a list that writes them, as a numbered list', () => {
    // The Best-of draft: "1. Ansvisor…" inside a <ul>.
    expect(
      numberedLists(
        '<ul><li><p>1. Ansvisor: open source.</p></li><li><p>2) Profound: daily runs.</p></li></ul>',
      ),
    ).toBe('<ol><li><p>Ansvisor: open source.</p></li><li><p>Profound: daily runs.</p></li></ol>');
  });

  it('leaves alone what isn’t a numbered run', () => {
    const pages = [
      '<p>1. One step only.</p><p>Nothing after it.</p>',
      '<p>1. First.</p><p>3. Not the next.</p>',
      '<p>2026 was a good year.</p><p>2027 will be better.</p>',
      '<ul><li>1. One</li><li>Two</li></ul>',
      '<p>Plain text.</p>',
    ];
    for (const html of pages) expect(numberedLists(html), html).toBe(html);
  });
});

describe('tableHtml', () => {
  it('writes a header row and a row per option, each as wide as the header', () => {
    expect(
      tableHtml({
        columns: ['Tool', 'Engines', 'Open source'],
        rows: [
          ['Ansvisor', 'ChatGPT, Gemini', 'Yes'],
          ['Profound', 'Nine <engines>'],
        ],
      }),
    ).toBe(
      '<table><tbody><tr><th><p>Tool</p></th><th><p>Engines</p></th><th><p>Open source</p></th></tr>' +
        '<tr><td><p>Ansvisor</p></td><td><p>ChatGPT, Gemini</p></td><td><p>Yes</p></td></tr>' +
        '<tr><td><p>Profound</p></td><td><p>Nine &lt;engines&gt;</p></td><td><p></p></td></tr></tbody></table>',
    );
  });

  it('writes none for a table that isn’t one', () => {
    expect(tableHtml(null)).toBe('');
    expect(tableHtml({ columns: ['Only'], rows: [['x']] })).toBe('');
    expect(tableHtml({ columns: ['A', 'B'], rows: [['', '']] })).toBe('');
  });

  it('asks a page weighing options for a table, and no other', () => {
    for (const type of ['comparison', 'alternatives', 'best_of']) {
      expect(tableLine(type)).toMatch(/^Table: this page compares options/);
    }
    expect(tableLine('guide')).toBe('');
  });
});

describe('the writer’s page', () => {
  const page = (section) => ({
    title: 'Best AI visibility tools',
    intro: ['Here are the tools.'],
    sections: [
      { heading: 'Setup', paragraphs: [], bullets: [], numbered: false, table: null, ...section },
    ],
    faqHeading: '',
    faq: [],
  });

  it('writes steps as a numbered list and a comparison as a table', () => {
    expect(renderPage(page({ bullets: ['Connect', 'Run'], numbered: true }))).toContain(
      '<ol><li><p>Connect</p></li><li><p>Run</p></li></ol>',
    );
    expect(
      renderPage(page({ table: { columns: ['Tool', 'Price'], rows: [['Ansvisor', 'Free']] } })),
    ).toContain('<table><tbody><tr><th><p>Tool</p></th>');
  });

  it('writes as before a page with neither (an answer from before them)', () => {
    const before = page({ bullets: ['A', 'B'] });
    delete before.sections[0].numbered;
    delete before.sections[0].table;
    expect(renderPage(before)).toContain('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
  });

  it('numbers a list whose items it numbered itself', () => {
    expect(renderPage(page({ bullets: ['1. Connect', '2. Run'] }))).toContain(
      '<ol><li><p>Connect</p></li><li><p>Run</p></li></ol>',
    );
  });
});

describe('a rewrite and a suggestion keep tables', () => {
  const table =
    '<table><tbody><tr><th><p>Tool</p></th></tr><tr><td><p>Ansvisor</p></td></tr></tbody></table>';

  it('keeps a table a rewrite writes, its attributes gone', () => {
    expect(
      cleanPageHtml(
        `<h1>A</h1><table class="x"><tbody><tr><th><p>Tool</p></th></tr><tr><td><p>Ansvisor</p></td></tr></tbody></table>`,
        new Map(),
      ),
    ).toBe(`<h1>A</h1>${table}`);
    expect(cleanPageHtml('<h1>A</h1><p>1. One.</p><p>2. Two.</p>', new Map())).toBe(
      '<h1>A</h1><ol><li><p>One.</p></li><li><p>Two.</p></li></ol>',
    );
  });

  it('keeps a table an insert adds, so a side-by-side rule can be met', () => {
    expect(cleanInsertHtml(`<h2>Compared</h2>${table}`)).toBe(`<h2>Compared</h2>${table}`);
    expect(cleanInsertHtml('<p>1. One.</p><p>2. Two.</p>')).toBe(
      '<ol><li><p>One.</p></li><li><p>Two.</p></li></ol>',
    );
  });
});

describe('withComparisonTable', () => {
  const outline = () => [
    { heading: 'What is AI visibility', format: 'paragraphs' },
    { heading: 'Profound vs Otterly vs Peec AI', format: 'list' },
  ];

  it('plans a table on a page weighing options, where its heading compares them', () => {
    expect(withComparisonTable(outline(), 'alternatives').map((s) => s.format)).toEqual([
      'paragraphs',
      'table',
    ]);
    // No heading compares: the first section.
    expect(
      withComparisonTable([{ heading: 'Our picks', format: 'list' }], 'best_of')[0].format,
    ).toBe('table');
  });

  it('leaves a brief with a table, or a page that weighs nothing, as it was', () => {
    const planned = [
      { heading: 'Plans', format: 'table' },
      { heading: 'More', format: 'list' },
    ];
    expect(withComparisonTable(planned, 'comparison')).toEqual([
      { heading: 'Plans', format: 'table' },
      { heading: 'More', format: 'list' },
    ]);
    expect(withComparisonTable(outline(), 'guide').map((s) => s.format)).toEqual([
      'paragraphs',
      'list',
    ]);
  });
});
