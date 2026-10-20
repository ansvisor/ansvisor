import { describe, expect, it } from 'vitest';
import { attachmentKind, tableHtml, tableRows, textToHtml } from './attachments';

describe('attachmentKind', () => {
  it('reads a file’s kind from its extension, whatever its case', () => {
    expect(attachmentKind('Q3 keywords.XLSX')).toBe('spreadsheet');
    expect(attachmentKind('products.csv')).toBe('csv');
    expect(attachmentKind('notes.md')).toBe('markdown');
    expect(attachmentKind('page.htm')).toBe('html');
    expect(attachmentKind('brief.docx')).toBe('word');
    expect(attachmentKind('readme.txt')).toBe('text');
    expect(attachmentKind('shoe.webp')).toBe('image');
  });

  it('asks for the old Office formats as new ones, and names the rest unsupported', () => {
    expect(attachmentKind('old.xls')).toBe('legacyOffice');
    expect(attachmentKind('old.doc')).toBe('legacyOffice');
    expect(attachmentKind('deck.pptx')).toBe('unsupported');
    expect(attachmentKind('no-extension')).toBe('unsupported');
  });
});

describe('tableRows', () => {
  it('pads short rows, and drops empty rows and empty trailing columns', () => {
    expect(
      tableRows([
        ['Keyword', 'Volume', '', ''],
        ['crm forecasting', '210'],
        ['', '', ''],
        [' pipeline ', '96', '', ''],
      ]),
    ).toEqual([
      ['Keyword', 'Volume'],
      ['crm forecasting', '210'],
      ['pipeline', '96'],
    ]);
  });

  it('keeps at most 30 columns', () => {
    const wide = [Array.from({ length: 40 }, (_, i) => `c${i}`)];
    expect(tableRows(wide)[0]).toHaveLength(30);
  });
});

describe('tableHtml', () => {
  it('makes the first row the header and escapes every cell', () => {
    expect(
      tableHtml([
        ['Name', 'Note'],
        ['<b>X</b>', 'A & "B"'],
      ]),
    ).toBe(
      '<table><tbody><tr><th><p>Name</p></th><th><p>Note</p></th></tr>' +
        '<tr><td><p>&lt;b&gt;X&lt;/b&gt;</p></td><td><p>A &amp; &quot;B&quot;</p></td></tr></tbody></table>',
    );
  });
});

describe('textToHtml', () => {
  it('parts paragraphs at blank lines and breaks lines within them', () => {
    expect(textToHtml('﻿First line\nsame paragraph\r\n\r\nSecond <one>\n\n\n')).toBe(
      '<p>First line<br>same paragraph</p><p>Second &lt;one&gt;</p>',
    );
  });
});
