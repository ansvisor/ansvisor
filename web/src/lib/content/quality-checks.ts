import { classifyDomain, normalizeDomain } from '@/lib/citations/classify';
import type { ContentAuthor } from './authors';
import { cleanHref } from './html-allowlist';
import { ownText, sentencesOf } from './readability';
import { sourceClass, type SourceClass } from './source-class';

/**
 * E-E-A-T and Trust (Content Editor Quality spec §2.1, §2.2): checks read
 * from the page's facts, each worth its points. Only the checks live in the
 * current phase count; the score is the share of their points, out of 100,
 * and a score with no live check isn't given at all (no fake points).
 */

export interface ScoreCheck<Id extends string = string> {
  id: Id;
  points: number;
  max: number;
}

export interface Score<Id extends string = string> {
  /** 0–100, or null when no check of it is live for this page yet. */
  score: number | null;
  checks: ScoreCheck<Id>[];
}

/** E-E-A-T's checks and points (blog defaults); Phase 1 reads the author's. */
export const EEAT_WEIGHTS = {
  experience: 20,
  originalData: 15,
  byline: 15,
  authorBio: 10,
  visualProof: 10,
  whoHowWhy: 10,
  dates: 10,
  authorSchema: 10,
} as const;
export type EeatCheckId = keyof typeof EEAT_WEIGHTS;

/**
 * Trust's checks and points; Phase 1 reads the page's links and figures
 * (sourced figures, fresh sources, working links) and the site's trust
 * (Site Audit, CE-043); the rest are Phase 2, starting with what kind of
 * source each link is (CE-046).
 */
export const TRUST_WEIGHTS = {
  claimsSourced: 30,
  primarySources: 15,
  noWeakSources: 10,
  brandFacts: 10,
  expertQuote: 8,
  freshSources: 7,
  balanced: 7,
  disclosure: 5,
  noBrokenLinks: 3,
  siteTrust: 5,
} as const;
export type TrustCheckId = keyof typeof TRUST_WEIGHTS;

/**
 * Trust's Phase 1 points (sourced figures, fresh sources, working links):
 * what a broken link's gain is out of while Trust isn't scored (trustGain).
 */
export const TRUST_PHASE1_POINTS =
  TRUST_WEIGHTS.claimsSourced + TRUST_WEIGHTS.freshSources + TRUST_WEIGHTS.noBrokenLinks;

/** The most links the API reads for one draft at a time (link-check.js). */
export const MAX_LINK_CHECKS = 20;
/** A source older than this many months isn't fresh. */
export const FRESH_MONTHS = 24;

/** A link's read (the API's content_link_checks): does it answer, and its page's own date. */
export interface LinkCheck {
  /** The link as the page has it. */
  href: string;
  status: 'ok' | 'broken' | 'unknown';
  httpStatus: number | null;
  date: string | null;
}

function scoreOf<Id extends string>(checks: ScoreCheck<Id>[]): Score<Id> {
  const max = checks.reduce((sum, c) => sum + c.max, 0);
  if (max === 0) return { score: null, checks };
  const points = checks.reduce((sum, c) => sum + c.points, 0);
  return { score: Math.round((points / max) * 100), checks };
}

/**
 * The score's rise if the checks named came out in full: the gain chip of a
 * suggestion. Zero when they already have their points.
 */
export function scoreGain<Id extends string>(result: Score<Id>, ids: Id[]): number {
  if (result.score === null) return 0;
  const raised = result.checks.map((c) => (ids.includes(c.id) ? { ...c, points: c.max } : c));
  return (scoreOf(raised).score ?? 0) - result.score;
}

/**
 * A Trust suggestion's gain. While Trust isn't scored (no figure and no
 * dated source yet), the checks' missing points count out of the Phase 1
 * points, so a broken link still says what fixing it is worth.
 */
export function trustGain(result: Score<TrustCheckId>, ids: TrustCheckId[]): number {
  if (result.score !== null) return scoreGain(result, ids);
  const missing = result.checks
    .filter((c) => ids.includes(c.id))
    .reduce((sum, c) => sum + c.max - c.points, 0);
  return Math.round((missing / TRUST_PHASE1_POINTS) * 100);
}

/** What an author's profile has: a short bio, and profile links (Person schema's sameAs). */
export function authorProfile(author: ContentAuthor | null): { bio: boolean; links: boolean } {
  return { bio: !!author?.bio?.trim(), links: (author?.sameAs.length ?? 0) > 0 };
}

