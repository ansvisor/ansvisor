import { extractHostname } from '@/lib/citations/classify';
import { citationUrlMatchKey } from '@/lib/citations/normalize';
import { searchedSignalNo } from '@/lib/signals/signal-code';

/**
 * Chat's direct lookups (the owner's rule of 2026-11-16: Chat reads all a
 * page shows, so "what is X?" never depends on X being on the first page of
 * a list). An item the person names by its code, its id, a few words of its
 * text or title, a domain or a page's address is read by that, whatever its
 * status, and what matches nothing comes back in `not_found`, with a note
 * that says to answer "not found" plainly, with where it looked, and never
 * with "the closest" others. The words and the matching are here, pure, so
 * the reads (data.ts, content.ts, signal-page.ts) and the agents' test set
 * (chat/testing/agent-eval-data.ts) answer alike. Text the model sends is
 * data: ids are checked as ids, codes become numbers, and words reach a
 * filter only as an escaped ilike pattern.
 */

/** The most codes, ids, domains or addresses one lookup reads: every one a message names. */
export const LOOKUP_MAX = 10;

/** The longest search one lookup takes, in characters. */
export const SEARCH_MAX_CHARS = 200;

/** The most words of a search a lookup matches. */
export const SEARCH_MAX_WORDS = 8;

/** What a lookup calls its items, and where it looked, in words an answer repeats. */
export interface LookupWords {
  one: string;
  many: string;
  /** Where it looked: "this brand's signals, every status and every date". */
  where: string;
}

export const LOOKUP_WORDS = {
  signals: {
    one: 'signal',
    many: 'signals',
    where: "this brand's signals, every status and every date",
  },
  prompts: {
    one: 'prompt',
    many: 'prompts',
    where: "this brand's tracked prompts, active and paused, in every topic",
  },
  opportunities: {
    one: 'opportunity',
    many: 'opportunities',
    where: "this brand's content opportunities, every status, archived included",
  },
  drafts: {
    one: 'draft',
    many: 'drafts',
    where: "this brand's Content Library drafts, every status, archived included",
  },
  reports: { one: 'report', many: 'reports', where: "this brand's saved reports" },
} as const satisfies Record<string, LookupWords>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

// ─── What was asked ─────────────────────────────────────────────────────────

/** How a lookup names its rows: by their code, or by their id. */
export type LookupBy = 'code' | 'id';

/** One thing asked: as written, how it is matched, and its key (a code's number, an id); null when it is neither. */
export interface AskedKey {
  text: string;
  by: LookupBy;
  key: string | number | null;
}

/** Each id once, lower case as Postgres keeps it; at most LOOKUP_MAX. Text that is no id keeps a null key. */
export function askedIds(ids: readonly string[] | undefined): AskedKey[] {
  const asked: AskedKey[] = [];
  for (const raw of ids ?? []) {
    const text = raw.trim();
    const key = UUID.test(text) ? text.toLowerCase() : null;
    if (!text || asked.some((a) => (key === null ? a.text === text : a.key === key))) continue;
    if (asked.length === LOOKUP_MAX) break;
    asked.push({ text, by: 'id', key });
  }
  return asked;
}

/** Each code once, as first written, with the number `numberOf` reads in it; at most LOOKUP_MAX. */
export function askedCodes(
  codes: readonly string[] | undefined,
  numberOf: (text: string) => number | null,
): AskedKey[] {
  const asked: AskedKey[] = [];
  for (const raw of codes ?? []) {
    const text = raw.trim();
    const key = numberOf(text);
    if (!text || asked.some((a) => (key === null ? a.text === text : a.key === key))) continue;
    if (asked.length === LOOKUP_MAX) break;
    asked.push({ text, by: 'code', key });
  }
  return asked;
}

/** Signals asked for by their codes ("S-07", "S 7", "s7", "#7", "7") and by their ids. */
export const askedSignals = (codes?: readonly string[], ids?: readonly string[]): AskedKey[] => [
  ...askedCodes(codes, searchedSignalNo),
  ...askedIds(ids),
];

/** The keys of one kind that a lookup reads: numbers for codes, ids for ids. */
export function keysOf<K extends string | number>(asked: readonly AskedKey[], by: LookupBy): K[] {
  return [...new Set(asked.flatMap((a) => (a.by === by && a.key !== null ? [a.key as K] : [])))];
}

/**
 * A search's words, as a lookup matches them: each somewhere in the text,
 * in any order, whatever its case. Split at spaces and at `*` (PostgREST's
 * like wildcard, which no escape keeps), punctuation trimmed from each
 * word's ends, each word once; the first SEARCH_MAX_WORDS of the first
 * SEARCH_MAX_CHARS characters.
 */
