/**
 * Content drafts (Content Editor, CE-002): the pages a person or the Content
 * Agent writes or changes in Ansvisor, as the Library lists them. One row per
 * content_drafts row (migration 00204).
 */

/** Draft → In review (an agent's draft waiting for a person) → Ready → Published. */
export const DRAFT_STATUSES = ['draft', 'in_review', 'ready', 'published'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** A new page, or an existing one improved. */
export type DraftMethod = 'create' | 'optimize';

/**
 * The page types a draft can be, across brand types (B2B, e-commerce, B2C).
 * Stored as these keys (content_drafts.page_type); named in en.json under
 * content.pageTypes.
 */
export const PAGE_TYPES = [
  'feature_page',
  'solution_page',
  'comparison',
  'integration',
  'pricing',
  'guide',
  'blog_post',
  'docs_faq',
  'product_page',
  'category_page',
  'buying_guide',
  'best_of',
  'policy',
  'destination_page',
  'itinerary',
  'help_faq',
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export function isPageType(value: string | null): value is PageType {
  return value !== null && (PAGE_TYPES as readonly string[]).includes(value);
}

/** The Library (CE-001 route). */
export const CONTENT_LIBRARY_PATH = '/dashboard/content/library';

/** Where a draft opens: the editor (CE-004). */
export function contentEditorPath(draftId: string) {
  return `/dashboard/content/editor/${draftId}`;
}

/** The Library's tabs: everything, then one per status. */
export const LIBRARY_TABS = ['all', ...DRAFT_STATUSES] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

export interface DraftAuthor {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  email?: string | null;
}

export interface ContentDraftListItem {
  id: string;
  title: string;
  pageType: string | null;
  method: DraftMethod;
  status: DraftStatus;
  /** A person or the Content Agent. */
  author: 'user' | 'agent';
  /** The person who started it: null for an agent's draft, or a member since removed. */
  createdBy: DraftAuthor | null;
  /** Whether the signed-in member started it ("You"). */
  isMine: boolean;
  scoreBefore: number | null;
  scoreAfter: number | null;
  updatedAt: string;
}

/** A draft as the editor opens it. */
export interface ContentDraft {
  id: string;
  brandId: string;
  title: string;
  pageType: string | null;
  method: DraftMethod;
  status: DraftStatus;
  bodyHtml: string;
  author: 'user' | 'agent';
  updatedAt: string;
}

export function draftsInTab(drafts: ContentDraftListItem[], tab: LibraryTab) {
  return tab === 'all' ? drafts : drafts.filter((d) => d.status === tab);
}

export function libraryTabCounts(drafts: ContentDraftListItem[]): Record<LibraryTab, number> {
  const counts = Object.fromEntries(LIBRARY_TABS.map((tab) => [tab, 0])) as Record<
    LibraryTab,
    number
  >;
  counts.all = drafts.length;
  for (const d of drafts) counts[d.status] += 1;
  return counts;
}

/** "62 → 78" once the changes are scored, "54" before, null with no score yet. */
export function aeoScoreText(before: number | null, after: number | null): string | null {
  if (before !== null && after !== null && after !== before) return `${before} → ${after}`;
  const score = after ?? before;
  return score === null ? null : String(score);
}
