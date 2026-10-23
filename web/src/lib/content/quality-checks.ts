import { classifyDomain, normalizeDomain } from '@/lib/citations/classify';
import type { ContentAuthor } from './authors';
import { sentencesOf } from './readability';
import type { PageBlock } from './rules';

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
 * Trust's checks and points; Phase 1 reads the page's links and figures:
 * sourced figures, fresh sources, working links. Site trust joins with Site
 * Audit (CE-043); the rest are Phase 2.
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

/** What an author's profile has: a short bio, and profile links (Person schema's sameAs). */
export function authorProfile(author: ContentAuthor | null): { bio: boolean; links: boolean } {
  return { bio: !!author?.bio?.trim(), links: (author?.sameAs.length ?? 0) > 0 };
}

/**
 * E-E-A-T from the page's author (CE-038): a real person, with a short bio
 * and profile links. The organization byline is no person. Author schema
 * joins when Before you publish writes the page's JSON-LD (CE-041), dates
 * when the live page is read (CE-042); experience, data, proof and
 * who/how/why are Phase 2.
 */
export function eeat({ author }: { author: ContentAuthor | null }): Score<EeatCheckId> {
  const { bio, links } = authorProfile(author);
  return scoreOf<EeatCheckId>([
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
 * of money, or a number with a magnitude or a multiplier ("3x", "2 million").
 * A bare number ("5 steps", "2026") isn't one.
 */
const FIGURE =
  /(?:%\s?\d|[$€£¥₺]\s?\d|\d[\d.,]*\s?(?:%|×|x\b|percent\b|per cent\b|prozent\b|thousand\b|million(?:s|en)?\b|millones\b|milliard(?:s|en)?\b|billion\b|trillion\b|milyon\b|milyar\b))/i;

/** The page's links: http(s) only, whether each is on the brand's own site. */
function pageLinks(blocks: PageBlock[], brandDomains: string[]) {
  const own = brandDomains.map(normalizeDomain).filter(Boolean);
  const out: { url: string; text: string; external: boolean }[] = [];
  for (const block of blocks) {
    // A list's items are their own blocks too.
    if (/^(ol|ul):/.test(block.tag)) continue;
    for (const href of block.links) {
      if (!/^https?:\/\//i.test(href)) continue;
      const host = normalizeDomain(href);
      const external =
        !!host && classifyDomain(host, { brandDomains: own, competitorDomains: [] }) !== 'you';
      out.push({ url: href, text: block.text, external });
    }
  }
  return out;
}

/** The page's links to read, each once, MAX_LINK_CHECKS at most: Trust's link checks. */
export function linksToCheck(blocks: PageBlock[]): string[] {
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
}

/**
 * Trust from the page as written (Phase 1): figures with a source (a link
 * to another site in the same block), sources from the last FRESH_MONTHS,
 * and links that answer. A check with nothing to read on the page (no
 * figure, no dated source, no link read yet) is left out.
 */
export function trust({
  blocks,
  links,
  brandDomains,
  now,
}: {
  /** The page's blocks, as the rules read them (readPage). */
  blocks: PageBlock[];
  /** Each link's read, by the link as the page has it; one not read yet isn't counted. */
  links: Map<string, LinkCheck>;
  brandDomains: string[];
  now: number;
}): TrustRead {
  const all = pageLinks(blocks, brandDomains);
  const checks: ScoreCheck<TrustCheckId>[] = [];

  const figureSentences = blocks
    .filter((b) => ['p', 'li', 'blockquote', 'table'].includes(b.tag))
    .flatMap((b) => {
      const sourced = all.some((l) => l.external && l.text === b.text);
      return sentencesOf(b.text)
        .filter((sentence) => FIGURE.test(sentence))
        .map((sentence) => ({ sentence, sourced }));
    });
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
  const sources = all.filter((l) => l.external && links.get(l.url)?.date);
  const stale = sources.filter((l) => new Date(links.get(l.url)!.date!) < cutoff);
  if (sources.length) {
    checks.push({
      id: 'freshSources',
      points: (TRUST_WEIGHTS.freshSources * (sources.length - stale.length)) / sources.length,
      max: TRUST_WEIGHTS.freshSources,
    });
  }

  const read = all.filter((l) => {
    const status = links.get(l.url)?.status;
    return status === 'ok' || status === 'broken';
  });
  const broken = read.filter((l) => links.get(l.url)!.status === 'broken');
  if (read.length) {
    checks.push({
      id: 'noBrokenLinks',
      points: (TRUST_WEIGHTS.noBrokenLinks * (read.length - broken.length)) / read.length,
      max: TRUST_WEIGHTS.noBrokenLinks,
    });
  }

  return {
    ...scoreOf(checks),
    broken: broken.map(({ url, text }) => ({ url, text })),
    stale: stale.map(({ url, text }) => ({ url, text })),
    dated: sources.length,
    unsourced,
    figures: figureSentences.length,
  };
}
