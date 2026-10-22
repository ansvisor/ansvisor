/**
 * Content drafts (Content Editor, CE-002): the pages a person or the Content
 * Agent writes or changes in Ansvisor, as the Library lists them. One row per
 * content_drafts row (migration 00204).
 */

import type { SiteType } from './page-types';
import type { DraftRules } from '@/lib/content/rules';

/** Draft → In review (an agent's draft waiting for a person) → Ready → Published. */
export const DRAFT_STATUSES = ['draft', 'in_review', 'ready', 'published'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** A new page, or an existing one improved. */
export type DraftMethod = 'create' | 'optimize';

/**
 * Where the Content Agent is on a draft Start gave it (CE-015,
 * content_drafts.agent_state, 00219): writing it, or couldn't finish.
 */
export type AgentState = 'writing' | 'failed' | null;

/** A 'writing' this old was left by a server that stopped (content-writer.js). */
export const WRITING_STALE_MS = 10 * 60_000;

/** How often the Library and the editor look again while the agent writes. */
export const AGENT_POLL_MS = 5_000;

/** The agent's state as the app shows it: a 'writing' gone stale reads as failed. */
export function agentStateOf(
  state: string | null,
  at: string | null,
  now: number = Date.now(),
): AgentState {
  if (state === 'failed') return 'failed';
  if (state !== 'writing') return null;
  return at && now - new Date(at).getTime() < WRITING_STALE_MS ? 'writing' : 'failed';
}

/**
 * The page types a draft can be, across brand types (B2B, e-commerce, B2C;
 * SITE_PAGE_TYPES says which). Stored as these keys (content_drafts.page_type);
 * named in en.json under contentEditor.pageTypes.
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
  // The formats www.ansvisor.com offers (content intelligence page).
  'definition',
  'alternatives',
  'collection_page',
  'sizing_guide',
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
  /** Where the Content Agent is on it (CE-015). */
  agentState: AgentState;
  updatedAt: string;
}

/**
 * Where a draft's page type comes from (CE-023): detected from the page, and
 * kept in step with it as it changes, until a person picks one.
 */
export type PageTypeSource = 'detected' | 'user';

/** A draft as the editor opens it. */
export interface ContentDraft {
  id: string;
  brandId: string;
  title: string;
  pageType: string | null;
  pageTypeSource: PageTypeSource;
  /** The brand's site type, which sets the page types on offer. */
  siteType: SiteType;
  /** The existing page an optimize draft is for, when Start picked one. */
  sourceUrl: string | null;
  method: DraftMethod;
  status: DraftStatus;
  bodyHtml: string;
  author: 'user' | 'agent';
  /** What the person changed on the page's rules for this draft (CE-009). */
  rules: DraftRules;
  /** The Action Center action the draft is the work of (CE-022), shown as "from Action AC-214". */
  action: { id: string; number: number } | null;
  /** Where the Content Agent is on it (CE-015): the editor waits while it writes. */
  agentState: AgentState;
  updatedAt: string;
}

/**
 * What New content starts a page from (CE-003): an opportunity, a tracked
 * prompt or a topic for a new page, or content to optimize.
 */
export type DraftSource =
  | { kind: 'opportunity' | 'prompt' | 'topic'; id: string }
  | { kind: 'content' };

/** A draft as Start opens it (CE-015). */
export interface DraftStart {
  method: DraftMethod;
  title: string;
  pageType: PageType;
  /** The person picked the type; otherwise it was Start's guess, and follows the page. */
  typePicked?: boolean;
  source: DraftSource;
  /** The content to optimize, as HTML. */
  bodyHtml?: string;
  /** The existing page to optimize instead of writing a new one (overlap check). */
  sourceUrl?: string;
}

/** A page of the brand's brought in by its URL (CE-003): main content, title and schema. */
export interface ImportedPage {
  /** The address after redirects. */
  url: string;
  title: string;
  html: string;
}

/** Why a page couldn't be brought in, as the API names it ('failed' for anything else). */
export const PAGE_IMPORT_ERRORS = [
  'off_site',
  'invalid_url',
  'blocked',
  'not_html',
  'http_error',
  'too_large',
  'timeout',
  'unreachable',
  'too_many_redirects',
  'failed',
] as const;
export type PageImportError = (typeof PAGE_IMPORT_ERRORS)[number];

/** One of the brand's pages AI already cites for a new page's prompts (CE-015). */
export interface OverlapPage {
  url: string;
  title: string | null;
  promptsInCommon: number;
  citations: number;
  /** Average Google position over the last 28 days; null without Search Console data. */
  gscPosition: number | null;
}

/** Start's overlap check: the prompts a new page would answer, and the pages that answer them. */
export interface ContentOverlap {
  totalPrompts: number;
  pages: OverlapPage[];
}

/** What New content offers to start a page from. */
export interface DraftStartOptions {
  /**
   * pageTitle: the page title its brief suggests, once one is generated;
   * the opportunity's own title says what to do, not what to call the page.
   */
  opportunities: { id: string; title: string; decision: string | null; pageTitle: string | null }[];
  /**
   * seen: the brand was named in or cited for it lately, so it needs no new
   * page (New content leaves it out; Add source keeps it). Not seen first.
   */
  prompts: { id: string; text: string; seen: boolean }[];
  /** How many active prompts are seen, past the listed ones too. */
  promptsSeen: number;
  topics: { id: string; name: string; promptCount: number }[];
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
