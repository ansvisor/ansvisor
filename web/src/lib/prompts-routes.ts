/**
 * The Prompts area's four views and their routes (PROMPT-001). The sidebar's
 * Prompts submenu links to them, and the page's own tabs keep the URL on the
 * matching route, so the two always show the same view.
 */

export type PromptsTab = 'all' | 'fanout' | 'insights';
export type PromptsListView = 'tracked' | 'suggestions';

export interface PromptsSection {
  /** The route's last segment. */
  slug: 'tracked' | 'suggestions' | 'fan-outs' | 'insights';
  href: string;
  tab: PromptsTab;
  /** The Tracked / Suggestions switch; only meaningful on the Prompts tab. */
  view: PromptsListView;
}

export const PROMPTS_BASE = '/dashboard/prompts';

export const PROMPTS_SECTIONS: readonly PromptsSection[] = [
  { slug: 'tracked', href: `${PROMPTS_BASE}/tracked`, tab: 'all', view: 'tracked' },
  { slug: 'suggestions', href: `${PROMPTS_BASE}/suggestions`, tab: 'all', view: 'suggestions' },
  { slug: 'fan-outs', href: `${PROMPTS_BASE}/fan-outs`, tab: 'fanout', view: 'tracked' },
  { slug: 'insights', href: `${PROMPTS_BASE}/insights`, tab: 'insights', view: 'tracked' },
];

/** The section a pathname (without locale prefix) is on; null off the four routes. */
export function sectionFromPath(pathname: string): PromptsSection | null {
  const path = pathname.replace(/\/+$/, '');
  return PROMPTS_SECTIONS.find((s) => s.href === path) ?? null;
}

/** The route for a tab and list view, as the page's tabs set them. */
export function sectionFor(tab: PromptsTab, view: PromptsListView): PromptsSection {
  if (tab === 'fanout') return PROMPTS_SECTIONS[2];
  if (tab === 'insights') return PROMPTS_SECTIONS[3];
  return view === 'suggestions' ? PROMPTS_SECTIONS[1] : PROMPTS_SECTIONS[0];
}

/**
 * Query params that carry over when moving between the four sections — the
 * date range and location stay; the tab and view are in the path now, and a
 * prompt-specific panel or sort belongs to the table it was opened from.
 */
export function carriedParams(search: string): string {
  const params = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const key of ['range', 'from', 'to', 'region']) {
    const value = params.get(key);
    if (value) keep.set(key, value);
  }
  const s = keep.toString();
  return s ? `?${s}` : '';
}
