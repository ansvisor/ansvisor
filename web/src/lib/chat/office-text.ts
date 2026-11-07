import { strFromU8, unzipSync } from 'fflate';

/**
 * A Word or Excel attachment as text for the model (00409; the owner's
 * request of 2026-11-06): no model reads either file as it is, so the
 * server turns it into text first, and it reaches the model as any text
 * file does, in its labelled untrusted block (attachments.ts). A Word file
 * keeps its headings, lists and bold as Markdown (mammoth, as the Content
 * Editor reads Word files); an Excel workbook gives its first sheets as CSV,
 * read straight from its XML (fflate), with a line for what was left out.
 * Throws when a file can't be read: the run says so for that file only.
 * Server only.
 */

/** The sheets a workbook gives, at most, and the rows of each. */
export const MAX_SHEETS = 3;
export const MAX_SHEET_ROWS = 500;
/** A workbook part larger than this, unzipped, isn't read (a zip bomb, or a sheet far past the rows read). */
export const MAX_PART_BYTES = 40 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML's and HTML's escapes as the characters they stand for. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

// ─── Word ───────────────────────────────────────────────────────────────────

/** mammoth's HTML as Markdown-ish text: headings, list items, bold and table rows kept. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n\n${'#'.repeat(Number(level))} `)
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/?strong>/gi, '**')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<\/(?:p|ul|ol|table|tr)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A Word file's text, its headings and lists as Markdown; its images left out. */
export async function wordText(bytes: Uint8Array): Promise<string> {
  const { default: mammoth } = await import('mammoth');
  const { value } = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    // An image's bytes never go into the text: an empty one, removed with its tag.
    { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) },
  );
  return htmlToText(value);
}

// ─── Excel ──────────────────────────────────────────────────────────────────

/** An element's tag, with any namespace prefix (`x:c`, as some writers put it). */
const tag = (name: string) => `<(?:[\\w-]+:)?${name}`;
const closing = (name: string) => `</(?:[\\w-]+:)?${name}>`;

/** The words of an element's text runs (`<t>`), phonetic guides left out. */
function runsText(xml: string): string {
  const plain = xml.replace(new RegExp(`${tag('rPh')}\\b[\\s\\S]*?${closing('rPh')}`, 'g'), '');
  const runs = plain.matchAll(
    new RegExp(`${tag('t')}(?:\\s[^>]*)?>([\\s\\S]*?)${closing('t')}`, 'g'),
  );
  return Array.from(runs, (run) => decodeEntities(run[1])).join('');
}

/** An attribute's value in a tag's attributes; `prefixed` for one with a namespace (`r:id`). */
function attribute(attrs: string, name: string, prefixed = false): string | null {
  const match = new RegExp(`\\s${prefixed ? '[\\w-]+:' : ''}${name}="([^"]*)"`).exec(attrs);
  return match ? decodeEntities(match[1]) : null;
}

/** A cell reference's column from 0 ("C7" → 2); null without one. */
function columnOf(ref: string | null): number | null {
  const letters = ref ? /^([A-Z]+)/i.exec(ref)?.[1] : null;
  if (!letters) return null;
  let column = 0;
  for (const letter of letters.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return column - 1;
}

/** A cell as CSV writes it. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A sheet's rows as CSV, the first MAX_SHEET_ROWS with values, and how many more there were. */
function sheetCsv(xml: string, shared: readonly string[]): { csv: string; more: number } {
  const lines: string[] = [];
  let more = 0;
  const rows = xml.matchAll(
    new RegExp(`${tag('row')}\\b[^>]*?(?:/>|>([\\s\\S]*?)${closing('row')})`, 'g'),
  );
  for (const row of rows) {
    const cells: string[] = [];
    const found = (row[1] ?? '').matchAll(
      new RegExp(`${tag('c')}\\b([^>]*?)(?:/>|>([\\s\\S]*?)${closing('c')})`, 'g'),
    );
    for (const cell of found) {
      const attrs = cell[1];
      const inner = cell[2] ?? '';
      const raw = new RegExp(`${tag('v')}>([\\s\\S]*?)${closing('v')}`).exec(inner)?.[1];
      const type = attribute(attrs, 't');
      let value: string;
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = runsText(inner);
      else if (type === 'b') value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : '';
      else value = raw === undefined ? '' : decodeEntities(raw);
      const at = columnOf(attribute(attrs, 'r')) ?? cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.length === 0) continue;
    if (lines.length >= MAX_SHEET_ROWS) more += 1;
    else lines.push(cells.map(csvCell).join(','));
  }
  return { csv: lines.join('\n'), more };
}

/** A workbook part's path from its relationship's target ("worksheets/sheet1.xml" or "/xl/…"). */
const partPath = (target: string) =>
  target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;

/**
 * An Excel workbook's first MAX_SHEETS sheets as CSV, each under its name,
 * each its first MAX_SHEET_ROWS rows: shared and inline strings, numbers
 * and booleans as they are stored (no formulas, styles or dates as dates).
 * A "(cut here …)" line says what was left out.
 */
export function workbookText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (
        !/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(
          file.name,
        )
      ) {
        return false;
      }
      if (file.originalSize > MAX_PART_BYTES) throw new Error(`${file.name} is too large to read`);
      return true;
    },
  });
  const read = (path: string) => (files[path] ? strFromU8(files[path]) : null);
  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new Error('Not an Excel workbook');

  const shared = Array.from(
    (read('xl/sharedStrings.xml') ?? '').matchAll(
      new RegExp(`${tag('si')}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)${closing('si')})`, 'g'),
    ),
    (item) => runsText(item[1] ?? ''),
  );
  const targets = new Map<string, string>();
  for (const rel of (read('xl/_rels/workbook.xml.rels') ?? '').matchAll(
    /<(?:[\w-]+:)?Relationship\b([^>]*)\/?>/g,
  )) {
    const id = attribute(rel[1], 'Id');
    const target = attribute(rel[1], 'Target');
    if (id && target) targets.set(id, partPath(target));
  }
  const sheets = Array.from(
    workbook.matchAll(new RegExp(`${tag('sheet')}\\b([^>]*?)/?>`, 'g')),
    (sheet, i) => {
      const id = attribute(sheet[1], 'id', true);
      return {
        name: attribute(sheet[1], 'name') ?? `Sheet${i + 1}`,
        path: (id && targets.get(id)) || `xl/worksheets/sheet${i + 1}.xml`,
      };
    },
  );

  const parts: string[] = [];
  for (const sheet of sheets.slice(0, MAX_SHEETS)) {
    const xml = read(sheet.path);
    if (xml === null) continue;
    const { csv, more } = sheetCsv(xml, shared);
    parts.push(
      [
        `# ${sheet.name}`,
        csv,
        ...(more > 0 ? [`(cut here: ${more} more rows in this sheet were left out)`] : []),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  const left = sheets.slice(MAX_SHEETS);
  if (left.length > 0) {
    parts.push(
      `(cut here: ${left.length} more ${left.length === 1 ? 'sheet was' : 'sheets were'} left out: ${left
        .map((sheet) => `"${sheet.name}"`)
        .join(', ')})`,
    );
  }
  return parts.join('\n\n');
}
