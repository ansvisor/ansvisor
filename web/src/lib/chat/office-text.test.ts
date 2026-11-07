// @vitest-environment node
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  MAX_SHEETS,
  MAX_SHEET_ROWS,
  decodeEntities,
  htmlToText,
  wordText,
  workbookText,
} from './office-text';

/**
 * Word and Excel attachments as text for the model (the owner's request,
 * 2026-11-06): a Word file as Markdown, a workbook's first sheets as CSV,
 * with what was left out said. The fixtures are made here, with the
 * libraries the app writes these files with.
 */

const WORKBOOK_TYPE = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

/** A workbook as Excel writes one: shared strings, rich text, inline strings, gaps. */
function workbook(sheets: { name: string; rows: string }[], shared: string[] = []) {
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook ${WORKBOOK_TYPE} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships>${sheets
        .map(
          // Written in reverse: the sheet's place comes from its relationship, not its file name.
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${sheets.length - i}.xml"/>`,
        )
        .join('')}</Relationships>`,
    ),
    'xl/sharedStrings.xml': strToU8(
      `<?xml version="1.0"?><sst ${WORKBOOK_TYPE}>${shared.map((s) => `<si>${s}</si>`).join('')}</sst>`,
    ),
  };
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${sheets.length - i}.xml`] = strToU8(
      `<?xml version="1.0"?><worksheet ${WORKBOOK_TYPE}><sheetData>${sheet.rows}</sheetData></worksheet>`,
    );
  });
  return zipSync(files);
}

describe('workbookText', () => {
  it('reads shared, rich and inline strings, numbers and booleans, each in its column', () => {
    const bytes = workbook(
      [
        {
          name: 'Prompts &amp; volume',
          rows:
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
            '<row r="2"><c r="A2" t="inlineStr"><is><t>best crm, for teams</t></is></c><c r="B2" s="1"/><c r="C2"><v>1200.5</v></c><c r="D2" t="b"><v>1</v></c></row>' +
            '<row r="3"/>' +
            '<row r="4"><c r="B4" t="str"><f>A1</f><v>say "hi"</v></c></row>',
        },
      ],
      [
        '<t>prompt</t>',
        '<r><t>vol</t></r><r><t xml:space="preserve">ume </t></r><rPh><t>ボ</t></rPh>',
      ],
    );
    expect(workbookText(bytes)).toBe(
      '# Prompts & volume\nprompt,,volume \n"best crm, for teams",,1200.5,TRUE\n,"say ""hi"""',
    );
  });

  it(`reads the first ${MAX_SHEETS} sheets and ${MAX_SHEET_ROWS} rows of each, and says what it left out`, () => {
    const rows = Array.from(
      { length: MAX_SHEET_ROWS + 2 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i + 1}</v></c></row>`,
    ).join('');
    const bytes = workbook([
      { name: 'Q1', rows },
      { name: 'Q2', rows: '<row r="1"><c r="A1"><v>2</v></c></row>' },
      { name: 'Q3', rows: '' },
      { name: 'Q4', rows: '<row r="1"><c r="A1"><v>4</v></c></row>' },
      { name: 'Q5', rows: '' },
    ]);
    const text = workbookText(bytes);
    const [q1, q2, q3, left] = text.split('\n\n');
    expect(q1.split('\n')).toHaveLength(1 + MAX_SHEET_ROWS + 1);
    expect(q1.split('\n').at(-2)).toBe(String(MAX_SHEET_ROWS));
    expect(q1.split('\n').at(-1)).toBe('(cut here: 2 more rows in this sheet were left out)');
    expect(q2).toBe('# Q2\n2');
    expect(q3).toBe('# Q3');
    expect(left).toBe('(cut here: 2 more sheets were left out: "Q4", "Q5")');
  });

  it('reads a workbook the app itself writes', async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/node');
    const sheet = await writeXlsxFile(
      [
        [{ value: 'prompt' }, { value: 'volume' }],
        [{ value: 'best crm, for teams' }, { value: 1200 }],
      ],
      { sheet: 'Prompts' },
    ).toBuffer();
    expect(workbookText(new Uint8Array(sheet))).toBe(
      '# Prompts\nprompt,volume\n"best crm, for teams",1200',
    );
  });

  it('throws for a file that isn’t a workbook', () => {
    expect(() => workbookText(new TextEncoder().encode('not a zip'))).toThrow();
    expect(() => workbookText(zipSync({ 'word/document.xml': strToU8('<w/>') }))).toThrow(
      'Not an Excel workbook',
    );
  });
});

describe('wordText', () => {
  it('keeps a Word file’s headings, lists and bold as Markdown', async () => {
    const docx = await import('docx');
    const bytes = await docx.Packer.toBuffer(
      new docx.Document({
        sections: [
          {
            children: [
              new docx.Paragraph({ text: 'Launch brief', heading: docx.HeadingLevel.HEADING_1 }),
              new docx.Paragraph({
                children: [
                  new docx.TextRun({ text: 'Goal', bold: true }),
                  new docx.TextRun(': more citations & mentions.'),
                ],
              }),
              new docx.Paragraph({ text: 'Audience', heading: docx.HeadingLevel.HEADING_2 }),
              new docx.Paragraph({ text: 'Marketing teams', bullet: { level: 0 } }),
              new docx.Paragraph({ text: 'Agencies', bullet: { level: 0 } }),
            ],
          },
        ],
      }),
    );
    expect(await wordText(new Uint8Array(bytes))).toBe(
      '# Launch brief\n\n**Goal**: more citations & mentions.\n\n## Audience\n\n- Marketing teams\n- Agencies',
    );
  });

  it('throws for a file that isn’t a Word file', async () => {
    await expect(wordText(new TextEncoder().encode('not a zip'))).rejects.toThrow();
  });
});

describe('htmlToText', () => {
  it('drops images and tags, keeps table rows, and decodes escapes', () => {
    expect(
      htmlToText(
        '<p>A &amp; B &lt;3 &#39;x&#x27;</p><p><img src="data:image/png;base64,AAAA" /></p><table><tr><td>a</td><td>b</td></tr></table>',
      ),
    ).toBe("A & B <3 'x'\n\na | b |");
    expect(decodeEntities('&unknown; &#99999999;')).toBe('&unknown; &#99999999;');
  });
});