export function searchWords(text: string | undefined): string[] {
  const words: string[] = [];
  for (const raw of (text ?? '').slice(0, SEARCH_MAX_CHARS).split(/[\s*]+/)) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const key = word.toLowerCase();
    if (!word || words.some((w) => w.toLowerCase() === key)) continue;
    words.push(word);
    if (words.length === SEARCH_MAX_WORDS) break;
  }
  return words;
}

/** A word as an ilike pattern that finds it anywhere in a text: `\`, `%` and `_` escaped, as LIKE reads them. */
export function containsPattern(word: string): string {
  return `%${word.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Whether a text holds every word of a search, whatever its case: the test set's stand-in for the ilike filters. */
export function hasWords(text: string, words: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word.toLowerCase()));
}

// ─── What was found ─────────────────────────────────────────────────────────

/** A row a lookup found by its code or id, with what was asked and how it matched. */
export type FoundRow<T> = T & { asked: string; matched: 'its code' | 'its id' };

/** The note's last words when something wasn't found. */
const notFoundRule = (words: LookupWords) =>
  `For each in not_found, say plainly that this brand has no such ${words.one}, and where you looked; never offer other ${words.many} as the closest or similar.`;

/**
 * The rows the codes and ids name, in the order asked: every row one names,
 * never one picked between two; and what named none, in `not_found`, as
 * written. `keyOf` gives a row's key for a kind: its code's number, its id.
 */
export function lookUpKeys<T>(
  words: LookupWords,
  asked: readonly AskedKey[],
  rows: readonly T[],
  keyOf: (row: T, by: LookupBy) => string | number | null,
): { found: FoundRow<T>[]; not_found: string[]; lines: string[] } {
  const found: FoundRow<T>[] = [];
  const notFound: string[] = [];
  const lines: string[] = [];
  for (const one of asked) {
    if (one.key === null) {
      notFound.push(one.text);
      lines.push(`"${one.text}" is not ${an(words.one)} ${one.by}.`);
      continue;
    }
    const named = rows.filter((row) => keyOf(row, one.by) === one.key);
    if (named.length === 0) {
      notFound.push(one.text);
      const perBrand = one.by === 'code' ? ' (codes are per brand)' : '';
      lines.push(`${one.text}: no ${words.one} of this brand has this ${one.by}${perBrand}.`);
    } else if (named.length === 1) {
      lines.push(`${one.text}: one ${words.one}, by its ${one.by}.`);
    } else {
      lines.push(
        `${one.text} names ${named.length} ${words.many}: name each and say which is which; never pick one.`,
      );
    }
    for (const row of named) found.push({ ...row, asked: one.text, matched: `its ${one.by}` });
  }
  return { found, not_found: notFound, lines };
}

/** Where a lookup looked, and what to say of what it didn't find. */
export function lookupEnd(words: LookupWords, missing: boolean): string {
  const looked = `Looked in ${words.where}.`;
  return missing ? `${looked} ${notFoundRule(words)}` : looked;
}

/** What a search found against all that match, and how to read on; or how to answer none. */
export function searchNote(
  words: LookupWords,
  terms: readonly string[],
  total: number,
  offset: number,
  shown: number,
): string {
  const quoted = terms.map((term) => `"${term}"`).join(', ') || '(no words)';
  if (total === 0) {
    return `No ${words.one} in ${words.where} has all of these words: ${quoted}. Before you say so, search again with fewer or shorter words (a stem such as "subscri" finds "subscriptions"); then say plainly that this brand has none, and where you looked. Never offer other ${words.many} as the closest or similar.`;
  }
  const all = `${total} ${total === 1 ? words.one : words.many} in ${words.where} ${total === 1 ? 'has' : 'have'} all of these words: ${quoted}.`;
  const end = offset + shown;
  if (offset === 0 && end >= total) return all;
  if (shown === 0) return `${all} None past offset ${offset}.`;
  const range = `This page shows ${offset + 1}–${end}.`;
  return end < total
    ? `${all} ${range} Read the next page with offset ${end}.`
    : `${all} ${range} This is the last page.`;
}

/** A lookup's result by ids and by words: `rows` under `key`, every one asked found or in not_found. */
export interface IdAndSearchLookup<T> {
  note: string;
  not_found: string[];
  rows: (T | FoundRow<T>)[];
  /** The search's page, when there was a search. */
  page?: { total: number; offset: number; next_offset: number | null };
}

/**
 * A read by ids and words, as one result: the rows the ids name first (in
 * the order asked), then a page of the rows with every word that the ids
 * didn't already give, each once; not_found holds the ids that named none
 * and the search when nothing has its words.
 */
export function idAndSearchLookup<T extends { id: string }>(
  words: LookupWords,
  byIds: { asked: readonly AskedKey[]; rows: readonly T[] } | null,
  bySearch: {
    text: string;
    terms: readonly string[];
    rows: readonly T[];
    total: number;
    offset: number;
  } | null,
): IdAndSearchLookup<T> {
  const ids = byIds
    ? lookUpKeys(words, byIds.asked, byIds.rows, (row) => row.id.toLowerCase())
    : { found: [], not_found: [], lines: [] };
  const listed = new Set(ids.found.map((row) => row.id));
  const searched = bySearch ? bySearch.rows.filter((row) => !listed.has(row.id)) : [];
  const notFound = [...ids.not_found];
  const lines = [...ids.lines];
  let page: IdAndSearchLookup<T>['page'];
  if (bySearch) {
    const shown = bySearch.rows.length;
    const end = bySearch.offset + shown;
    if (bySearch.total === 0) notFound.push(bySearch.text);
    lines.push(searchNote(words, bySearch.terms, bySearch.total, bySearch.offset, shown));
    page = {
      total: bySearch.total,
      offset: bySearch.offset,
      next_offset: shown > 0 && end < bySearch.total ? end : null,
    };
  }
  if (byIds) lines.push(lookupEnd(words, ids.not_found.length > 0));
  return {
    note: lines.join(' '),
    not_found: notFound,
    rows: [...ids.found, ...searched],
    ...(page ? { page } : {}),
  };
}

// ─── Signals ────────────────────────────────────────────────────────────────

/** What a signal lookup found: each signal its codes and ids name, and what named none. */
export interface SignalLookup<T> {
  note: string;
  signals: FoundRow<T>[];
  not_found: string[];
}

/** A signal lookup's note ends with how to name them. */
export const SIGNAL_LOOKUP_END = 'Name each signal by its title, with its code.';

/**
 * A signal lookup's result from the brand's signals its codes and ids name
 * (signal-page.ts lookUpSignalsFor's compact rows, each with its code):
 * every one a code or id names, in the order asked.
 */
export function signalLookup<T extends { id: string; code?: string }>(
  asked: readonly AskedKey[],
  rows: readonly T[],
): SignalLookup<T> {
  const { found, not_found, lines } = lookUpKeys(LOOKUP_WORDS.signals, asked, rows, (row, by) =>
    by === 'code' ? searchedSignalNo(row.code ?? '') : row.id.toLowerCase(),
  );
  lines.push(lookupEnd(LOOKUP_WORDS.signals, not_found.length > 0), SIGNAL_LOOKUP_END);
  return { note: lines.join(' '), signals: found, not_found };
}

// ─── Cited domains and pages ────────────────────────────────────────────────

/** An address as `new URL` reads it: "https://" before one written without its scheme. */
const withScheme = (text: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;

/**
 * A domain as the citations read keys it: its host, lower case, without
 * "www." (extractHostname), whatever scheme, path or trailing slash it was
 * written with. Null when it is no host name.
 */
export function citedDomainKey(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const host = extractHostname(withScheme(trimmed));
  return host && /^[^.\s]+(?:\.[^.\s]+)+$/.test(host) ? host : null;
}

/**
 * A page's address as the citations read matches it (citationUrlMatchKey):
 * its host without "www." and its path without a trailing slash, whatever
 * its scheme, query or fragment. Null when it is no address.
 */
export function citedUrlKey(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const key = citationUrlMatchKey(withScheme(trimmed));
  return key && citedDomainKey(key.split('/')[0]) ? key : null;
}

/** Whether a cited host is the asked domain, or one of its subdomains. */
const domainMatch = (host: string, domain: string): 'the domain' | 'a subdomain' | null =>
  host === domain ? 'the domain' : host.endsWith(`.${domain}`) ? 'a subdomain' : null;

/** The most domains one asked domain lists (itself, then its most cited subdomains). */
export const CITED_DOMAIN_ROWS = 10;
/** The most pages of a domain, and prompts of a domain or page, one lookup lists. */
export const CITED_TOP = 5;

interface CitedDomain {
  domain: string;
  total_citations: number;
}
interface CitedUrl {
  url: string;
  domain: string;
  title: string;
  total_citations: number;
}

export interface CitedLookup<D, U> {
  note: string;
  /** Each domain an asked domain names: the domain, then its subdomains, with its most cited pages. */
  domains: (D & {
    asked: string;
    matched: 'the domain' | 'a subdomain';
    pages_total: number;
    top_pages: { url: string; title: string; total_citations: number }[];
  })[];
  /** Each cited page an asked address names. */
  urls: (U & { asked: string; matched: 'the page' })[];
  not_found: string[];
}

/**
 * The cited domains and pages the person named, from all the period's
 * (most cited first), every source type: a domain finds itself and its
 * subdomains, each with its most cited pages; an address finds its page
 * however it is written. What isn't cited in the period is in not_found,
 * as written; a page that isn't, with whether its domain is. `period` says
 * where it looked: "from 2026-10-17 to 2026-11-16".
 */
export function lookUpCited<D extends CitedDomain, U extends CitedUrl>(
  asked: { domains?: readonly string[]; urls?: readonly string[] },
  all: { domains: readonly D[]; urls: readonly U[] },
  period: string,
): CitedLookup<D, U> {
  const out: CitedLookup<D, U> = { note: '', domains: [], urls: [], not_found: [] };
  const lines: string[] = [];
  /** Each one once, as first written (by its key: two ways of writing one domain are one), at most LOOKUP_MAX. */
  const once = (list: readonly string[] | undefined, keyOf: (text: string) => string | null) => {
    const seen = new Set<string>();
    const out: { text: string; key: string | null }[] = [];
    for (const raw of list ?? []) {
      const text = raw.trim();
      const key = text ? keyOf(text) : null;
      if (!text || seen.has(key ?? `\u0000${text}`)) continue;
      if (out.length === LOOKUP_MAX) break;
      seen.add(key ?? `\u0000${text}`);
      out.push({ text, key });
    }
    return out;
  };

  for (const { text, key: domain } of once(asked.domains, citedDomainKey)) {
    if (!domain) {
      out.not_found.push(text);
      lines.push(`"${text}" is not a domain.`);
      continue;
    }
    const named = all.domains.flatMap((row) => {
      const matched = domainMatch(row.domain, domain);
      return matched ? [{ row, matched }] : [];
    });
    named.sort((a, b) => Number(a.matched !== 'the domain') - Number(b.matched !== 'the domain'));
    if (named.length === 0) {
      out.not_found.push(text);
      lines.push(`${text}: not cited in these answers.`);
      continue;
    }
    const subdomains = named.filter((n) => n.matched === 'a subdomain').length;
    const shownSubs = Math.min(subdomains, CITED_DOMAIN_ROWS - (named.length - subdomains));
    lines.push(
      subdomains === 0
        ? `${text}: cited, as the domain.`
        : `${text}: cited${named.length > subdomains ? ' as the domain and' : ''} on ${subdomains} subdomain${subdomains === 1 ? '' : 's'}${shownSubs < subdomains ? ` (the ${shownSubs} most cited listed)` : ''}.`,
    );
    for (const { row, matched } of named.slice(0, CITED_DOMAIN_ROWS)) {
      const pages = all.urls.filter((url) => url.domain === row.domain);
      out.domains.push({
        ...row,
        asked: text,
        matched,
        pages_total: pages.length,
        top_pages: pages.slice(0, CITED_TOP).map((url) => ({
          url: url.url,
          title: url.title,
          total_citations: url.total_citations,
        })),
      });
    }
  }

  for (const { text, key } of once(asked.urls, citedUrlKey)) {
    if (!key) {
      out.not_found.push(text);
      lines.push(`"${text}" is not a page address.`);
      continue;
    }
    const named = all.urls.filter((row) => citationUrlMatchKey(row.url) === key);
    if (named.length > 0) {
      lines.push(`${text}: cited${named.length > 1 ? `, as ${named.length} addresses` : ''}.`);
      for (const row of named) out.urls.push({ ...row, asked: text, matched: 'the page' });
      continue;
    }
    out.not_found.push(text);
    const host = key.split('/')[0];
    const site = all.domains.find((row) => row.domain === host);
    lines.push(
      site
        ? `${text}: this page is not cited in these answers; its domain ${host} is, ${site.total_citations} times, on other pages.`
        : `${text}: not cited in these answers, nor is its domain ${host}.`,
    );
  }

  lines.push(
    `Looked in this brand's AI answers ${period}, every source type (owned, competitor and external).`,
  );
  if (out.not_found.length > 0) {
    lines.push(
      'For each in not_found, say plainly that it is not cited in that period, with the period; never offer other domains or pages as the closest or similar.',
    );
  }
  out.note = lines.join(' ');
  return out;
}

/** A read's period in the note's words: "from 2026-10-17 to 2026-11-16". */
export function periodWords(dateFrom?: string | null, dateTo?: string | null): string {
  const day = (at: string) => at.slice(0, 10);
  if (dateFrom && dateTo) return `from ${day(dateFrom)} to ${day(dateTo)}`;
  if (dateFrom) return `since ${day(dateFrom)}`;
  if (dateTo) return `up to ${day(dateTo)}`;
  return 'over all time';
}
