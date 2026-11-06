import { describe, expect, it } from 'vitest';
import { Bot, Sparkles } from 'lucide-react';
import messages from '../../messages/en.json';
import { dashboardNav } from '@/config/dashboard';
import {
  activeChildHref,
  CHAT_AGENTIC_HREF,
  CHAT_HREF,
  childLinkHref,
  dashboardNavBadge,
  dashboardNavLabelKeys,
  getDashboardNavGroupLabel,
  getDashboardNavLabel,
  isNavItemActive,
  navItemHref,
  shouldShowDashboardNavItem,
  visibleNavChildren,
} from '@/lib/dashboard-navigation';

const translateNav = (key: string) => `nav.${key}`;

describe('getDashboardNavLabel', () => {
  it('maps every dashboard item through an i18n key', () => {
    const titles = dashboardNav.flatMap((group) =>
      group.items.flatMap((item) => [
        item.title,
        ...(item.children ?? []).flatMap((c) => [
          c.title,
          ...(c.sectionTitle ? [c.sectionTitle] : []),
        ]),
      ]),
    );

    expect(Object.keys(dashboardNavLabelKeys).sort()).toEqual([...titles].sort());

    for (const title of titles) {
      expect(getDashboardNavLabel(title, translateNav)).not.toBe(title);
    }
  });

  // Topics moved into Prompts as one of its views, under the suggestions;
  // /dashboard/topics redirects there.
  it('lists Topics under Prompts, after Prompt Suggestions, and not as its own item', () => {
    const items = dashboardNav.flatMap((group) => group.items);
    const prompts = items.find((item) => item.title === 'Prompts')!;
    expect(prompts.children?.map((c) => c.title)).toEqual([
      'Tracked Prompts',
      'Prompt Suggestions',
      'Topics',
      'Query Fan-outs',
      'Prompts Insights',
    ]);
    expect(prompts.children?.[2].href).toBe('/dashboard/prompts/topics');
    expect(items.some((item) => item.href === '/dashboard/topics')).toBe(false);
  });

  // Content Editor (CE-001): Content is a group, new as a whole, its pages in
  // the order the work goes; Opportunities keeps today's route.
  it('lists Opportunities, the Plan, the Editor and the Library under Content', () => {
    const items = dashboardNav.flatMap((group) => group.items);
    const content = items.find((item) => item.title === 'Content')!;
    expect(content.href).toBe('/dashboard/content');
    expect(content.children).toEqual([
      { title: 'Opportunities', href: '/dashboard/content' },
      { title: 'Plan', href: '/dashboard/content/plan' },
      { title: 'Editor', href: '/dashboard/content/editor', keepsPage: true },
      { title: 'Library', href: '/dashboard/content/library' },
    ]);
  });

  it('reads each title from the nav namespace', () => {
    expect(getDashboardNavLabel('Products', translateNav)).toBe('nav.products');
    expect(getDashboardNavLabel('Product Visibility', translateNav)).toBe('nav.shopping');
  });

  it('leaves an unknown title unchanged', () => {
    expect(getDashboardNavLabel('Unknown', translateNav)).toBe('Unknown');
  });
});

describe('shouldShowDashboardNavItem', () => {
  it('has no Shopping item of its own any more: Product Visibility is under Visibility', () => {
    const items = dashboardNav.flatMap((group) => group.items);
    expect(items.some((item) => item.title === 'Shopping')).toBe(false);
    expect(items.some((item) => item.href === '/dashboard/shopping')).toBe(false);
  });

  it('hides a section off the viewer’s menu, by its route', () => {
    const content = dashboardNav
      .flatMap((group) => group.items)
      .find((item) => item.href === '/dashboard/content')!;
    const prefs = { ecommerce: true };

    expect(shouldShowDashboardNavItem(content, prefs, new Set(['content']))).toBe(false);
    expect(shouldShowDashboardNavItem(content, prefs, new Set(['audit']))).toBe(true);
  });

  it('shows Agent Center only with the new Chat on, and not when the viewer’s menu hides it', () => {
    const items = dashboardNav.flatMap((group) => group.items);
    const agentCenter = items.find((item) => item.href === '/dashboard/agents')!;
    const chat = items.find((item) => item.href === CHAT_HREF)!;
    const prefs = { ecommerce: false };

    expect(shouldShowDashboardNavItem(agentCenter, prefs)).toBe(false);
    expect(shouldShowDashboardNavItem(agentCenter, prefs, new Set(), false)).toBe(false);
    expect(shouldShowDashboardNavItem(agentCenter, prefs, new Set(), true)).toBe(true);
    expect(shouldShowDashboardNavItem(agentCenter, prefs, new Set(['agents']), true)).toBe(false);
    // Chat stays either way: its old page answers while the new Chat is off.
    expect(shouldShowDashboardNavItem(chat, prefs, new Set(), false)).toBe(true);
    expect(shouldShowDashboardNavItem(chat, prefs, new Set(['agents']), true)).toBe(true);
  });
});

