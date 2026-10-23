import type { ContentAuthor } from './authors';

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
