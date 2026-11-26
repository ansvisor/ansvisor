const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

export function spreadsheetCell(value: unknown): string | number | boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === null || value === undefined) return '';

  let s = String(value);
  if (typeof value === 'string' && FORMULA_PREFIX_REGEX.test(s)) {
    s = `'${s}`;
  }

  return s;
}

function escape(value: unknown): string {
  const s = String(spreadsheetCell(value));
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One line of values, each escaped as toCsv escapes a cell. */
export function csvLine(values: unknown[]): string {
  return values.map(escape).join(',');
}

export function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const headerLine = headers.join(',');
  const dataLines = rows.map((row) => csvLine(headers.map((header) => row[header])));

  return [headerLine, ...dataLines].join('\n');
}
