import { describe, expect, it } from 'vitest';
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
  navItemHref,
  shouldShowDashboardNavItem,
} from '@/lib/dashboard-navigation';

const translateNav = (key: string) => `nav.${key}`;

describe('getDashboardNavLabel', () => {
  it('maps every dashboard item through an i18n key', () => {
    const titles = dashboardNav.flatMap((group) =>
      group.items.flatMap((item) => [item.title, ...(item.children ?? []).map((c) => c.title)]),
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
  it('lists Opportunities, the Plan, the Editor and the Library under Content, new', () => {
    const items = dashboardNav.flatMap((group) => group.items);
    const content = items.find((item) => item.title === 'Content')!;
    expect(content.href).toBe('/dashboard/content');
    expect(content.badge).toBe('New');
    expect(content.children).toEqual([
      { title: 'Opportunities', href: '/dashboard/content' },
      { title: 'Plan', href: '/dashboard/content/plan' },
      { title: 'Editor', href: '/dashboard/content/editor', keepsPage: true },
      { title: 'Library', href: '/dashboard/content/library' },
    ]);
  });

  it('reads each title from the nav namespace', () => {
    expect(getDashboardNavLabel('Shopping', translateNav)).toBe('nav.shopping');
  });

  it('leaves an unknown title unchanged', () => {
    expect(getDashboardNavLabel('Unknown', translateNav)).toBe('Unknown');
  });
});

describe('shouldShowDashboardNavItem', () => {
  const shopping = dashboardNav
    .flatMap((group) => group.items)
    .find((item) => item.title === 'Shopping')!;

  it('hides Shopping when the active brand has shopping mode disabled', () => {
    expect(shouldShowDashboardNavItem(shopping, { shoppingModeEnabled: false })).toBe(false);
  });

  it('shows Shopping when the active brand enables shopping mode', () => {
    expect(shouldShowDashboardNavItem(shopping, { shoppingModeEnabled: true })).toBe(true);
  });

  // Product Visibility (ECOM-spec) is new as a whole.
  it('marks Shopping new', () => {
    expect(shopping.badge).toBe('New');
  });

  it('hides a section off the viewer’s menu, by its route', () => {
    const content = dashboardNav
      .flatMap((group) => group.items)
      .find((item) => item.href === '/dashboard/content')!;
    const prefs = { shoppingModeEnabled: true };

    expect(shouldShowDashboardNavItem(content, prefs, new Set(['content']))).toBe(false);
    expect(shouldShowDashboardNavItem(content, prefs, new Set(['audit']))).toBe(true);
    expect(shouldShowDashboardNavItem(shopping, prefs, new Set(['shopping']))).toBe(false);
  });
});

describe('the Mentions item', () => {
  const analytics = dashboardNav.find((group) => group.title === 'Analytics')!.items;
  const index = (title: string) => analytics.findIndex((item) => item.title === title);

  it('sits directly above Citations, marked New', () => {
    expect(index('Mentions')).toBe(index('Citations') - 1);
    expect(analytics[index('Mentions')]).toMatchObject({
      href: '/dashboard/mentions',
      badge: 'New',
    });
  });
});

// New Ansvisor: Execution (do the work) above Analytics (measure it); the
// Optimization group is gone, its items moved under Execution.
describe('the sidebar groups', () => {
  it('runs Execution, Analytics, then Reports', () => {
    expect(dashboardNav.map((group) => group.title ?? null)).toEqual([
      'Execution',
      'Analytics',
      null,
    ]);
    expect(dashboardNav[2].items.map((item) => item.title)).toEqual(['Reports']);
  });

  it('leaves the brands page to the brand switcher', () => {
    const hrefs = dashboardNav.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).not.toContain('/dashboard/brands');
  });

  it('puts Action Center, Chat, Content and Audit under Execution, in that order', () => {
    const execution = dashboardNav.find((group) => group.title === 'Execution')!;
    expect(execution.items.map((item) => item.href)).toEqual([
      '/dashboard/action-center',
      '/dashboard/agent',
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

  it("says Chat comes next week on the demo brand, before it's set up", () => {
    expect(dashboardNavBadge(chat, { chatSoon: 'Soon (next week)', agentKeyMissing: true })).toBe(
      'Soon (next week)',
    );
  });

  it('asks to set Chat up without a provider key, else shows its own', () => {
    expect(dashboardNavBadge(chat, { agentKeyMissing: true })).toBe('Set up');
    expect(dashboardNavBadge(chat, {})).toBe(chat.badge);
  });

  it("keeps every other item's own badge", () => {
    expect(dashboardNavBadge(actionCenter, { chatSoon: 'Soon (next week)' })).toBe('New');
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
  });
});
