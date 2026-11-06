import {
  BarChart3,
  Bot,
  FileBarChart,
  FileText,
  Gauge,
  Globe,
  LineChart,
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
   * there either. Agent Center.
   */
  requiresChatAgentic?: boolean;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

/**
 * The brands page has no item here: the brand switcher above the menu opens
 * it ("Show My All Brands") and the selected brand's settings.
 */
export const dashboardNav: NavGroup[] = [
  /**
   * Chat first, above the groups and in none of them: it is where you ask
   * about anything below, or let the agent do the work. The route stays
   * /dashboard/agent: renaming the URL would break every existing link for a
   * label change, and the sidebar's "Set up" badge keys off that href.
   *
   * Agent Center right under it: the agents that run in Chat, on a page of
   * their own (was Chat › Agents, /dashboard/chat/agents, which redirects
   * here). Gated as Chat is, and there only with the new Chat on.
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
        title: 'Agent Center',
        href: '/dashboard/agents',
        icon: Bot,
        requiredFeature: 'ai_agent',
        requiresChatAgentic: true,
      },
    ],
  },
  /**
   * New Ansvisor: the groups name the two things the product does. Execution
   * does the work (actions, content, page fixes); Analytics shows where the
   * brand stands in AI search.
   */
  {
    title: 'Execution',
    items: [
      {
        title: 'Action Center',
        href: '/dashboard/action-center',
        icon: Target,
      },
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
    ],
  },
  {
    title: 'Analytics',
    items: [
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
      // Prompts right under Brand Visibility: adding prompts is the way in,
      // so nothing sits between them (Competitors moved under Reports).
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
      {
        title: 'AI Referral Traffic',
        href: '/dashboard/traffic',
        icon: LineChart,
        requiredFeature: 'advanced_analytics',
      },
    ],
  },
  /**
   * Reports sits in its own group rather than under Analytics or Execution,
   * because it draws on both: of its thirteen sections, `auditScore` comes from
   * Site Audit and the rest from the analytics surfaces. Filing it under either
   * heading would understate what it covers.
   *
   * It is also the only way into /dashboard/reports besides the Reports
   * button in Brand Visibility's header, on each of its tabs — from Site
   * Audit there is no other route to it.
   *
   * Competitors, the head-to-head with each competitor, sits right under it,
   * out of Analytics so that group stays short. Brand Visibility's
   * Leaderboard still opens it.
   */
  {
    items: [
      {
        title: 'Reports',
        href: '/dashboard/reports',
        icon: FileBarChart,
      },
      {
        title: 'Competitors',
        href: '/dashboard/competitors',
        icon: Users,
        requiredFeature: 'competitor_tracking',
      },
    ],
  },
];
