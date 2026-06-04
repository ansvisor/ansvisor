import {
  BarChart3,
  Building2,
  FileText,
  Globe,
  LineChart,
  Quote,
  ShoppingBag,
  Sparkles,
  Tag,
  Users,
} from 'lucide-react';
import type { Feature } from '@/config/plans';

/**
 * An org-level preference that, when present on a NavItem, must be `true`
 * for the item to render at all. Distinct from plan-level `requiredFeature`
 * which downgrades the item to a locked/disabled state when the plan
 * doesn't include it — `requiresOrgPref` hides the item entirely so it
 * doesn't appear as a "you could have this if you paid more" hint when the
 * relevant org isn't supposed to see Shopping in the first place.
 */
export type OrgPrefKey = 'shoppingModeEnabled';

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  disabled?: boolean;
  requiredFeature?: Feature;
  requiresOrgPref?: OrgPrefKey;
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
      {
        title: 'Agent',
        href: '/dashboard/agent',
        icon: Sparkles,
        requiredFeature: 'ai_agent',
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
        title: 'Topics',
        href: '/dashboard/topics',
        icon: Tag,
      },
      {
        title: 'Prompts',
        href: '/dashboard/prompts',
        icon: Globe,
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
        requiresOrgPref: 'shoppingModeEnabled',
      },
      {
        title: 'AI Traffic Analytics',
        href: '/dashboard/traffic',
        icon: LineChart,
        requiredFeature: 'advanced_analytics',
      },
      {
        title: 'Competitors',
        href: '/dashboard/competitors',
        icon: Users,
        requiredFeature: 'competitor_tracking',
      },
    ],
  },
  {
    title: 'Optimization',
    items: [
      {
        title: 'Content Optimization',
        href: '/dashboard/content',
        icon: FileText,
        requiredFeature: 'content_optimization',
      },
    ],
  },
];
