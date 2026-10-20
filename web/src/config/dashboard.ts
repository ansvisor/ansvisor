import {
  BarChart3,
  Building2,
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
} from 'lucide-react';
import type { Feature } from '@/config/plans';

/**
 * A brand-level preference that, when present on a NavItem, must be `true`
 * on the active brand for the item to render at all. Distinct from plan-level
 * `requiredFeature` which downgrades the item to a locked/disabled state when
 * the plan doesn't include it — `requiresBrandPref` hides the item entirely so
 * it doesn't appear as a "you could have this if you paid more" hint when the
 * active brand isn't supposed to see Shopping in the first place.
 */
export type BrandPrefKey = 'shoppingModeEnabled';

/** A submenu entry under a NavItem (PROMPT-001). */
export interface NavChild {
  title: string;
  href: string;
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
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

export const dashboardNav: NavGroup[] = [
  {
    items: [
      {
        title: 'Brands',
        href: '/dashboard/brands',
        icon: Building2,
      },
    ],
  },
  /**
   * New Ansvisor: the groups name the two things the product does. Execution
   * does the work (actions, the agent, content, page fixes); Analytics shows
   * where the brand stands in AI search.
   */
  {
    title: 'Execution',
    items: [
      {
        title: 'Action Center',
        href: '/dashboard/action-center',
        icon: Target,
        badge: 'New',
      },
      // Right under Action Center: Chat is where you ask, or let the agent do
      // the work. The route stays /dashboard/agent: renaming the URL would
      // break every existing link for a label change, and the sidebar's
      // "Set up" badge keys off that href.
      {
        title: 'Chat',
        href: '/dashboard/agent',
        icon: Sparkles,
        requiredFeature: 'ai_agent',
      },
      // Content Editor (CE-001): a group, like Prompts. Opportunities is
      // today's page and keeps /dashboard/content; the Library lists every
      // page written or changed in Ansvisor.
      {
        title: 'Content',
        href: '/dashboard/content',
        icon: FileText,
        requiredFeature: 'content_optimization',
        children: [
          { title: 'Opportunities', href: '/dashboard/content' },
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
      {
        title: 'Answer Engine Insights',
        href: '/dashboard/insights',
        icon: BarChart3,
        requiredFeature: 'basic_insights',
      },
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
      // Mentions & Sentiment (MS-05): beside Citations, its sibling concept.
      {
        title: 'Mentions',
        href: '/dashboard/mentions',
        icon: MessageCircleMore,
        badge: 'New',
      },
      {
        title: 'Citations',
        href: '/dashboard/citations',
        icon: Quote,
      },
      {
        title: 'Shopping',
        href: '/dashboard/shopping',
        icon: ShoppingBag,
        requiredFeature: 'shopping_analytics',
        requiresBrandPref: 'shoppingModeEnabled',
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
   * It is also the only way into /dashboard/reports besides the button on
   * Visibility — from Citations or Site Audit there was no route to it at all.
   */
  {
    items: [
      {
        title: 'Reports',
        href: '/dashboard/reports',
        icon: FileBarChart,
      },
    ],
  },
];
