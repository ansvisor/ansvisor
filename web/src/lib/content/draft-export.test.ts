import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  draftBlocks,
  draftDocx,
  draftExportBlob,
  draftExportFileName,
  draftHtmlDocument,
  draftMarkdown,
} from './draft-export';

// The page as Copy HTML gives it: one block per line, an HTML block as its
// code, the schema JSON-LD as its script.
const PAGE = [
  '<h1>Pipeline forecasting</h1>',
  '<p>Teams <strong>trust</strong> it, <em>every</em> week. See <a href="https://acme.example/pricing">our pricing</a>.</p>',
  '<h2>How it works</h2>',
  '<ul><li>Weighted stages<ul><li>By deal size</li></ul></li><li>Rep calls</li></ul>',
  '<ol><li>Import deals</li><li>Set the stages</li></ol>',
  '<blockquote><p>It saved us a week.</p></blockquote>',
  '<table><tbody><tr><th>Plan</th><th>Price</th></tr><tr><td>Starter</td><td>$49 | month</td></tr></tbody></table>',
  '<div class="callout"><p>Free for 14 days</p></div>',
  '<script type="application/ld+json">{"@type":"Article"}</script>',
].join('\n');

/** jsdom's Blob has no text() or arrayBuffer(): read it as a browser's FileReader would. */
function read(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

describe('draftBlocks', () => {
  it('reads the page as headings, paragraphs, lists, a quote, a table and an HTML block', () => {
    const blocks = draftBlocks('Pipeline forecasting', PAGE);
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'item',
      'item',
      'item',
      'item',
      'item',
      'quote',
      'table',
      'html',
    ]);
    expect(blocks[1]).toEqual({
      kind: 'paragraph',
      runs: [
        { text: 'Teams ' },
        { text: 'trust', bold: true },
        { text: ' it, ' },
        { text: 'every', italics: true },
        { text: ' week. See ' },
        { text: 'our pricing', link: 'https://acme.example/pricing' },
        { text: '.' },
      ],
    });
    // The nested item one level down, in its parent's place.
    expect(blocks.slice(3, 6)).toMatchObject([
      { ordered: false, level: 0, n: 1, runs: [{ text: 'Weighted stages' }] },
      { ordered: false, level: 1, n: 1, runs: [{ text: 'By deal size' }] },
      { ordered: false, level: 0, n: 2, runs: [{ text: 'Rep calls' }] },
    ]);
  });

  it('opens with the title when the page has no H1', () => {
    expect(draftBlocks('Pipeline forecasting', '<p>Body</p>')[0]).toEqual({
      kind: 'heading',
      level: 1,
      runs: [{ text: 'Pipeline forecasting' }],
    });
    expect(draftBlocks('', '<p>Body</p>').map((b) => b.kind)).toEqual(['paragraph']);
  });

  it('drops a link to an unsafe address, and keeps its text', () => {
    const [block] = draftBlocks(
      'T',
      '<h1>T</h1><p><a href="javascript:alert(1)">click</a></p>',
    ).slice(1);
    expect(block).toEqual({ kind: 'paragraph', runs: [{ text: 'click' }] });
  });
});

describe('draftMarkdown', () => {
  it('writes the page as Markdown, an HTML block as HTML, without the JSON-LD', () => {
    expect(draftMarkdown('Pipeline forecasting', PAGE)).toBe(
      [
        '# Pipeline forecasting',
        '',
        'Teams **trust** it, *every* week. See [our pricing](https://acme.example/pricing).',
        '',
        '## How it works',
        '',
        '- Weighted stages',
        '    - By deal size',
        '- Rep calls',
        '1. Import deals',
        '2. Set the stages',
        '',
        '> It saved us a week.',
        '',
        '| Plan | Price |',
        '| --- | --- |',
        '| Starter | $49 \\| month |',
        '',
        '<div class="callout"><p>Free for 14 days</p></div>',
        '',
      ].join('\n'),
    );
  });

  it('escapes what Markdown would read as its own', () => {
    expect(draftMarkdown('', '<p>2 * 3 = 6 and [not] a_link</p><p># not a heading</p>')).toBe(
      '2 \\* 3 = 6 and \\[not\\] a\\_link\n\n\\# not a heading\n',
    );
  });
});

describe('draftHtmlDocument', () => {
  it("wraps Copy HTML's page in a titled document", () => {
    const doc = draftHtmlDocument('Pricing <2026>', '<h1>Pricing</h1>');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain('<title>Pricing &lt;2026&gt;</title>');
    expect(doc).toContain('<body>\n<h1>Pricing</h1>\n</body>');
  });
});

describe('draftDocx', () => {
  it('writes a Word document with the headings, text, links, lists and table', async () => {
    const files = unzipSync(await read(await draftDocx('Pipeline forecasting', PAGE)));
    const xml = strFromU8(files['word/document.xml']);
    for (const text of [
      'Pipeline forecasting',
      'How it works',
      'trust',
      'our pricing',
      'By deal size',
      'Set the stages',
      'It saved us a week.',
      '$49 | month',
      'Free for 14 days',
    ]) {
      expect(xml).toContain(text);
    }
    expect(xml).toContain('<w:tbl>');
    expect(xml).not.toContain('@type');
    // The link points at the page's address.
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain(
      'https://acme.example/pricing',
    );
  });
});

describe('draftExportBlob and draftExportFileName', () => {
  it('gives each format its file', async () => {
    const md = await draftExportBlob('md', 'T', '<h1>T</h1>');
    expect(md.type).toBe('text/markdown;charset=utf-8');
    expect(strFromU8(await read(md))).toBe('# T\n');
    expect((await draftExportBlob('html', 'T', '<h1>T</h1>')).type).toBe('text/html;charset=utf-8');
    expect(draftExportFileName('Pipeline forecasting: a guide', 'docx')).toBe(
      'ansvisor_content_pipeline-forecasting-a-guide.docx',
    );
    expect(draftExportFileName('—', 'md')).toBe('ansvisor_content_page.md');
  });
});
