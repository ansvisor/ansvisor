import { describe, expect, it } from 'vitest';
import { Bot, Megaphone, Target } from 'lucide-react';
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

    expect(Object.keys(dashboardNavLabelKeys).sort()).toEqual([...new Set(titles)].sort());

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

  it('shows Ads only with Ads on, and not when the viewer’s menu hides it', () => {
    const items = dashboardNav.flatMap((group) => group.items);
    const ads = items.find((item) => item.href === '/dashboard/ads')!;
    const traffic = items.find((item) => item.href === '/dashboard/traffic')!;
    const prefs = { ecommerce: false };
    const all = () => true;

    // Off by default, whatever else is on.
    expect(shouldShowDashboardNavItem(ads, prefs)).toBe(false);
    expect(shouldShowDashboardNavItem(ads, prefs, new Set(), true, all)).toBe(false);
    expect(shouldShowDashboardNavItem(ads, prefs, new Set(), true, all, false)).toBe(false);
    // On, with or without the new Chat; off again when the menu leaves it out.
    expect(shouldShowDashboardNavItem(ads, prefs, new Set(), false, all, true)).toBe(true);
    expect(shouldShowDashboardNavItem(ads, prefs, new Set(), true, all, true)).toBe(true);
    expect(shouldShowDashboardNavItem(ads, prefs, new Set(['ads']), true, all, true)).toBe(false);
    // Every other item stays as it is either way.
    for (const item of items.filter((i) => !i.requiresAds)) {
      for (const chatOn of [false, true]) {
        expect(shouldShowDashboardNavItem(item, prefs, new Set(), chatOn, all, true)).toBe(
          shouldShowDashboardNavItem(item, prefs, new Set(), chatOn, all, false),
        );
      }
    }
    expect(shouldShowDashboardNavItem(traffic, prefs, new Set(), false, all, true)).toBe(true);
  });
});

