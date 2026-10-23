import type { ContentAuthor } from './authors';
import type { DraftSuggestion } from './suggestions';

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

/** E-E-A-T's checks and points (blog defaults); Phase 1 reads the author ones. */
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

/** Trust's checks and points; Phase 1 reads the agent's sourced claims. */
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
 * E-E-A-T from the page's author (CE-038): a real person, with a short bio
 * and profile links, whom Person schema (with sameAs) can name. The
 * organization byline is no person, so none of the three. Dates join when
 * the live page is read (CE-042); experience, data, proof and who/how/why
 * are Phase 2.
 */
export function eeat({ author }: { author: ContentAuthor | null }): Score<EeatCheckId> {
  const bio = !!author?.bio?.trim();
  const links = (author?.sameAs.length ?? 0) > 0;
  return scoreOf<EeatCheckId>([
    { id: 'byline', points: author ? EEAT_WEIGHTS.byline : 0, max: EEAT_WEIGHTS.byline },
    {
      id: 'authorBio',
      points: author ? (EEAT_WEIGHTS.authorBio * ((bio ? 1 : 0) + (links ? 1 : 0))) / 2 : 0,
      max: EEAT_WEIGHTS.authorBio,
    },
    {
      id: 'authorSchema',
      points: author ? (links ? EEAT_WEIGHTS.authorSchema : EEAT_WEIGHTS.authorSchema / 2) : 0,
      max: EEAT_WEIGHTS.authorSchema,
    },
  ]);
}

/**
 * Trust as far as Phase 1 reads it: the claims in the agent's accepted text
 * have a source. Every figure the agent adds carries a source id, or the
 * server drops it (v1.1 §3b), so each source mark on an accepted change is a
 * sourced claim; a page with none has no agent claims to count, and the
 * check waits. The person's own claims are Phase 2 (claim detection).
 */
export function trust({ suggestions }: { suggestions: DraftSuggestion[] }): Score<TrustCheckId> {
  const sourced = suggestions
    .filter((s) => s.status === 'accepted')
    .reduce((sum, s) => sum + (s.sourceMarks?.length ?? 0), 0);
  const checks: ScoreCheck<TrustCheckId>[] = [];
  if (sourced > 0) {
    checks.push({
      id: 'claimsSourced',
      points: TRUST_WEIGHTS.claimsSourced,
      max: TRUST_WEIGHTS.claimsSourced,
    });
  }
  return scoreOf(checks);
}
