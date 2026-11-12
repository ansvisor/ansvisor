import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { MenuState } from '@/lib/menu-dots';

/**
 * The simplified menu's dots and the Action Center's count (SIMPLE_NAV,
 * PR 13), on the real menus: green "New results" and yellow "Needs you" on
 * the entries, on a closed submenu's or an icon's item, on a folded group's
 * title; never colour alone. One read per brand, again only once it is 5
 * minutes old. Yellow for admins and managers only, none off the menu, and
 * nothing at all without the flag.
 */

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span data-image={alt} />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
const nav = vi.hoisted(() => ({ pathname: '/dashboard/action-center/today' }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/actions/prompt', () => ({ getTrackedPromptCount: vi.fn(async () => 12) }));
const menu = vi.hoisted(() => ({ state: null as MenuState | null }));
const getMenuState = vi.hoisted(() => vi.fn(async () => menu.state));
vi.mock('@/lib/actions/menu-state', () => ({ getMenuState }));
const track = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', () => ({ track }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({ canUse: () => true, requiredPlanFor: () => 'Growth', isCloud: false }),
}));
vi.mock('@/hooks/use-agent-key-status', () => ({ useAgentKeyStatus: () => 'configured' }));
vi.mock('@/lib/actions/chat-prefs', () => ({
  saveChatRailOpen: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/components/layout/brand-switcher', () => ({ BrandSwitcher: () => null }));
vi.mock('@/components/layout/user-profile-nav-item', () => ({ UserProfileNavItem: () => null }));
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => null }));

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

const { Sidebar } = await import('./sidebar');
const { MobileNav } = await import('./mobile-nav');
const { MenuAccessProvider } = await import('@/components/providers/menu-access-provider');
const { ChatAgenticProvider } = await import('@/components/providers/chat-agentic-provider');
const { SimpleNavProvider } = await import('@/components/providers/simple-nav-provider');
const { RoleProvider } = await import('@/components/providers/role-provider');
const { DemoBrandContext } = await import('@/components/providers/demo-brand-provider');
const { useSidebarStore } = await import('@/stores/use-sidebar-store');
const { useBrandStore } = await import('@/stores/use-brand-store');
const { useMenuStateStore } = await import('@/stores/use-menu-state-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BEFORE = '2026-11-10T18:00:00.000Z';

/** After a night: everything new since yesterday's visits, AI traffic not connected. */
function afterNight(): MenuState {
  return {
    nightlyRunAt: '2026-11-11T03:10:00.000Z',
    newSuggestionAt: '2026-11-11T03:20:00.000Z',
    newActionAt: '2026-11-11T04:00:00.000Z',
    newOpportunityAt: '2026-11-11T04:30:00.000Z',
    traffic: { connectedAt: null },
    openActions: 3,
    navSeen: {
      insights: BEFORE,
      mentions: BEFORE,
      citations: BEFORE,
      'prompts/tracked': BEFORE,
      'prompts/suggestions': BEFORE,
      'action-center/actions': BEFORE,
      content: BEFORE,
    },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useSidebarStore.setState({ isCollapsed: false });
  useBrandStore.setState({ activeBrandId: BRAND });
  useMenuStateStore.setState({ read: null, pending: null, opened: {}, shown: {} });
  stored.clear();
  nav.pathname = '/dashboard/action-center/today';
  menu.state = afterNight();
  getMenuState.mockClear();
  track.mockClear();
  container = document.createElement('div');
  // A click on a link goes nowhere here.
  container.addEventListener('click', (e) => e.preventDefault());
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

interface Setup {
  simpleNav?: boolean;
  role?: 'admin' | 'manager' | 'analyst';
  hidden?: string[];
  demo?: boolean;
  mobile?: boolean;
}

async function render({
  simpleNav = true,
  role = 'manager',
  hidden = [],
  demo = false,
  mobile = false,
}: Setup = {}) {
  const demoState = { isDemo: demo, demoBrand: null, offer: 'first_month', neverSubscribed: false };
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SimpleNavProvider enabled={simpleNav}>
          <RoleProvider role={role}>
            <DemoBrandContext.Provider value={demoState as never}>
              <ChatAgenticProvider enabled>
                <MenuAccessProvider hidden={hidden} canManageMenus={false}>
                  {mobile ? <MobileNav /> : <Sidebar />}
                </MenuAccessProvider>
              </ChatAgenticProvider>
            </DemoBrandContext.Provider>
          </RoleProvider>
        </SimpleNavProvider>
      </NextIntlClientProvider>,
    );
  });
  // The read lands.
  await act(async () => {});
}

const link = (href: string) => container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
const parent = (href: string) =>
  container.querySelector<HTMLButtonElement>(`button[data-submenu="${href}"]`);
