/**
 * The one record a read read, by name, for its step's "Data used" chip (UX
 * audit CH-10): an action by its code ("AC-12"), a report, an opportunity
 * or a mention by its title. Null for a read of many, or a result without
 * a name: the chip keeps the source's name.
 */

/** The reads of one record by its id, and how each names it. */
const NAMES: Record<string, (value: Record<string, unknown>) => unknown> = {
  get_action: (value) => value.code,
  get_report: (value) => value.title,
  get_content_opportunity: (value) => value.title,
};

/** The longest name a chip shows; a longer title is cut with "…". */
const MAX = 60;

export function stepRecord(tool: string, value: unknown): string | null {
  const name = NAMES[tool];
  if (!name || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const said = name(value as Record<string, unknown>);
  if (typeof said !== 'string') return null;
  const text = said.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
}
