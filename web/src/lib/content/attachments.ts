/**
 * Files attached to a draft (Content Editor CE-006, spec §9): what each kind
 * becomes in the page. A spreadsheet is previewed and inserted as a table;
 * Markdown, HTML, Word and text are imported as content, cleaned like a
 * paste. Files are data, never instructions (CHAT-05): they only ever become
 * page content.
 */

/** The most a file can be, as the spec's attachment limit. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** A table this long asks before it goes into the page. */
export const CONFIRM_TABLE_ROWS = 200;

/** Columns a table keeps; a wider sheet is cut at this many. */
export const MAX_TABLE_COLUMNS = 30;

export type AttachmentKind =
  | 'spreadsheet'
  | 'csv'
  | 'markdown'
  | 'html'
  | 'text'
  | 'word'
  | 'image'
  | 'legacyOffice'
  | 'unsupported';

const KINDS: Record<string, AttachmentKind> = {
  xlsx: 'spreadsheet',
  csv: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  txt: 'text',
  docx: 'word',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  // The old binary formats: saved again as .xlsx or .docx, they import.
  xls: 'legacyOffice',
  doc: 'legacyOffice',
};

/** What a file is, by its extension. */
export function attachmentKind(fileName: string): AttachmentKind {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return KINDS[ext] ?? 'unsupported';
}

/** What the file picker offers. */
export const ATTACHMENT_ACCEPT = '.xlsx,.csv,.md,.markdown,.html,.htm,.txt,.docx';

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A sheet's rows as they go into a table: as wide as its widest row (up to
 * MAX_TABLE_COLUMNS), short rows padded, empty rows and empty trailing
 * columns dropped.
 */
export function tableRows(rows: string[][]): string[][] {
  const kept = rows.filter((row) => row.some((cell) => cell.trim() !== ''));
  let width = 0;
  for (const row of kept) {
    for (let i = row.length - 1; i >= 0; i--) {
      if (row[i].trim() !== '') {
        width = Math.max(width, i + 1);
        break;
      }
    }
  }
  width = Math.min(width, MAX_TABLE_COLUMNS);
  return kept.map((row) => Array.from({ length: width }, (_, i) => (row[i] ?? '').trim()));
}

/** A table for the editor, its first row as the header; cell text escaped. */
export function tableHtml(rows: string[][]): string {
  const body = rows
    .map((row, r) => {
      const tag = r === 0 ? 'th' : 'td';
      return `<tr>${row.map((cell) => `<${tag}><p>${escapeHtml(cell)}</p></${tag}>`).join('')}</tr>`;
    })
    .join('');
  return `<table><tbody>${body}</tbody></table>`;
}

/** Plain text as paragraphs: blank lines part them, a single newline breaks a line. */
export function textToHtml(text: string): string {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}