const groupHeader = (title: string) =>
  container.querySelector<HTMLButtonElement>(`button[data-nav-group="${title}"]`);
const dotIn = (el: Element | null) =>
  el?.querySelector<HTMLElement>('[data-menu-dot]')?.dataset.menuDot ?? null;
/** Every entry with a dot, as its route and colour. */
const dotted = (scope: ParentNode = container) =>
  Object.fromEntries(
    [...scope.querySelectorAll<HTMLElement>('[data-menu-dot]')].map((dot) => [
      dot.closest('a')?.getAttribute('href') ??
        dot.closest('button')?.dataset.submenu ??
        dot.closest('button')?.dataset.navGroup,
      dot.dataset.menuDot,
    ]),
  );

describe('the dots after a nightly run (SIMPLE_NAV)', () => {
  it('reads the brand’s state once, for the areas on the menu and the count', async () => {
    await render();
    expect(getMenuState).toHaveBeenCalledTimes(1);
    expect(getMenuState).toHaveBeenCalledWith(BRAND, {
      areas: [
        'insights',
        'mentions',
        'citations',
        'prompts/tracked',
        'prompts/suggestions',
        'traffic',
        'action-center/actions',
        'content',
      ],
      count: true,
      waiting: true,
    });
  });

  it('shows green on what has new results and yellow on what needs you', async () => {
    await render();
    expect(dotted()).toEqual({
      '/dashboard/action-center/actions': 'yellow',
      '/dashboard/prompts/tracked': 'green',
      '/dashboard/prompts/suggestions': 'yellow',
      '/dashboard/insights': 'green',
      '/dashboard/mentions': 'green',
      '/dashboard/citations': 'green',
      '/dashboard/traffic': 'yellow',
      '/dashboard/content': 'yellow',
    });
  });

  it('turns Tracked Prompts yellow while prompts wait for a spot (PR 16)', async () => {
    menu.state = { ...afterNight(), waitingPrompts: 2 };
    await render();
    expect(dotted()['/dashboard/prompts/tracked']).toBe('yellow');
    expect(
      link('/dashboard/prompts/tracked')!.querySelector('[data-menu-dot]')!.getAttribute('title'),
    ).toBe('Needs you');
  });

  it('says each in words on hover and to screen readers, never colour alone', async () => {
    await render();
    const green = link('/dashboard/mentions')!.querySelector('[data-menu-dot]')!;
    expect(green.getAttribute('role')).toBe('img');
    expect(green.getAttribute('aria-label')).toBe('New results');
    expect(green.getAttribute('title')).toBe('New results');
    const yellow = link('/dashboard/prompts/suggestions')!.querySelector('[data-menu-dot]')!;
    expect(yellow.getAttribute('aria-label')).toBe('Needs you');
    expect(yellow.getAttribute('title')).toBe('Needs you');
  });

  it('says "New results" beside Visibility, and counts the open actions on the Action Center', async () => {
    await render();
    expect(parent('/dashboard/insights')?.textContent).toBe('VisibilityNew results');
    expect(dotIn(parent('/dashboard/insights'))).toBe('green');
    const count = parent('/dashboard/action-center')!.querySelector('[data-open-actions]')!;
    expect(count.textContent).toBe('33 open actions, unassigned or yours');
    expect(count.getAttribute('title')).toBe('3 open actions, unassigned or yours');
    // An open submenu leaves its dots on its entries.
    expect(dotIn(parent('/dashboard/prompts'))).toBeNull();
  });

  it('puts a closed submenu’s strongest dot on its icon, yellow over green', async () => {
    await render();
    await act(async () => parent('/dashboard/prompts')!.click());
    expect(dotIn(parent('/dashboard/prompts'))).toBe('yellow');
    await act(async () => parent('/dashboard/insights')!.click());
    expect(dotIn(parent('/dashboard/insights'))).toBe('green');
    expect(parent('/dashboard/insights')?.className).toContain('relative');
  });

  it('puts a folded group’s dot on its title', async () => {
    await render();
    expect(dotIn(groupHeader('More'))).toBeNull();
    await act(async () => groupHeader('More')!.click());
    expect(dotIn(groupHeader('More'))).toBe('yellow');
    expect(groupHeader('More')?.querySelector('[data-menu-dot]')?.getAttribute('aria-label')).toBe(
      'Needs you',
    );
  });

  it('puts them on the icons when collapsed, the item named with its dot', async () => {
    useSidebarStore.setState({ isCollapsed: true });
    await render();
    const visibility = link('/dashboard/insights')!;
    expect(visibility.getAttribute('aria-label')).toBe('Visibility, New results');
    expect(visibility.querySelector('[title="Visibility, New results"]')).not.toBeNull();
    expect(dotIn(visibility)).toBe('green');
    expect(link('/dashboard/action-center')?.getAttribute('aria-label')).toBe(
      'Action Center, Needs you',
    );
    expect(link('/dashboard/traffic')?.getAttribute('aria-label')).toBe(
      'AI Referral Traffic, Needs you',
    );
    expect(link('/dashboard/audit')?.getAttribute('aria-label')).toBeNull();
    // No count on an icon.
    expect(container.querySelector('[data-open-actions]')).toBeNull();
  });

  it('clears a dot at once when its page is opened here', async () => {
    await render();
    await act(async () =>
      useMenuStateStore.getState().markOpened(BRAND, 'mentions', new Date().toISOString()),
    );
    expect(dotIn(link('/dashboard/mentions'))).toBeNull();
    expect(dotIn(link('/dashboard/citations'))).toBe('green');
  });

  it('reads again on a page change only once the read is 5 minutes old, or on a brand switch', async () => {
    await render();
    nav.pathname = '/dashboard/mentions';
    await render();
    expect(getMenuState).toHaveBeenCalledTimes(1);
    const read = useMenuStateStore.getState().read!;
    await act(async () =>
      useMenuStateStore.setState({ read: { ...read, at: Date.now() - 6 * 60_000 } }),
    );
    nav.pathname = '/dashboard/citations';
    await render();
    expect(getMenuState).toHaveBeenCalledTimes(2);
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await act(async () => useBrandStore.setState({ activeBrandId: other }));
    await act(async () => {});
    expect(getMenuState).toHaveBeenLastCalledWith(other, expect.anything());
  });

  it('tracks a dot shown once per area, and a click on one', async () => {
    await render();
    await render();
    const shown = track.mock.calls.filter(([event]) => event === 'menu_dot_shown');
    expect(shown).toHaveLength(8);
    expect(shown).toContainEqual([
      'menu_dot_shown',
      { area: 'mentions', colour: 'green', collapsed: false },
    ]);
    await act(async () => link('/dashboard/mentions')!.click());
    expect(track).toHaveBeenCalledWith('menu_dot_clicked', {
      area: 'mentions',
      colour: 'green',
      collapsed: false,
    });
  });
});

