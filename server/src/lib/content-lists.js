import * as cheerio from 'cheerio';

/**
 * Lists and tables as the Content Agent's pages should hold them (Content
 * test 2026-11-19, items 11 and 12): a How-to's steps came as paragraphs
 * starting "1.", "2." with no <ol>, so "Steps as a numbered list" stayed
 * Missing; a Best-of list wrote "1. Ansvisor…" inside a <ul>; and no page
 * had a table, as the writer could write none.
 */

/** A number written at an item's start: "1. ", "2) ". */
const LEADING_NUMBER = /^\s*(\d{1,2})[.)]\s+/;

/** The number an element's words open with, or null. */
function leadingNumber($, el) {
  const match = $(el).text().match(LEADING_NUMBER);
  return match ? Number(match[1]) : null;
}

/** Takes the number off the first words of an element, in its first text. */
function dropLeadingNumber($, el) {
  const stack = [el];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node.type === 'text') {
      if (!node.data.trim()) continue;
      node.data = node.data.replace(LEADING_NUMBER, '');
      return;
    }
    stack.unshift(...(node.children ?? []));
  }
}

/** Whether numbers run 1, 2, 3… (or on from where they start), as steps do. */
const inOrder = (numbers) => numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);

/**
 * A page's numbered paragraphs as a numbered list, and the numbers a list
 * wrote into its items taken off: two or more paragraphs in a row, each
 * opening with the next number, become an <ol>; a <ul> whose items are all
 * numbered in order becomes an <ol> without them. Anything else is as it was.
 */
export function numberedLists(html) {
  // Nothing numbered at all: the page as it was, unread.
  if (!/\d[.)]\s/.test(String(html ?? ''))) return html;
  const $ = cheerio.load(html || '', null, false);
  let changed = false;

  // Lists that number their items by hand.
  $('ul').each((_, ul) => {
    const items = $(ul).children('li').toArray();
    const numbers = items.map((li) => leadingNumber($, li));
    if (items.length < 2 || numbers.some((n) => n === null) || !inOrder(numbers)) return;
    for (const li of items) dropLeadingNumber($, li);
    ul.name = 'ol';
    changed = true;
  });

  // Runs of numbered paragraphs, under the same parent.
  const runs = [];
  let run = [];
  const close = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  $('p').each((_, p) => {
    const number = leadingNumber($, p);
    const last = run.at(-1);
    const follows =
      last &&
      number !== null &&
      number === leadingNumber($, last) + 1 &&
      // The next element after the last one, whitespace aside.
      $(last).nextAll().first()[0] === p;
    if (follows) {
      run.push(p);
      return;
    }
    close();
    if (number !== null) run.push(p);
  });
  close();
  for (const paragraphs of runs) {
    const items = paragraphs.map((p) => {
      dropLeadingNumber($, p);
      return `<li><p>${$(p).html()}</p></li>`;
    });
    $(paragraphs[0]).before(`<ol>${items.join('')}</ol>`);
    for (const p of paragraphs) $(p).remove();
    changed = true;
  }
  return changed ? $.html() : html;
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeText = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
const clean = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** The most columns and rows a written table keeps. */
export const MAX_TABLE_COLUMNS = 8;
export const MAX_TABLE_ROWS = 20;

/**
 * A table as the writer wrote it ({ columns, rows }), as HTML: a header row
 * and a row per option, each as wide as the header (cut, or padded with
 * empty cells). '' for one with fewer than two columns or no row with words.
 */
export function tableHtml(table) {
  const columns = (table?.columns ?? []).map(clean).slice(0, MAX_TABLE_COLUMNS);
  if (columns.length < 2 || columns.every((c) => !c)) return '';
  const rows = (table?.rows ?? [])
    .map((row) => columns.map((_, i) => clean(Array.isArray(row) ? row[i] : '')))
    .filter((row) => row.some(Boolean))
    .slice(0, MAX_TABLE_ROWS);
  if (!rows.length) return '';
  const cells = (tag, values) =>
    values.map((value) => `<${tag}><p>${escapeText(value)}</p></${tag}>`).join('');
  return `<table><tbody><tr>${cells('th', columns)}</tr>${rows
    .map((row) => `<tr>${cells('td', row)}</tr>`)
    .join('')}</tbody></table>`;
}

/** Page types that weigh options against each other: each wants a comparison table. */
export const TABLE_PAGE_TYPES = new Set(['comparison', 'alternatives', 'best_of']);

/** What a page of these types is told about its table, or ''. */
export function tableLine(pageType) {
  return TABLE_PAGE_TYPES.has(pageType)
    ? "Table: this page compares options, so one section has a table: the options in rows (first column the option's name), the criteria that tell them apart in columns, each cell a short fact. Only facts you were given or ask to have looked up.\n"
    : '';
}
