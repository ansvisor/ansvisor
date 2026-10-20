import type { ContentOverlap, OverlapPage } from './drafts';

/**
 * Start's overlap check (Content Editor CE-015, spec §5): what to recommend
 * when the brand's own pages already answer a new page's prompts.
 *
 *   * none: safe to create.
 *   * covered: the top page answers at least half the prompts. Optimize it
 *     instead; a new page would compete with it for the same prompts.
 *   * partial: the pages answer fewer. Create the page and link them to it,
 *     so the prompts get one clear page, or add a section to the top one.
 */

/** The share of the prompts a page answers for Start to recommend optimizing it. */
export const COVERS_SHARE = 0.5;

/** What Open editor does: write a new page, or optimize an existing one. */
export type OverlapChoice = { kind: 'create' } | { kind: 'optimize'; page: OverlapPage };

export type OverlapOptionKey = 'optimizeInstead' | 'createAnyway' | 'createLinked' | 'addSection';

export interface OverlapOption {
  key: OverlapOptionKey;
  choice: OverlapChoice;
  recommended: boolean;
}

export interface OverlapAdvice {
  verdict: 'none' | 'covered' | 'partial';
  /** The recommended option first; empty when nothing overlaps. */
  options: OverlapOption[];
}

export function adviseOverlap(overlap: ContentOverlap): OverlapAdvice {
  const top = overlap.pages[0];
  if (!top || overlap.totalPrompts === 0) return { verdict: 'none', options: [] };
  const optimizeTop: OverlapChoice = { kind: 'optimize', page: top };
  if (top.promptsInCommon / overlap.totalPrompts >= COVERS_SHARE) {
    return {
      verdict: 'covered',
      options: [
        { key: 'optimizeInstead', choice: optimizeTop, recommended: true },
        { key: 'createAnyway', choice: { kind: 'create' }, recommended: false },
      ],
    };
  }
  return {
    verdict: 'partial',
    options: [
      { key: 'createLinked', choice: { kind: 'create' }, recommended: true },
      { key: 'addSection', choice: optimizeTop, recommended: false },
    ],
  };
}

/** A page as Start names it: its path on the site, or its host for the home page. */
export function pagePath(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return path || parsed.host;
  } catch {
    return url;
  }
}
