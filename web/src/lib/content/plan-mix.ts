/**
 * "What AI cites in your topics" on the Content plan (CE-014, spec v2 §4):
 * one row per page type of the brand's kind of site, with the share of AI
 * citations in the brand's tracked answers going to that type of page, and
 * the brand's own share, both of the same whole. A type AI cites 10 points
 * or more beyond the brand's share is a gap. The addresses come from
 * content_plan_insights (00221); their type is read from the address and
 * title, as the editor detects a page's (page-types.ts).
 */

import { SITE_PAGE_TYPES, detectPageType, type SiteType } from './page-types';
import type { PageType } from './drafts';
import { pageKey } from './sources';

/** One cited address, as content_plan_insights returns it. */
export interface CitedAddress {
  url: string;
  title: string | null;
  /** One of the brand's own pages. */
  own: boolean;
  citations: number;
}

export interface MixRow {
  pageType: PageType;
  /** The type's share of the citations whose type is known, in whole percent. */
  aiShare: number;
  /** The brand's own pages of the type, as a share of the same citations. */
  yourShare: number;
  /** The brand's pages of the type AI cited. */
  pages: number;
  /** AI cites the type 10 points or more beyond the brand's share. */
  gap: boolean;
}

export const GAP_POINTS = 10;

/**
 * The page types AI cites, the most cited first; types neither AI nor the
 * brand cites are left out. Addresses whose type can't be read (a forum
 * thread, an encyclopedia entry) aren't in the whole the shares are of:
 * `unread` says what share of the citations they hold, in whole percent.
 */
export function pageTypeMix(
  cited: CitedAddress[],
  siteType: SiteType,
): { rows: MixRow[]; unread: number } {
  const types = SITE_PAGE_TYPES[siteType];
  const byType = new Map<PageType, { all: number; own: number; pages: Set<string> }>();
  let total = 0;
  let all = 0;
  for (const address of cited) {
    if (address.citations <= 0) continue;
    all += address.citations;
    const type = detectPageType({ url: address.url, title: address.title }, siteType);
    if (!type || !types.includes(type)) continue;
    total += address.citations;
    const entry = byType.get(type) ?? { all: 0, own: 0, pages: new Set<string>() };
    entry.all += address.citations;
    if (address.own) {
      entry.own += address.citations;
      entry.pages.add(pageKey(address.url) ?? address.url);
    }
    byType.set(type, entry);
  }
  const unread = all ? Math.round(((all - total) / all) * 100) : 0;
  if (!total) return { rows: [], unread };
  const rows = types
    .flatMap((pageType) => {
      const entry = byType.get(pageType);
      if (!entry) return [];
      const aiShare = Math.round((entry.all / total) * 100);
      const yourShare = Math.round((entry.own / total) * 100);
      return [
        {
          pageType,
          aiShare,
          yourShare,
          pages: entry.pages.size,
          gap: aiShare - yourShare >= GAP_POINTS,
        },
      ];
    })
    .sort((a, b) => b.aiShare - a.aiShare || b.yourShare - a.yourShare);
  return { rows, unread };
}

/** What AI-referred visitors did on the site, as content_plan_insights reads it. */
export interface PlanResults {
  visits: number;
  sessions: number;
  keyEvents: number;
  keyEventSessions: number;
  transactions: number;
  revenue: number;
  /** A Google Analytics property is connected. */
  analytics: boolean;
  /** The property reported purchases in the period. */
  purchases: boolean;
}
