/**
 * A signal's code as the app shows it, "S-03": its number in its brand
 * (`signals.brand_no`, 00534), two digits at least. Display only: signals
 * had no code before, and every link to a signal points by id
 * (`?signal=`). Null until the signal's brand is numbered.
 */

/** What a signal's code is built from. */
type Numbered = { brandNo?: number | null };

export function signalCode(signal: Numbered): string | null {
  return signal.brandNo ? `S-${String(signal.brandNo).padStart(2, '0')}` : null;
}

/**
 * The signal number a search names, as the app shows it or as typed: "S-03",
 * "s-3", "S 3", "S3", "#3" or "3". Null for any other text, and for 0.
 */
export function searchedSignalNo(query: string): number | null {
  const match = /^(?:s[-\s]?|#)?(\d{1,9})$/i.exec(query.trim());
  const no = match ? Number(match[1]) : 0;
  return no > 0 ? no : null;
}

/** Whether a search names this signal by its code: "S-03", "s-3", "S3", "#3" or "3". */
export function matchesSignalCode(signal: Numbered, query: string): boolean {
  const no = searchedSignalNo(query);
  return Boolean(no && signal.brandNo && no === signal.brandNo);
}