// Ads (ADS-01 §9 item 1, owner A1): under Analytics, after AI Referral
// Traffic and before Reports, with an outlined "New" pill; only with
// ADS_ENABLED on. Nothing else on the menu moves.
describe('the Ads item', () => {
  const analytics = dashboardNav.find((group) => group.title === 'Analytics')!.items;

  it('closes Analytics, right after AI Referral Traffic, before More', () => {
    expect(analytics.map((item) => item.title)).toEqual([
      'Prompts',
      'Visibility',
      'AI Referral Traffic',
      'Ads',
    ]);
    const hrefs = dashboardNav.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs.indexOf('/dashboard/ads')).toBe(hrefs.indexOf('/dashboard/traffic') + 1);
    expect(hrefs.indexOf('/dashboard/ads')).toBeLessThan(hrefs.indexOf('/dashboard/reports'));
  });

  it('is new, behind Ads’ flag, and locked by no plan on the menu (its page shows the lock)', () => {
    const ads = analytics.find((item) => item.title === 'Ads')!;
    expect(ads).toEqual({
      title: 'Ads',
      href: '/dashboard/ads',
      icon: Megaphone,
      requiresAds: true,
      newPill: true,
    });
    expect(getDashboardNavLabel('Ads', translateNav)).toBe('nav.ads');
    expect(messages.nav.ads).toBe('Ads');
    // No other item is behind it or marked new.
    const others = dashboardNav.flatMap((group) => group.items).filter((item) => item !== ads);
    expect(others.some((item) => item.requiresAds || item.newPill)).toBe(false);
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

  it('sits right under Reports in More, gated by competitor tracking, with no badge', () => {
    expect(index('Competitors')).toBe(-1);
    expect(reports.map((item) => item.title).slice(-2)).toEqual(['Reports', 'Competitors']);
    const item = reports.at(-1)!;
    expect(item).toMatchObject({
      href: '/dashboard/competitors',
      requiredFeature: 'competitor_tracking',
    });
    expect(item.badge).toBeUndefined();
    expect(item.children).toBeUndefined();
  });

  it('puts Prompts first, right above Visibility', () => {
    expect(index('Visibility')).toBe(index('Prompts') + 1);
  });

  it('reads Competitors from the nav namespace', () => {
    expect(getDashboardNavLabel('Competitors', translateNav)).toBe('nav.competitors');
    expect(messages.nav.competitors).toBe('Competitors');
  });
});

describe('the sidebar groups', () => {
  it('leaves the brands page to the brand switcher', () => {
    const hrefs = dashboardNav.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).not.toContain('/dashboard/brands');
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

/**
 * The simplified menu (SIMPLE_NAV), while it is built: the owner's menu of
 * 2026-11-11, every item but the Action Center reused from dashboardNav.
 */
describe('the simplified menu', () => {
  const tabs = dashboardNav[0].items[1].children ?? [];

  it('runs Chat and the Action Center, ANALYTICS, then MORE', () => {
    expect(dashboardNav.map((group) => group.title ?? null)).toEqual([null, 'Analytics', 'More']);
    expect(dashboardNav.map((group) => group.items.map((item) => item.href))).toEqual([
      ['/dashboard/agent', '/dashboard/action-center'],
      ['/dashboard/prompts', '/dashboard/insights', '/dashboard/traffic', '/dashboard/ads'],
      ['/dashboard/content', '/dashboard/audit', '/dashboard/reports', '/dashboard/competitors'],
    ]);
  });

  it('opens the Action Center on Today, Actions, Signals, Agents and History', () => {
    const actionCenter = dashboardNav[0].items[1];
    expect(actionCenter).toMatchObject({ title: 'Action Center', icon: Target });
    expect(actionCenter.requiredFeature).toBeUndefined();
    expect(tabs.map((tab) => [tab.title, tab.href])).toEqual([
      ['Today', '/dashboard/action-center/today'],
      ['Actions', '/dashboard/action-center/actions'],
      ['Signals', '/dashboard/action-center/signals'],
      ['Agents', '/dashboard/agents'],
      ['History', '/dashboard/action-center/history'],
    ]);
    // Agent Center, moved in at its own address, gated as it was.
    expect(tabs[3]).toEqual({
      title: 'Agents',
      href: '/dashboard/agents',
      icon: Bot,
      sectionTitle: 'Agents · in Action Center',
      requiredFeature: 'ai_agent',
      requiresChatAgentic: true,
    });
    const hrefs = dashboardNav.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).not.toContain('/dashboard/agents');
  });

  it('reuses every other item as it is, Ads with its flag and New pill', () => {
    const classic = dashboardNav.flatMap((group) => group.items);
    for (const item of dashboardNav.flatMap((group) => group.items)) {
      if (item.href === '/dashboard/action-center') continue;
      expect(classic).toContain(item);
    }
    const ads = dashboardNav[1].items.at(-1)!;
    expect(ads).toMatchObject({ href: '/dashboard/ads', requiresAds: true, newPill: true });
  });

  it('shows Agents only with the new Chat on, a plan with agents and its section on the menu', () => {
    const actionCenter = dashboardNav[0].items[1];
    const shown = (gates: { chatAgentic?: boolean; agents?: boolean }, hidden: string[] = []) =>
      visibleNavChildren(actionCenter, new Set(hidden), {
        brandPrefs: { ecommerce: false },
        canUse: (feature) => feature !== 'ai_agent' || gates.agents !== false,
        chatAgentic: gates.chatAgentic,
      }).map((child) => child.title);
    expect(shown({ chatAgentic: true })).toEqual([
      'Today',
      'Actions',
      'Signals',
      'Agents',
      'History',
    ]);
    expect(shown({ chatAgentic: false })).toEqual(['Today', 'Actions', 'Signals', 'History']);
    expect(shown({ chatAgentic: true, agents: false })).toEqual([
      'Today',
      'Actions',
      'Signals',
      'History',
    ]);
    expect(shown({ chatAgentic: true }, ['agents'])).toEqual([
      'Today',
      'Actions',
      'Signals',
      'History',
    ]);
    // Without gates (no plan to go by), an entry for some plans only is left out.
    expect(visibleNavChildren(actionCenter).map((child) => child.title)).not.toContain('Agents');
  });

  it('keeps the Action Center on every menu: its tabs are its own section', () => {
    const actionCenter = dashboardNav[0].items[1];
    expect(
      shouldShowDashboardNavItem(
        actionCenter,
        { ecommerce: false },
        new Set(['agents']),
        false,
        () => true,
      ),
    ).toBe(true);
  });

  it('is current on the Action Center’s pages and on Agents’', () => {
    const actionCenter = dashboardNav[0].items[1];
    expect(isNavItemActive(actionCenter, '/dashboard/action-center/today')).toBe(true);
    expect(isNavItemActive(actionCenter, '/dashboard/agents/abc')).toBe(true);
    expect(activeChildHref(tabs, '/dashboard/agents/abc/edit')).toBe('/dashboard/agents');
    // KPIs is one of History's views: History is its current entry.
    expect(activeChildHref(tabs, '/dashboard/action-center/kpis')).toBe(
      '/dashboard/action-center/history',
    );
    expect(isNavItemActive(actionCenter, '/dashboard/action-center/kpis')).toBe(true);
    expect(activeChildHref(tabs, '/dashboard/action-center/review')).toBeNull();
    expect(isNavItemActive(actionCenter, '/dashboard/agent')).toBe(false);
  });

  it('names its tabs and MORE from the nav namespace', () => {
    for (const title of ['Today', 'Actions', 'Signals', 'Agents', 'History']) {
      const key = dashboardNavLabelKeys[title];
      expect(messages.nav[key as keyof typeof messages.nav]).toBe(title);
    }
    expect(getDashboardNavGroupLabel('More', translateNav)).toBe('nav.more');
    expect(messages.nav.more).toBe('More');
  });
});
