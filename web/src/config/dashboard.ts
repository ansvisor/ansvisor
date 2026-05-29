import {
  BarChart3,
  Building2,
  FileText,
  Globe,
  LineChart,
  Quote,
  Settings,
  Sparkles,
  Tag,
  Users,
} from 'lucide-react';
import type { Feature } from '@/config/plans';

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  disabled?: boolean;
  requiredFeature?: Feature;
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
  {
    title: 'System',
    items: [
      {
        title: 'Settings',
        href: '/dashboard/settings',
        icon: Settings,
      },
    ],
  },
];
