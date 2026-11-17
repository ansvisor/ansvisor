/**
 * Merging duplicate competitors (00543), shared by the Competitors page, the
 * competitor actions, Chat and MCP. A plain module: the 'use server' files
 * import from it, they never export from it.
 *
 * A merged competitor leaves the competitors table for merged_competitors,
 * so every read of the brand's competitors leaves it out, as it leaves out a
 * deleted one. Its name and domain are the kept competitor's other names:
 * from the merge on, an answer naming any of them counts for the kept one.
 * Numbers from before the merge aren't combined.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Competitor } from '@/types';

/** The most competitors one merge takes into the one kept (merge_competitors' limit). */
export const MAX_MERGED_AT_ONCE = 50;

/** A name or domain merged into a competitor, matched as its own. */
export interface CompetitorAlias {
  /** The merged competitor's id, which its history keeps. */
  id: string;
  name: string;
  domain: string;
}

/** A competitor merged into another of the brand's, as the Merged competitors list shows it. */
export interface MergedCompetitor extends CompetitorAlias {
  type: string | null;
  mergedIntoId: string;
  /** The kept competitor's name; empty when it can't be read. */
  mergedIntoName: string;
  mergedAt: string;
  /** Who merged it: their name, or null when it isn't known. */
  mergedBy: string | null;
}

/** A merged_competitors row as the reads select it. */
export interface MergedCompetitorRow {
  id: string;
  merged_into_id: string;
  name: string;
  domain: string | null;
}

/** A domain as two are compared: scheme, www, case, path and trailing dot aside. */
export function competitorDomainKey(domain: string | null | undefined): string {
  return (domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

/** A name as two are compared: case, accents, punctuation and spacing aside. */
function nameWords(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Each kept competitor's merged names and domains, by its id. */
export function aliasesByCompetitor(
  rows: readonly MergedCompetitorRow[],
): Map<string, CompetitorAlias[]> {
  const byKept = new Map<string, CompetitorAlias[]>();
  for (const row of rows) {
    const list = byKept.get(row.merged_into_id) ?? [];
    list.push({ id: row.id, name: row.name, domain: row.domain ?? '' });
    byKept.set(row.merged_into_id, list);
  }
  return byKept;
}

/**
 * The merged competitor a new competitor would be again: the same domain, or
 * without a domain the same name (case aside), as add_competitors tells a
 * competitor the brand already has. Null when it is none of them.
 */
export function mergedMatch<T extends { name: string; domain: string | null }>(
  item: { name: string; domain?: string | null },
  merged: readonly T[],
): T | null {
  const domain = competitorDomainKey(item.domain);
  const name = item.name.trim().toLowerCase();
  return (
    merged.find((m) =>
      domain
        ? competitorDomainKey(m.domain) === domain
        : !!name && m.name.trim().toLowerCase() === name,
    ) ?? null
  );
}

/**
 * Pairs of the brand's competitors that may be one company, for the
 * Competitors page's "These may be the same company" hint: the same domain;
 * the same name once case, accents and punctuation are aside ("Sky Air",
 * "SkyAir", "sky-air"); one name the start of the other, word for word ("Sky
 * Air" and "Sky Air Tours"); or one's name its domain's name ("Sky Air" and
 * skyair.example). A short name (under 4 letters) is never matched by name.
 * In the list's order, each pair once.
 */
export function likelyDuplicates(
  competitors: readonly Pick<Competitor, 'id' | 'name' | 'domain'>[],
): [string, string][] {
  const info = competitors.map((c) => {
    const words = nameWords(c.name);
    const domain = competitorDomainKey(c.domain);
    return {
      id: c.id,
      words,
      compact: words.join(''),
      domain,
      domainName: domain.split('.')[0]?.replace(/[^\p{L}\p{N}]+/gu, '') ?? '',
    };
  });
  const pairs: [string, string][] = [];
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const a = info[i];
      const b = info[j];
      if (sameCompany(a, b)) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

function sameCompany(
  a: { words: string[]; compact: string; domain: string; domainName: string },
  b: { words: string[]; compact: string; domain: string; domainName: string },
): boolean {
  if (a.domain && a.domain === b.domain) return true;
  const [short, long] = a.compact.length <= b.compact.length ? [a, b] : [b, a];
  if (short.compact.length < 4) return false;
  if (short.compact === long.compact) return true;
  if (short.words.length > 0 && short.words.every((word, i) => long.words[i] === word)) {
    return true;
  }
  return (
    (a.domainName.length >= 4 && a.domainName === b.compact) ||
    (b.domainName.length >= 4 && b.domainName === a.compact)
  );
}

/**
 * The brand's competitor domains as the Citations page and the answer drawer
 * tell a competitor's site: the tracked competitors' and (00543) the merged
 * ones', which are the kept competitor's sites. In the shape of the
 * competitors read it replaces ({ data: [{ domain }] }); the merged ones are
 * left out when they can't be read (a database without 00543), as before.
 */
export async function competitorDomainRows(
  // The person's client or the service role's; both scoped here by brand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  brandId: string,
): Promise<{ data: { domain: string }[] | null; error: { message: string } | null }> {
  const [live, merged] = await Promise.all([
    client.from('competitors').select('domain').eq('brand_id', brandId),
    client.from('merged_competitors').select('domain').eq('brand_id', brandId),
  ]);
  if (live.error) return { data: null, error: live.error };
  const rows = [...(live.data ?? []), ...(merged.error ? [] : (merged.data ?? []))] as {
    domain: string | null;
  }[];
  return { data: rows.map((row) => ({ domain: row.domain ?? '' })), error: null };
}

/**
 * The domains of the brand's merged competitors (00543) alone, for a read
 * that already has the tracked ones'. None when they can't be read.
 */
export async function mergedCompetitorDomains(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  brandId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('merged_competitors')
    .select('domain')
    .eq('brand_id', brandId);
  if (error) return [];
  return ((data ?? []) as { domain: string | null }[])
    .map((row) => row.domain ?? '')
    .filter(Boolean);
}
