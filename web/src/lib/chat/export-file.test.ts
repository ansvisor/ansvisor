// @vitest-environment node
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { answerMarkdown, type ExportAnswer } from './export';
import { ANSWER_CONTENT_TYPES, exportAnswer } from './export-file';

const MARKDOWN = `## Neden düştü?

Perplexity **şubatta** düştü ¹ — [kaynak](https://example.com/a?b=1&c=2).

1. Fiyat sayfası
2. SSS bölümü

- [Citations · 42 rows](/dashboard/citations?platform=perplexity)

## Sayfalar

| Sayfa | Atıf |
|---|---:|
| /fiyat | 1,234 |
| Ğüzel İşler | 56.5 |

| Rakip | Görünürlük |
|---|---|
| Çiçek Ltd | 4 |
`;

const ANSWER: ExportAnswer = {
  markdown: MARKDOWN,
  question: 'Why did Perplexity citations drop?',
  chatTitle: 'Perplexity drop',
  generatedAt: '2026-10-26T06:14:00Z',
  timezone: 'Europe/Istanbul',
  stamp: 'Generated Oct 26, 2026 · 09:14 GMT+3 · Data as of Oct 26, 2026 · 06:00',
  appOrigin: 'https://app.ansvisor.com',
};

const ONE_TABLE = { ...ANSWER, markdown: MARKDOWN.slice(0, MARKDOWN.indexOf('| Rakip')) };
const NO_TABLE = { ...ANSWER, markdown: 'Plain answer, **no** table. Çok güzel.' };

/** The byte order mark Excel reads UTF-8 by (TextDecoder drops it when it reads text). */
const BOM = [0xef, 0xbb, 0xbf];

/** A zip's files as text. */
function unzipText(body: Uint8Array): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(body)).map(([name, data]) => [name, strFromU8(data)]),
  );
}

describe('exportAnswer', () => {
  it('writes Markdown as UTF-8, named by the question and the day', async () => {
    const file = await exportAnswer(ANSWER, 'md');
    expect(file?.fileName).toBe('why-did-perplexity-citations-drop-2026-10-26.md');
    expect(file?.contentType).toBe(ANSWER_CONTENT_TYPES.md);
    expect(strFromU8(file!.body)).toBe(answerMarkdown(ANSWER));
  });

  it('writes Word: the question, the answer with its lists, table and links, the line in header and footer', async () => {
    const file = await exportAnswer(ANSWER, 'docx');
    expect(file?.fileName).toBe('why-did-perplexity-citations-drop-2026-10-26.docx');
    expect(file?.contentType).toBe(ANSWER_CONTENT_TYPES.docx);
    const parts = unzipText(file!.body);
    const body = parts['word/document.xml'];
    for (const text of [
      'Why did Perplexity citations drop?',
      'Neden düştü?',
      'şubatta',
      'Fiyat sayfası',
      'Ğüzel İşler',
      'Çiçek Ltd',
    ]) {
      expect(body).toContain(text);
    }
    expect(body).toContain('<w:tbl>');
    expect(body).toMatch(/<w:hyperlink [^>]*r:id=/);
    const rels = parts['word/_rels/document.xml.rels'];
    expect(rels).toContain('Target="https://example.com/a?b=1&amp;c=2"');
    expect(rels).toContain(
      'Target="https://app.ansvisor.com/dashboard/citations?platform=perplexity"',
    );
    const header = Object.keys(parts).find((name) => /^word\/header\d*\.xml$/.test(name));
    const footer = Object.keys(parts).find((name) => /^word\/footer\d*\.xml$/.test(name));
    expect(parts[header!]).toContain(ANSWER.stamp);
    expect(parts[footer!]).toContain(ANSWER.stamp);
  });

  it('writes one table as a CSV: the byte order mark, the line, then the table', async () => {
    const file = await exportAnswer(ONE_TABLE, 'csv');
    expect(file?.fileName).toBe('why-did-perplexity-citations-drop-2026-10-26.csv');
    expect(file?.contentType).toBe(ANSWER_CONTENT_TYPES.csv);
    expect([...file!.body.slice(0, 3)]).toEqual(BOM);
    // The line has commas, so it is one quoted cell.
    expect(strFromU8(file!.body.slice(3)).split('\n')).toEqual([
      `"${ANSWER.stamp}"`,
      'Sayfa,Atıf',
      '/fiyat,"1,234"',
      'Ğüzel İşler,56.5',
    ]);
  });

  it('zips one CSV per table when there are several', async () => {
    const file = await exportAnswer(ANSWER, 'csv');
    expect(file?.fileName).toBe('why-did-perplexity-citations-drop-2026-10-26.zip');
    expect(file?.contentType).toBe(ANSWER_CONTENT_TYPES.zip);
    const files = unzipSync(file!.body);
    expect(Object.keys(files)).toEqual([
      'why-did-perplexity-citations-drop-2026-10-26-1-sayfalar.csv',
      'why-did-perplexity-citations-drop-2026-10-26-2-sayfalar.csv',
    ]);
    const [first, second] = Object.values(files);
    for (const csv of [first, second]) expect([...csv.slice(0, 3)]).toEqual(BOM);
    expect(strFromU8(first.slice(3)).startsWith(`"${ANSWER.stamp}"\n`)).toBe(true);
    expect(strFromU8(second)).toContain('Çiçek Ltd,4');
  });

  it('writes Excel with one sheet per table, the line on top of each', async () => {
    const file = await exportAnswer(ANSWER, 'xlsx');
    expect(file?.fileName).toBe('why-did-perplexity-citations-drop-2026-10-26.xlsx');
    expect(file?.contentType).toBe(ANSWER_CONTENT_TYPES.xlsx);
    const parts = unzipText(file!.body);
    expect(parts['xl/workbook.xml']).toContain('name="Sayfalar"');
    expect(parts['xl/workbook.xml']).toContain('name="Sayfalar (2)"');
    const text = Object.entries(parts)
      .filter(([name]) => name.startsWith('xl/'))
      .map(([, xml]) => xml)
      .join('\n');
    for (const value of [ANSWER.stamp, 'Atıf', 'Ğüzel İşler', 'Çiçek Ltd', 'Görünürlük']) {
      expect(text).toContain(value);
    }
    // 1,234 is a number Excel can sum.
    expect(parts['xl/worksheets/sheet1.xml']).toContain('<v>1234</v>');
  });

  it('has no CSV or Excel for an answer without a table', async () => {
    expect(await exportAnswer(NO_TABLE, 'csv')).toBeNull();
    expect(await exportAnswer(NO_TABLE, 'xlsx')).toBeNull();
    expect(await exportAnswer(NO_TABLE, 'md')).not.toBeNull();
  });

  it('writes a PDF with Inter embedded for Turkish letters, and its links clickable', async () => {
    const file = await exportAnswer(ANSWER, 'pdf');
    expect(file?.fileName).toBe('why-did-perplexity-citations-drop-2026-10-26.pdf');
    expect(file?.contentType).toBe(ANSWER_CONTENT_TYPES.pdf);
    const pdf = Buffer.from(file!.body).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toMatch(/\/FontName \/[A-Z]{6}\+Inter/);
    expect(pdf).toContain('/URI (https://example.com/a?b=1&c=2)');
    expect(pdf).toContain(
      '/URI (https://app.ansvisor.com/dashboard/citations?platform=perplexity)',
    );
  }, 30_000);
});