// Brand Visibility (the owner's mockup): one page with three tabs. Mentions
// and Citations are no longer items of their own but its submenu's, each on
// the route its page always had.
describe('the Visibility group', () => {
  const analytics = dashboardNav.find((group) => group.title === 'Analytics')!.items;
  const brandVisibility = analytics.find((item) => item.title === 'Visibility')!;

  it('gathers Overview, Mentions and Citations, on their old routes', () => {
    expect(brandVisibility).toMatchObject({
      href: '/dashboard/insights',
      requiredFeature: 'basic_insights',
    });
    expect(brandVisibility.children?.map(({ title, href }) => ({ title, href }))).toEqual([
      { title: 'Overview', href: '/dashboard/insights' },
      { title: 'Mentions', href: '/dashboard/mentions' },
      { title: 'Citations', href: '/dashboard/citations' },
      { title: 'Products', href: '/dashboard/shopping' },
    ]);
    // No separate Mentions, Citations or Shopping items any more.
    expect(analytics.map((item) => item.title)).not.toContain('Mentions');
    expect(analytics.map((item) => item.title)).not.toContain('Citations');
    expect(analytics.map((item) => item.title)).not.toContain('Shopping');
  });

  it('shows Products only for a brand that sells online, on a plan with Product Visibility', () => {
    const titles = (ecommerce: boolean, plan: boolean, hidden: string[] = []) =>
      visibleNavChildren(brandVisibility, new Set(hidden), {
        brandPrefs: { ecommerce },
        canUse: (feature) => plan && feature === 'shopping_analytics',
      }).map((child) => child.title);

    expect(titles(true, true)).toEqual(['Overview', 'Mentions', 'Citations', 'Products']);
    // Off the menu, not locked, for any other brand or plan.
    expect(titles(false, true)).toEqual(['Overview', 'Mentions', 'Citations']);
    expect(titles(true, false)).toEqual(['Overview', 'Mentions', 'Citations']);
    // Its own section (menu access), as when it was an item.
    expect(titles(true, true, ['shopping'])).toEqual(['Overview', 'Mentions', 'Citations']);
    // Without the gates, a gated entry is left out.
    expect(visibleNavChildren(brandVisibility).map((child) => child.title)).toEqual([
      'Overview',
      'Mentions',
      'Citations',
    ]);
    expect(getDashboardNavLabel('Products', translateNav)).toBe('nav.products');
    expect(messages.nav.products).toBe('Products');
  });

  it('keeps Visibility on a menu with only Products left on it', () => {
    const hidden = new Set(['insights', 'mentions', 'citations']);
    const canUse = () => true;
    expect(
      shouldShowDashboardNavItem(brandVisibility, { ecommerce: true }, hidden, false, canUse),
    ).toBe(true);
    expect(
      shouldShowDashboardNavItem(brandVisibility, { ecommerce: false }, hidden, false, canUse),
    ).toBe(false);
  });

  it('reads its label from nav.insights, "Visibility", and its tabs’ from nav', () => {
    expect(getDashboardNavLabel('Visibility', translateNav)).toBe('nav.insights');
    expect(messages.nav.insights).toBe('Visibility');
    expect(getDashboardNavLabel('Overview', translateNav)).toBe('nav.overview');
    expect(messages.nav.overview).toBe('Overview');
    expect(messages.nav.mentions).toBe('Mentions');
    expect(messages.nav.citations).toBe('Citations');
  });

  it('is the current page on each of its tabs, and its tab the current entry', () => {
    for (const path of [
      '/dashboard/insights',
      '/dashboard/mentions',
      '/dashboard/citations',
      '/dashboard/shopping',
    ]) {
      expect(isNavItemActive(brandVisibility, path)).toBe(true);
    }
    expect(isNavItemActive(brandVisibility, '/dashboard/prompts/tracked')).toBe(false);
    expect(activeChildHref(brandVisibility.children!, '/dashboard/mentions')).toBe(
      '/dashboard/mentions',
    );
    expect(activeChildHref(brandVisibility.children!, '/dashboard/citations')).toBe(
      '/dashboard/citations',
    );
    // A result's page and a cited URL's sit under their tab.
    expect(activeChildHref(brandVisibility.children!, '/dashboard/insights/r1')).toBe(
      '/dashboard/insights',
    );
    expect(activeChildHref(brandVisibility.children!, '/dashboard/citations/url')).toBe(
      '/dashboard/citations',
    );
  });

  it('shows the tabs the viewer’s menu keeps, and goes only when all three are off it', () => {
    const prefs = { ecommerce: false };
    const titles = (hidden: string[]) =>
      visibleNavChildren(brandVisibility, new Set(hidden)).map((child) => child.title);

    expect(titles([])).toEqual(['Overview', 'Mentions', 'Citations']);
    expect(titles(['mentions'])).toEqual(['Overview', 'Citations']);
    expect(titles(['insights', 'mentions'])).toEqual(['Citations']);
    expect(shouldShowDashboardNavItem(brandVisibility, prefs, new Set(['insights']))).toBe(true);
    expect(
      shouldShowDashboardNavItem(
        brandVisibility,
        prefs,
        new Set(['insights', 'mentions', 'citations']),
      ),
    ).toBe(false);
  });
});