/**
 * E-E-A-T from the page's author (CE-038): a real person, with a short bio
 * and profile links. The organization byline is no person. Author schema
 * and dates join when the live page is read (CE-042): the JSON-LD Before you
 * publish gives counts only once the page has it. Experience, data, proof
 * and who/how/why are Phase 2.
 */
export function eeat({
  author,
  used = null,
}: {
  author: ContentAuthor | null;
  /**
   * Phase 2 (CE-048): whether the page uses the person's experience and
   * their data (Brief › Your input, inputsUsed); left out before.
   */
  used?: { experience: boolean; data: boolean } | null;
}): Score<EeatCheckId> {
  const { bio, links } = authorProfile(author);
  return scoreOf<EeatCheckId>([
    ...(used
      ? [
          {
            id: 'experience' as const,
            points: used.experience ? EEAT_WEIGHTS.experience : 0,
            max: EEAT_WEIGHTS.experience,
          },
          {
            id: 'originalData' as const,
            points: used.data ? EEAT_WEIGHTS.originalData : 0,
            max: EEAT_WEIGHTS.originalData,
          },
        ]
      : []),
    { id: 'byline', points: author ? EEAT_WEIGHTS.byline : 0, max: EEAT_WEIGHTS.byline },
    {
      id: 'authorBio',
      points: author ? (EEAT_WEIGHTS.authorBio * ((bio ? 1 : 0) + (links ? 1 : 0))) / 2 : 0,
      max: EEAT_WEIGHTS.authorBio,
    },
  ]);
}

/**
 * A figure, the kind of claim that wants a source: a percentage, an amount
 * with a magnitude ("$2.5 million", "€10M"), a number with a magnitude or a
 * multiplier ("2 million", "10k", "3x", "3 times faster"). A bare number
 * ("5 steps", "2026", "24/7"), a price ("$29/month") or a size ("10 x 20 cm")
 * isn't one.
 */
const FIGURE_WORDS =
  /%\s?\d|\d[\d.,]*\s?(?:%|percent\b|per cent\b|prozent\b)|[$€£¥₺]\s?\d[\d.,]*\s?(?:[km]\b|bn\b|thousand|million|billion|trillion)|\d[\d.,]*\s?(?:thousand|million|billion|trillion|millones|milyon|milyar|milliard|millionen|milliarden)s?\b|\d+(?:[.,]\d+)?\s?times\s(?:more|less|faster|slower|higher|lower|as|bigger|smaller|better|cheaper)\b/i;
const FIGURE_SHORT = /\b\d+(?:[.,]\d+)?(?:x|k|K|M|bn|B)\b/;
/** A percentage, either way round ("20%", "20 percent", "%20"). */
const PERCENT = String.raw`(?:\d[\d.,]*\s?(?:%|percent\b|per cent\b)|%\s?\d[\d.,]*)`;
/**
 * Numbers that read as figures but claim nothing, taken out before the
 * figures are looked for. Product and category pages have them in almost
 * every block:
 *   - a discount or a rate: "Save 20%", "50% off", "a 0% APR loan";
 *   - a material or a guarantee: "100% cotton", "100% money-back" ("100% of
 *     our customers" stays a figure);
 *   - short forms that aren't amounts: "4K", "8K", "401k";
 *   - a price with a magnitude: "$1.2k/month", "$2 million per year".
 */
const NOT_FIGURES = [
  new RegExp(String.raw`\bsave\s+(?:up\s+to\s+)?${PERCENT}`, 'gi'),
  new RegExp(String.raw`${PERCENT}\s*(?:off|discount|apr|apy)\b`, 'gi'),
  /(?:\b100\s?(?:%|percent\b|per cent\b)|%\s?100\b)(?!\s*of\b)/gi,
  // Screens say "4K" in capitals; "4k" stays four thousand.
  /\b[48]K\b/g,
  /\b401\s?\(?k\b\)?/gi,
  /[$€£¥₺]\s?\d[\d.,]*\s?(?:[km]|bn|thousand|million|billion|trillion)\s*(?:\/|per\b)/gi,
];
const hasFigure = (sentence: string) => {
  const text = NOT_FIGURES.reduce((rest, re) => rest.replace(re, ' '), sentence);
  return FIGURE_WORDS.test(text) || FIGURE_SHORT.test(text);
};

/** A block of the page's text, with the links in it, as Trust reads them. */
export interface TrustBlock {
  tag: string;
  text: string;
  links: string[];
}

