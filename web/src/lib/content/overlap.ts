import type { ContentOverlap, OverlapPage } from './drafts';
import { pageKey } from './sources';

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

export type OverlapOptionKey =
  | 'optimizeGiven'
  | 'createNew'
  | 'optimizeInstead'
  | 'createAnyway'
  | 'createLinked'
  | 'addSection';

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

/**
 * The options Start offers: the advice's, after the page the Content plan
 * named when the advice doesn't offer that page, so a person who picks
 * another option can come back to it. With nothing overlapping, the plan's
 * page and a new page: Start shows which one the draft will be, and lets
 * the person switch.
 */
export function overlapOptions(advice: OverlapAdvice, given: OverlapPage | null): OverlapOption[] {
  if (!given) return advice.options;
  if (advice.options.length === 0) {
    return [
      { key: 'optimizeGiven', choice: { kind: 'optimize', page: given }, recommended: false },
      { key: 'createNew', choice: { kind: 'create' }, recommended: false },
    ];
  }
  const offered = advice.options.some(
    (o) => o.choice.kind === 'optimize' && samePage(o.choice.page.url, given.url),
  );
  if (offered) return advice.options;
  return [
    { key: 'optimizeGiven', choice: { kind: 'optimize', page: given }, recommended: false },
    ...advice.options,
  ];
}

/** Two addresses of one page (pageKey), or the same text when either isn't an address. */
export function samePage(a: string, b: string): boolean {
  const keyA = pageKey(a);
  const keyB = pageKey(b);
  return keyA !== null && keyB !== null ? keyA === keyB : a === b;
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