describe('who sees which dot', () => {
  it('shows a member the green ones alone, and reads nothing only yellow would use', async () => {
    await render({ role: 'analyst' });
    expect(dotted()).toEqual({
      '/dashboard/prompts/tracked': 'green',
      '/dashboard/insights': 'green',
      '/dashboard/mentions': 'green',
      '/dashboard/citations': 'green',
    });
    expect(getMenuState).toHaveBeenCalledWith(BRAND, {
      areas: ['insights', 'mentions', 'citations', 'prompts/tracked', 'traffic'],
      count: true,
      waiting: false,
    });
  });

  it('shows the demo brand the green ones alone', async () => {
    await render({ demo: true });
    expect(Object.values(dotted())).toEqual(['green', 'green', 'green', 'green']);
  });

  it('shows no dot for a section off the person’s menu, on itself or its parent', async () => {
    await render({ hidden: ['mentions', 'content'] });
    expect(link('/dashboard/mentions')).toBeNull();
    await act(async () => groupHeader('More')!.click());
    expect(dotIn(groupHeader('More'))).toBeNull();
    expect(dotIn(link('/dashboard/citations'))).toBe('green');
  });
});

describe('without SIMPLE_NAV', () => {
  it('reads nothing and shows no dot or count', async () => {
    await render({ simpleNav: false });
    expect(getMenuState).not.toHaveBeenCalled();
    expect(container.querySelector('[data-menu-dot]')).toBeNull();
    expect(container.querySelector('[data-open-actions]')).toBeNull();
  });
});

describe('the mobile menu', () => {
  it('shows the same dots on its entries, "New results" by Visibility and the count', async () => {
    await render({ mobile: true });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Toggle navigation menu"]')!
        .click(),
    );
    const sheet = document.body;
    expect(dotted(sheet)).toEqual({
      '/dashboard/action-center/actions': 'yellow',
      '/dashboard/prompts/tracked': 'green',
      '/dashboard/prompts/suggestions': 'yellow',
      '/dashboard/insights': 'green',
      '/dashboard/mentions': 'green',
      '/dashboard/citations': 'green',
      '/dashboard/traffic': 'yellow',
      '/dashboard/content': 'yellow',
    });
    expect(sheet.querySelector('a[href="/dashboard/insights"]')?.textContent).toContain(
      'New results',
    );
    expect(sheet.querySelector('[data-open-actions]')?.textContent).toContain('3');
  });
});