/**
 * The page's paragraphs, list items, quotes and table cells, each with its
 * own words and links: a list item without the list nested in it (as
 * Readability reads it), a paragraph in an item or a cell with it.
 */
export function trustBlocks(html: string): TrustBlock[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: TrustBlock[] = [];
  for (const el of doc.body.querySelectorAll('p, li, blockquote, td, th')) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'p' && el.closest('li, blockquote, td, th')) continue;
    if (tag !== 'td' && tag !== 'th' && el.parentElement?.closest('td, th')) continue;
    // An inline link's edges leave no space before the punctuation after it.
    const text = ownText(el)
      .replace(/\s+/g, ' ')
      .replace(/ ([.,;:!?…)])/g, '$1')
      .trim();
    if (!text) continue;
    const links = [...el.querySelectorAll('a[href]')]
      // A list item's links, not its nested list's.
      .filter((a) => tag !== 'li' || a.closest('li') === el)
      .map((a) => a.getAttribute('href') ?? '');
    out.push({ tag, text, links });
  }
  return out;
}

/**
 * The page's links, as the draft saves them (cleanHref): http(s) only, each
 * with its block's place and whether it is on the brand's own site.
 */
function pageLinks(blocks: TrustBlock[], brandDomains: string[]) {
  const own = brandDomains.map(normalizeDomain).filter(Boolean);
  const out: { url: string; block: number; text: string; external: boolean }[] = [];
  blocks.forEach((block, index) => {
    for (const raw of block.links) {
      const href = cleanHref(raw);
      if (!href || !/^https?:\/\//i.test(href)) continue;
      const host = normalizeDomain(href);
      const external =
        !!host && classifyDomain(host, { brandDomains: own, competitorDomains: [] }) !== 'you';
      out.push({ url: href, block: index, text: block.text, external });
    }
  });
  return out;
}

/** Each link once, by its address: where the page has it first (Show goes there). */
const byUrl = <T extends { url: string }>(links: T[]) => {
  const first = new Map<string, T>();
  for (const l of links) if (!first.has(l.url)) first.set(l.url, l);
  return [...first.values()];
};

/** The page's links to read, each once, MAX_LINK_CHECKS at most: Trust's link checks. */
export function linksToCheck(blocks: TrustBlock[]): string[] {
  return [...new Set(pageLinks(blocks, []).map((l) => l.url))].slice(0, MAX_LINK_CHECKS);
}

export interface TrustRead extends Score<TrustCheckId> {
  /** Links that don't answer, with the block each is in (for Show). */
  broken: { url: string; text: string }[];
  /** Sources older than FRESH_MONTHS, and how many give a date at all. */
  stale: { url: string; text: string }[];
  dated: number;
  /** Sentences with a figure and no source in their block, and how many have a figure. */
  unsourced: string[];
  figures: number;
  /**
   * Phase 2 (CE-046): weak or competitors' sources the person hasn't kept,
   * the page's first first, and how many sources the rules could place.
   */
  weak: { url: string; text: string; kind: 'weak' | 'competitor' }[];
  classified: number;
}

/** What Trust needs to tell a link's kind (Phase 2, CE-046). */
export interface SourceRead {
  competitorDomains: string[];
  pageType: string | null;
  /** Weak or competitors' sources the person chose to keep, by their address. */
  kept: ReadonlySet<string>;
}

/**
 * Trust from the page as written (Phase 1): figures with a source (a link
 * to another site in the same block), sources from the last FRESH_MONTHS,
 * links that answer, and the site's trust (its five checks in Site Audit).
 * A check with nothing to read (no figure, no dated source, no link read
 * yet, no site trust read) is left out, and site trust counts only beside a
 * check of the page's own. Trust is scored only once a figure or a dated
 * source is there: working links alone are 3 points, and one link would set
 * the whole score (one dead link 0, one working link 100), as Readability
 * waits for MIN_WORDS.
 *
 * With `sources` (Phase 2, CE-046), each source's kind counts too: a primary
 * one among them (official, research, standards), and none weak (forums,
 * social posts) or a competitor's, unless the person kept it. A source the
 * rules can't place is left out of both; two placed sources score Trust on
 * their own.
 */
export function trust({
  blocks,
  links,
  brandDomains,
  siteTrust = null,
  quote = null,
  sources: kinds = null,
  now,
}: {
  /** The page's blocks (trustBlocks). */
  blocks: TrustBlock[];
  /** Each link's read, by the link as the page has it; one not read yet isn't counted. */
  links: Map<string, LinkCheck>;
  brandDomains: string[];
  /** How many of the site's five trust checks pass (CE-043), when read. */
  siteTrust?: { score: number } | null;
  /**
   * Phase 2 (CE-048): whether the page quotes a real expert from Brief ›
   * Your input word for word; left out before.
   */
  quote?: boolean | null;
  /** Phase 2: what each source is (CE-046); left out before. */
  sources?: SourceRead | null;
  now: number;
}): TrustRead {
  const all = pageLinks(blocks, brandDomains);
  const checks: ScoreCheck<TrustCheckId>[] = [];

  // Each sentence once: a nested list item's text is its parent's too.
  const figures = new Map<string, boolean>();
  blocks.forEach((b, index) => {
    const sourced = all.some((l) => l.external && l.block === index);
    for (const sentence of sentencesOf(b.text)) {
      if (hasFigure(sentence)) figures.set(sentence, (figures.get(sentence) ?? false) || sourced);
    }
  });
  const figureSentences = [...figures].map(([sentence, sourced]) => ({ sentence, sourced }));
  const unsourced = figureSentences.filter((f) => !f.sourced).map((f) => f.sentence);
  if (figureSentences.length) {
    checks.push({
      id: 'claimsSourced',
      points:
        (TRUST_WEIGHTS.claimsSourced * (figureSentences.length - unsourced.length)) /
        figureSentences.length,
      max: TRUST_WEIGHTS.claimsSourced,
    });
  }

  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - FRESH_MONTHS);
  const sources = byUrl(all.filter((l) => l.external && links.get(l.url)?.date));
  const stale = sources.filter((l) => new Date(links.get(l.url)!.date!) < cutoff);
  if (sources.length) {
    checks.push({
      id: 'freshSources',
      points: (TRUST_WEIGHTS.freshSources * (sources.length - stale.length)) / sources.length,
      max: TRUST_WEIGHTS.freshSources,
    });
  }

  const classified = kinds
    ? byUrl(all.filter((l) => l.external)).flatMap((l) => {
        const kind = sourceClass(l.url, { brandDomains, ...kinds });
        return kind && kind !== 'own' ? [{ ...l, kind }] : [];
      })
    : [];
  const isWeak = (kind: SourceClass): kind is 'weak' | 'competitor' =>
    kind === 'weak' || kind === 'competitor';
  const weak = classified.flatMap(({ url, text, kind }) =>
    isWeak(kind) && !kinds?.kept.has(url) ? [{ url, text, kind }] : [],
  );
  if (classified.length) {
    checks.push({
      id: 'primarySources',
      points: classified.some((l) => l.kind === 'primary') ? TRUST_WEIGHTS.primarySources : 0,
      max: TRUST_WEIGHTS.primarySources,
    });
    checks.push({
      id: 'noWeakSources',
      points: (TRUST_WEIGHTS.noWeakSources * (classified.length - weak.length)) / classified.length,
      max: TRUST_WEIGHTS.noWeakSources,
    });
  }

  const read = byUrl(
    all.filter((l) => {
      const status = links.get(l.url)?.status;
      return status === 'ok' || status === 'broken';
    }),
  );
  const broken = read.filter((l) => links.get(l.url)!.status === 'broken');
  if (read.length) {
    checks.push({
      id: 'noBrokenLinks',
      points: (TRUST_WEIGHTS.noBrokenLinks * (read.length - broken.length)) / read.length,
      max: TRUST_WEIGHTS.noBrokenLinks,
    });
  }

  if (quote !== null) {
    checks.push({
      id: 'expertQuote',
      points: quote ? TRUST_WEIGHTS.expertQuote : 0,
      max: TRUST_WEIGHTS.expertQuote,
    });
  }

  // The site's 5 points weigh with what the page itself shows: alone, they'd
  // be the page's whole Trust.
  if (siteTrust && checks.length) {
    checks.push({
      id: 'siteTrust',
      points: (TRUST_WEIGHTS.siteTrust * siteTrust.score) / 5,
      max: TRUST_WEIGHTS.siteTrust,
    });
  }

  const scored =
    checks.some((c) => c.id === 'claimsSourced' || c.id === 'freshSources') ||
    classified.length >= 2;
  return {
    ...(scored ? scoreOf(checks) : { score: null, checks }),
    broken: broken.map(({ url, text }) => ({ url, text })),
    stale: stale.map(({ url, text }) => ({ url, text })),
    dated: sources.length,
    unsourced,
    figures: figureSentences.length,
    weak,
    classified: classified.length,
  };
}