// Off the menu since #506 (only Brand Visibility's Leaderboard and Getting
// started opened it), back on it under Brand Visibility, then moved right
// under Reports so Prompts follows Brand Visibility and Analytics stays short.
describe('the Competitors item', () => {
  const analytics = dashboardNav.find((group) => group.title === 'Analytics')!.items;
  const reports = dashboardNav[dashboardNav.length - 1].items;
  const index = (title: string) => analytics.findIndex((item) => item.title === title);

  it('sits right under Reports, gated by competitor tracking, with no badge', () => {
    expect(index('Competitors')).toBe(-1);
    expect(reports.map((item) => item.title)).toEqual(['Reports', 'Competitors']);
    const item = reports[1];
    expect(item).toMatchObject({
      href: '/dashboard/competitors',
      requiredFeature: 'competitor_tracking',
    });
    expect(item.badge).toBeUndefined();
    expect(item.children).toBeUndefined();
  });

  it('leaves Prompts right under Visibility', () => {
    expect(index('Prompts')).toBe(index('Visibility') + 1);
  });

  it('reads Competitors from the nav namespace', () => {
    expect(getDashboardNavLabel('Competitors', translateNav)).toBe('nav.competitors');
    expect(messages.nav.competitors).toBe('Competitors');
  });
});

// New Ansvisor: Chat and Agent Center on their own above the groups, then
// Execution (do the work) above Analytics (measure it); the Optimization
// group is gone, its items moved under Execution.
describe('the sidebar groups', () => {
  it('runs Chat and Agent Center, Execution, Analytics, then Reports', () => {
    expect(dashboardNav.map((group) => group.title ?? null)).toEqual([
      null,
      'Execution',
      'Analytics',
      null,
    ]);
    expect(dashboardNav[0].items.map((item) => item.href)).toEqual([
      '/dashboard/agent',
      '/dashboard/agents',
    ]);
    expect(dashboardNav[3].items.map((item) => item.title)).toEqual(['Reports', 'Competitors']);
  });

  // Was Chat › Agents (/dashboard/chat/agents, which redirects there).
  it('puts Agent Center right under Chat, gated as Chat is, with the new Chat on only', () => {
    const [chat, agentCenter] = dashboardNav[0].items;
    expect(chat).toMatchObject({ title: 'Chat', icon: Sparkles, requiredFeature: 'ai_agent' });
    expect(agentCenter).toEqual({
      title: 'Agent Center',
      href: '/dashboard/agents',
      icon: Bot,
      requiredFeature: chat.requiredFeature,
      requiresChatAgentic: true,
    });
    expect(chat.requiresChatAgentic).toBeUndefined();
    expect(getDashboardNavLabel('Agent Center', translateNav)).toBe('nav.agentCenter');
    expect(messages.nav.agentCenter).toBe('Agent Center');
  });

  it('leaves the brands page to the brand switcher', () => {
    const hrefs = dashboardNav.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).not.toContain('/dashboard/brands');
  });

  it('puts Action Center, Content and Audit under Execution, in that order', () => {
    const execution = dashboardNav.find((group) => group.title === 'Execution')!;
    expect(execution.items.map((item) => item.href)).toEqual([
      '/dashboard/action-center',
      '/dashboard/content',
      '/dashboard/audit',
    ]);
  });

  it('translates every group title', () => {
    for (const group of dashboardNav) {
      if (group.title) {
        expect(getDashboardNavGroupLabel(group.title, translateNav)).not.toBe(group.title);
      }
    }
  });
});

