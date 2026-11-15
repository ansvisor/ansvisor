/**
 * CSV for the API's exports, cell for cell as the web writes its own
 * (web/src/lib/csv.ts `toCsv`): a cell a spreadsheet would run as a formula
 * (= + - @, a tab or a return first) gets a ' before it, and a cell with a
 * comma, a quote or a line break is quoted. csv.test.js keeps the two in step.
 *
 * One addition: `keep` names columns of keywords, whose match-type syntax
 * ([exact], "phrase", +broad, +modified +broad) is the keyword itself. Only
 * +broad starts like a formula, and a ' would make it another keyword, so a
 * keyword cell of words alone (letters, digits, marks, spaces, ' & . / + -)
 * is left as it is: with no = @ ( ) | ! : nothing in it can run. Any other
 * keyword cell gets the ' as every cell does.
 */

/** web/src/lib/csv.ts's: a spreadsheet's formula prefixes. */
export const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

/** A keyword cell left as it is: words alone, after an optional + (broad match modifier). */
const KEYWORD_CELL = /^\+?[\p{L}\p{N}][\p{L}\p{N}\p{M} '&./+-]*$/u;

function escape(value, keyword = false) {
  if (value === null || value === undefined) return '';

  let s = String(value);
  if (
    typeof value === 'string' &&
    FORMULA_PREFIX_REGEX.test(s) &&
    !(keyword && KEYWORD_CELL.test(s))
  ) {
    s = `'${s}`;
  }

  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Rows under their headers, a line each.
 * @param {Record<string, unknown>[]} rows
 * @param {string[]} headers
 * @param {{ keep?: string[] }} [options] keyword columns, whose match-type syntax is kept
 */
export function toCsv(rows, headers, { keep = [] } = {}) {
  const line = (row) => headers.map((h) => escape(row[h], keep.includes(h))).join(',');
  return [headers.map((h) => escape(h)).join(','), ...rows.map(line)].join('\n');
}
