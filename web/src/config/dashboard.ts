import {
  BarChart3,
  Bot,
  FileBarChart,
  FileText,
  Gauge,
  Globe,
  LineChart,
  Megaphone,
  MessageCircleMore,
  Quote,
  ShoppingBag,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import type { Feature } from '@/config/plans';

/**
 * A brand-level preference that, when present on a NavItem or a submenu
 * entry, must be `true` on the active brand for it to render at all.
 * Distinct from plan-level `requiredFeature` which downgrades an item to a
 * locked/disabled state when the plan doesn't include it — `requiresBrandPref`
 * hides it entirely so it doesn't appear as a "you could have this if you
 * paid more" hint when the active brand isn't supposed to see it in the first
 * place. `ecommerce`: the brand sells online (isEcommerceBrand: Shopping mode
 * on, or its site type is e-commerce).
 */
export type BrandPrefKey = 'ecommerce';

/** A submenu entry under a NavItem (PROMPT-001). */
export interface NavChild {
  title: string;
  href: string;
  /**
   * For an entry that is a menu section of its own (Brand Visibility's
   * Mentions and Citations, named by their routes): its icon where the
   * sections are listed (menu access). The submenu shows none.
   */
  icon?: React.ComponentType<{ className?: string }>;
  /** On one of its pages, it links to that page: the Editor stays on the draft open. */
  keepsPage?: boolean;
  /** A short tag after the label, e.g. "New". */
  badge?: string;
  /**
   * Where the menu's sections are listed (menu access), its section's name
   * when the menu's own is shorter: Visibility's Products is Product
   * Visibility there, as it was when it was an item of its own.
   */
  sectionTitle?: string;
  /**
   * Shown only on a plan with this feature and for a brand with this
   * preference: off either, the entry is off the menu, not locked
   * (Visibility's Products, as its tab).
   */
  requiredFeature?: Feature;
  requiresBrandPref?: BrandPrefKey;
  /**
   * Only with the new Chat on for the workspace (CHAT_AGENTIC), as an item's
   * flag of that name: off, the entry is on no menu and in no list of the
   * menu's sections. Action Center › Agents.
   */
  requiresChatAgentic?: boolean;
  /**
   * Pages of another address it is also the current entry on: History on
   * KPIs, one of its views.
   */
  currentOn?: string[];
}

export interface NavItem {
  title: string;
  href: string;
  /** Opens as a submenu under the item; the item itself then toggles it. */
  children?: NavChild[];
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  disabled?: boolean;
  requiredFeature?: Feature;
  requiresBrandPref?: BrandPrefKey;
  /**
   * Only with the new Chat on for the workspace (CHAT_AGENTIC): off, the item
   * is on no menu and in no list of the menu's sections, as its pages aren't
   * there either.
   */
  requiresChatAgentic?: boolean;
  /**
   * Only with Ads on (ADS_ENABLED, lib/ads/flag.ts): off, the item is on no
   * menu and in no list of the menu's sections, as its page isn't there
   * either. Ads, while it is in development.
   */
  requiresAds?: boolean;
  /** An outlined "New" pill after the label (NewPill), for a new area: Ads. */
  newPill?: boolean;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

/**
 * The left menu (the owner's decisions of 2026-11-11). Chat, then the
 * Action Center, where everyone lands, as a group of its own tabs: Today,
 * Actions, Signals, Agents (Agent Center at its own address, so its menu
 * section, links and Chat's routes stay; only with the new Chat on and a
 * plan with agents) and History. ANALYTICS, with Prompts first (adding
 * prompts is the way in), then Visibility, AI Referral Traffic and Ads,
 * last and only with ADS_ENABLED. MORE: Content, Site Audit, Reports and
 * Competitors.
 *
 * The brands page has no item here: the brand switcher above the menu opens
 * it ("Show My All Brands") and the selected brand's settings.
 */
export const dashboardNav: NavGroup[] = [
  /**
   * Chat first, above the groups and in none of them: it is where you ask
   * about anything below, or let the agent do the work. The route stays
   * /dashboard/agent: renaming the URL would break every existing link for a
   * label change, and the sidebar's "Set up" badge keys off that href.
   */
  {
    items: [
      {
        title: 'Chat',
        href: '/dashboard/agent',
        icon: Sparkles,
        requiredFeature: 'ai_agent',
      },
      {
        title: 'Action Center',
        href: '/dashboard/action-center',
        icon: Target,
        children: [
          { title: 'Today', href: '/dashboard/action-center/today' },
          { title: 'Actions', href: '/dashboard/action-center/actions' },
          { title: 'Signals', href: '/dashboard/action-center/signals' },
          {
            title: 'Agents',
            href: '/dashboard/agents',
            icon: Bot,
            // Where menu access lists the sections: under the Action Center's row.
            sectionTitle: 'Agents · in Action Center',
            requiredFeature: 'ai_agent',
            requiresChatAgentic: true,
          },
          {
            title: 'History',
            href: '/dashboard/action-center/history',
            currentOn: ['/dashboard/action-center/kpis'],
          },
        ],
      },
    ],
  },
  {
    title: 'Analytics',
    items: [
      // Prompts first: adding prompts is the way in.
      {
        title: 'Prompts',
        href: '/dashboard/prompts',
        icon: Globe,
        children: [
          { title: 'Tracked Prompts', href: '/dashboard/prompts/tracked' },
          { title: 'Prompt Suggestions', href: '/dashboard/prompts/suggestions' },
          // Was the Topics page (/dashboard/topics, which redirects here).
          { title: 'Topics', href: '/dashboard/prompts/topics' },
          { title: 'Query Fan-outs', href: '/dashboard/prompts/fan-outs' },
          { title: 'Prompts Insights', href: '/dashboard/prompts/insights' },
        ],
      },
      // Brand Visibility (the owner's mockup): one page with its tabs, a
      // group like Prompts and Content. Each tab keeps its page's address
      // (Mentions & Sentiment, Citations and Product Visibility were items
      // of their own), so every link to them still opens them and each
      // stays a menu section of its own (menu access). Products is Product
      // Visibility (ECOM-spec), for brands that sell online on a plan with
      // it (owner, 2026-11-06), as its tab.
      {
        title: 'Visibility',
        href: '/dashboard/insights',
        icon: BarChart3,
        requiredFeature: 'basic_insights',
        children: [
          { title: 'Overview', href: '/dashboard/insights' },
          { title: 'Mentions', href: '/dashboard/mentions', icon: MessageCircleMore },
          { title: 'Citations', href: '/dashboard/citations', icon: Quote },
          {
            title: 'Products',
            href: '/dashboard/shopping',
            icon: ShoppingBag,
            sectionTitle: 'Product Visibility',
            requiredFeature: 'shopping_analytics',
            requiresBrandPref: 'ecommerce',
          },
        ],
      },
      {
        title: 'AI Referral Traffic',
        href: '/dashboard/traffic',
        icon: LineChart,
        requiredFeature: 'advanced_analytics',
      },
      // Ads (ADS-01): earn the AI answer, pay for it, or both. Last of
      // Analytics, after AI Referral Traffic, new. Only with ADS_ENABLED on,
      // while it is in development (owner, 2026-11-10). No requiredFeature:
      // Starter opens the page and sees what Growth adds there (DECISIONS J),
      // so the item isn't locked here.
      {
        title: 'Ads',
        href: '/dashboard/ads',
        icon: Megaphone,
        requiresAds: true,
        newPill: true,
      },
    ],
  },
  {
    title: 'More',
    items: [
      // Content Editor (CE-001): a group, like Prompts, and new as a whole.
      // Its pages in the order the work goes: Opportunities (today's page,
      // keeping /dashboard/content) finds what to write, the Plan says what
      // to do next (CE-014), the Editor goes back to the draft last opened,
      // else starts a new page, and the Library lists every page written or
      // changed in Ansvisor.
      {
        title: 'Content',
        href: '/dashboard/content',
        icon: FileText,
        requiredFeature: 'content_optimization',
        children: [
          { title: 'Opportunities', href: '/dashboard/content' },
          { title: 'Plan', href: '/dashboard/content/plan' },
          // A draft open in the editor (CE-004) is under it.
          { title: 'Editor', href: '/dashboard/content/editor', keepsPage: true },
          { title: 'Library', href: '/dashboard/content/library' },
        ],
      },
      {
        title: 'Site Audit',
        href: '/dashboard/audit',
        icon: Gauge,
        requiredFeature: 'content_optimization',
      },
      // Reports draws on both Analytics and Site Audit; Brand Visibility's
      // header also opens it, on each of its tabs.
      {
        title: 'Reports',
        href: '/dashboard/reports',
        icon: FileBarChart,
      },
      // The head-to-head with each competitor; Brand Visibility's
      // Leaderboard still opens it.
      {
        title: 'Competitors',
        href: '/dashboard/competitors',
        icon: Users,
        requiredFeature: 'competitor_tracking',
      },
    ],
  },
];