describe('activeChildHref', () => {
  const content = [
    { title: 'Opportunities', href: '/dashboard/content' },
    { title: 'Library', href: '/dashboard/content/library' },
  ];

  it('marks only the Library on the Library, though its route starts with Opportunities’', () => {
    expect(activeChildHref(content, '/dashboard/content/library')).toBe(
      '/dashboard/content/library',
    );
  });

  it('marks the Editor while a draft is open in it', () => {
    const items = dashboardNav.flatMap((group) => group.items);
    const children = items.find((item) => item.title === 'Content')!.children!;
    expect(activeChildHref(children, '/dashboard/content/editor/d1')).toBe(
      '/dashboard/content/editor',
    );
    expect(activeChildHref(children, '/dashboard/content/library')).toBe(
      '/dashboard/content/library',
    );
    expect(activeChildHref(children, '/dashboard/content/3f2a')).toBe('/dashboard/content');
    expect(activeChildHref(children, '/dashboard/content/plan')).toBe('/dashboard/content/plan');
  });

  it('keeps an opportunity’s own page under Opportunities', () => {
    expect(activeChildHref(content, '/dashboard/content')).toBe('/dashboard/content');
    expect(activeChildHref(content, '/dashboard/content/3f2a')).toBe('/dashboard/content');
  });

  it('counts a view’s own pages, and nothing else', () => {
    const prompts = [{ title: 'Topics', href: '/dashboard/prompts/topics' }];
    expect(activeChildHref(prompts, '/dashboard/prompts/topics/t1')).toBe(
      '/dashboard/prompts/topics',
    );
    expect(activeChildHref(prompts, '/dashboard/prompts/topicsx')).toBeNull();
    expect(activeChildHref(content, '/dashboard/audit')).toBeNull();
  });
});

describe('childLinkHref', () => {
  const children = dashboardNav
    .flatMap((group) => group.items)
    .find((item) => item.title === 'Content')!.children!;
  const editor = children.find((c) => c.title === 'Editor')!;
  const library = children.find((c) => c.title === 'Library')!;

  it('keeps the Editor on the draft open, so clicking it doesn’t open it again', () => {
    expect(childLinkHref(editor, '/dashboard/content/editor/d1')).toBe(
      '/dashboard/content/editor/d1',
    );
    expect(childLinkHref(editor, '/dashboard/content/library')).toBe('/dashboard/content/editor');
  });

  it('links any other entry to its own route', () => {
    expect(childLinkHref(library, '/dashboard/content/library')).toBe('/dashboard/content/library');
    const topics = { title: 'Topics', href: '/dashboard/prompts/topics' };
    expect(childLinkHref(topics, '/dashboard/prompts/topics/t1')).toBe('/dashboard/prompts/topics');
  });
});

describe('dashboardNavBadge', () => {
  const items = dashboardNav.flatMap((group) => group.items);
  const chat = items.find((item) => item.title === 'Chat')!;
  const actionCenter = items.find((item) => item.title === 'Action Center')!;

  it('asks to set Chat up without a provider key, in words from en.json, else shows its own', () => {
    expect(messages.nav.chatSetUp).toBe('Set up');
    expect(dashboardNavBadge(chat, { chatSetUp: messages.nav.chatSetUp })).toBe('Set up');
    expect(dashboardNavBadge(chat, {})).toBe(chat.badge);
  });

  // The new Chat (CHAT_AGENTIC) runs on the plan's AI limit without a key:
  // there is nothing to set up.
  it('never asks to set Chat up with the new Chat on', () => {
    expect(dashboardNavBadge(chat, { chatAgentic: true, chatSetUp: 'Set up' })).toBe(chat.badge);
  });

  it("keeps every other item's own badge", () => {
    expect(dashboardNavBadge({ ...actionCenter, badge: 'Beta' }, { chatSetUp: 'Set up' })).toBe(
      'Beta',
    );
    expect(dashboardNavBadge(actionCenter, { chatSetUp: 'Set up' })).toBeUndefined();
  });

  // The demo brand's Chat is the real one, locked as the rest of the demo:
  // it no longer says it comes next week.
  it('has no words left for a Chat that comes next week', () => {
    expect('chat' in messages.demo).toBe(false);
  });

  it('marks nothing in the menu as New', () => {
    const badges = dashboardNav.flatMap((group) =>
      group.items.flatMap((item) => [item.badge, ...(item.children ?? []).map((c) => c.badge)]),
    );
    expect(badges.filter(Boolean)).toEqual([]);
  });
});

describe('navItemHref', () => {
  const chat = { href: CHAT_HREF };
  it('keeps Chat on its old address while the new Chat is off', () => {
    expect(navItemHref(chat, false)).toBe('/dashboard/agent');
  });
  it('opens /dashboard/chat with the new Chat on, and leaves every other item alone', () => {
    expect(navItemHref(chat, true)).toBe(CHAT_AGENTIC_HREF);
    expect(navItemHref({ href: '/dashboard/action-center' }, true)).toBe(
      '/dashboard/action-center',
    );
    expect(navItemHref({ href: '/dashboard/agents' }, true)).toBe('/dashboard/agents');
  });
});
