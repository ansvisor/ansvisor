import messages from '../../messages/en.json';

/**
 * Competitor types (00542): what kind of competitor each one is. A brand
 * picks one of the generic types, stored by its key, or makes up its own
 * label ("Tour operator"), stored as typed. The brand's own labels are the
 * types its competitors have, so a label typed once is offered for the rest.
 * Null is no type.
 *
 * A plain module: the pages, the server actions and Chat and the MCP Server
 * share it ('use server' files export async functions only).
 */

/** The generic types every brand is offered, in the order the picker lists them. */
export const DEFAULT_COMPETITOR_TYPES = ['direct', 'marketplace', 'publisher', 'other'] as const;

export type DefaultCompetitorType = (typeof DEFAULT_COMPETITOR_TYPES)[number];

/** The longest type the database keeps (competitors_type_check). */
export const COMPETITOR_TYPE_MAX_LENGTH = 40;

/** A type filter's value for the competitors without a type. */
export const NO_COMPETITOR_TYPE = 'none';

const DEFAULT_LABELS: Record<DefaultCompetitorType, string> = messages.competitors.type.defaults;

/** The generic types' names, quoted, for Chat's and the MCP Server's tool descriptions. */
export const DEFAULT_COMPETITOR_TYPE_NAMES = DEFAULT_COMPETITOR_TYPES.map(
  (t) => `"${DEFAULT_LABELS[t]}"`,
).join(', ');

/**
 * How Chat's and the MCP Server's competitor reads describe a type, after
 * "type, the kind of competitor it is: ".
 */
export const COMPETITOR_TYPE_WORDS =
  `one of ${DEFAULT_COMPETITOR_TYPE_NAMES}, or a label the brand made up ` +
  '(e.g. "Reseller"); null when it has none.';

/** How they describe their type filter. */
export const COMPETITOR_TYPE_FILTER_WORDS =
  'Only competitors of this type: its name as the reads give it (any case), or "none" for ' +
  'the ones without a type.';

/**
 * A database without competitors.type yet (a web deployed ahead of 00542):
 * Postgres' 42703 on a read. The reads then go on without types, so every
 * competitor reads as untyped, as before.
 */
export function missingCompetitorTypeColumn(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    (error?.code === '42703' || error?.code === 'PGRST204') && /\btype\b/.test(error.message ?? '')
  );
}

function isDefaultType(value: string): value is DefaultCompetitorType {
  return (DEFAULT_COMPETITOR_TYPES as readonly string[]).includes(value);
}

/** Case and inner spaces aside, as two labels are compared. */
const labelKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * How a stored type reads: a generic type's name, a brand's own label as it
 * was typed, or null for none.
 */
export function competitorTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return isDefaultType(type) ? DEFAULT_LABELS[type] : type;
}

export type NormalizedCompetitorType =
  | { ok: true; type: string | null }
  | { ok: false; reason: 'too_long' };

/**
 * What a typed type is stored as: null for an empty one (or "none"); a generic type's key
 * when it names one (by key or by name, in any case); one of the brand's own
 * labels as the brand first wrote it when it matches one in any case; else
 * the label as typed, its spaces tidied. Longer than the database keeps is
 * refused.
 */
export function normalizeCompetitorType(
  raw: string | null | undefined,
  brandTypes: readonly (string | null | undefined)[] = [],
): NormalizedCompetitorType {
  const tidy = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!tidy) return { ok: true, type: null };
  const key = labelKey(tidy);
  // "none" or "No type" typed in means no type, as the filter reads it.
  if (key === NO_COMPETITOR_TYPE || key === labelKey(messages.competitors.type.none)) {
    return { ok: true, type: null };
  }
  for (const type of DEFAULT_COMPETITOR_TYPES) {
    if (key === type || key === labelKey(DEFAULT_LABELS[type])) return { ok: true, type };
  }
  const known = brandTypes.find((t) => t && !isDefaultType(t) && labelKey(t) === key);
  if (known) return { ok: true, type: known };
  if (tidy.length > COMPETITOR_TYPE_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  return { ok: true, type: tidy };
}

/**
 * The types the brand's picker offers: the generic ones first, then the
 * brand's own labels (the types its competitors have) from A to Z. Only this
 * brand's competitors are passed in, so another brand's labels never show.
 */
export function competitorTypeOptions(competitors: readonly { type?: string | null }[]): string[] {
  const own = new Map<string, string>();
  for (const c of competitors) {
    if (!c.type || isDefaultType(c.type)) continue;
    const key = labelKey(c.type);
    if (!own.has(key)) own.set(key, c.type);
  }
  const custom = [...own.values()].sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' }),
  );
  return [...DEFAULT_COMPETITOR_TYPES, ...custom];
}

/**
 * Whether a competitor's type answers a filter: a type's key or name in any
 * case, or "none" for the competitors without one. An empty filter lets all
 * through.
 */
export function matchesCompetitorType(
  type: string | null | undefined,
  filter: string | null | undefined,
): boolean {
  const wanted = labelKey(filter ?? '');
  if (!wanted) return true;
  if (wanted === NO_COMPETITOR_TYPE) return !type;
  if (!type) return false;
  return wanted === labelKey(type) || wanted === labelKey(competitorTypeLabel(type) ?? '');
}

export interface CompetitorTypeGroup<T> {
  /** The stored type, or null for the competitors without one. */
  type: string | null;
  items: T[];
}

/**
 * Competitors grouped by type for a list: the generic types in the picker's
 * order, then the brand's own labels from A to Z, the ones without a type
 * last. Empty groups are left out; each group keeps the list's order.
 */
export function groupCompetitorsByType<T extends { type?: string | null }>(
  competitors: readonly T[],
): CompetitorTypeGroup<T>[] {
  const order = competitorTypeOptions(competitors);
  const groups = new Map<string | null, T[]>();
  for (const type of [...order, null]) groups.set(type, []);
  for (const c of competitors) {
    const type = c.type ?? null;
    const group = groups.get(type);
    if (group) group.push(c);
    else {
      // A label in another case than the one listed: with the listed one.
      const listed = order.find((t) => type && labelKey(t) === labelKey(type)) ?? null;
      groups.get(listed)!.push(c);
    }
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([type, items]) => ({ type, items }));
}
