function escape(value: unknown): string {
  if (value === null || value === undefined) return '';

  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const headerLine = headers.join(',');
  const dataLines = rows.map((row) =>
    headers.map((header) => escape(row[header])).join(','),
  );

  return [headerLine, ...dataLines].join('\n');
}
