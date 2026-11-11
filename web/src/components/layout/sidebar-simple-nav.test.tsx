import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * The simplified menu (SIMPLE_NAV), on the real menus: Chat; the Action
 * Center with Today, Actions, Signals, Agents and History under it;
 * ANALYTICS (Prompts, Visibility, AI Referral Traffic, Ads last); MORE
 * (Content, Audit, Reports, Competitors). With the flag off, the menu as it
 * was. Every behaviour of the menu stays: collapsing to icons, opening on
 * hover, pinning, folding groups and submenus, the arrow keys, plan locks,
 * menu access and the Tracked Prompts count.
 */

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span data-image={alt} />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
const nav = vi.hoisted(() => ({ pathname: '/dashboard/insights' }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const getTrackedPromptCount = vi.hoisted(() => vi.fn(async () => 12));
vi.mock('@/lib/actions/prompt', () => ({ getTrackedPromptCount }));
// Every feature, self-hosted, unless a test narrows the plan on the cloud.
const gate = vi.hoisted(() => ({ isCloud: false, features: null as string[] | null }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({
    canUse: (feature: string) => gate.features === null || gate.features.includes(feature),
    requiredPlanFor: () => 'Growth',
    isCloud: gate.isCloud,
  }),
}));
vi.mock('@/hooks/use-agent-key-status', () => ({ useAgentKeyStatus: () => 'configured' }));
vi.mock('@/lib/actions/chat-prefs', () => ({
  saveChatRailOpen: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/components/layout/brand-switcher', () => ({ BrandSwitcher: () => null }));
vi.mock('@/components/layout/user-profile-nav-item', () => ({ UserProfileNavItem: () => null }));
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => null }));

// The sidebar's store keeps its state in localStorage, which this jsdom lacks.
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
const { AdsProvider } = await import('@/components/providers/ads-provider');
const { SimpleNavProvider } = await import('@/components/providers/simple-nav-provider');
const { useSidebarStore } = await import('@/stores/use-sidebar-store');
const { useBrandStore } = await import('@/stores/use-brand-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useSidebarStore.setState({ isCollapsed: false });
  useBrandStore.setState({ activeBrandId: 'brand-1' });
  stored.clear();
  nav.pathname = '/dashboard/insights';
  gate.isCloud = false;
  gate.features = null;
  getTrackedPromptCount.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

interface Setup {
  simpleNav?: boolean;
  chatAgentic?: boolean;
  ads?: boolean;
  hidden?: string[];
  mobile?: boolean;
}

async function render({
  simpleNav = true,
  chatAgentic = true,
  ads = false,
  hidden = [],
  mobile = false,
}: Setup = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SimpleNavProvider enabled={simpleNav}>
          <ChatAgenticProvider enabled={chatAgentic}>
            <AdsProvider enabled={ads}>
              <MenuAccessProvider hidden={hidden} canManageMenus={false}>
                {mobile ? <MobileNav /> : <Sidebar />}
              </MenuAccessProvider>
            </AdsProvider>
          </ChatAgenticProvider>
        </SimpleNavProvider>
      </NextIntlClientProvider>,
    );
  });
}

/** The menu's rows, top to bottom: group titles in capitals' place, items and submenu entries. */
function rows(): string[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button[data-nav-group], [data-nav-item="parent"], [data-nav-item="link"], [data-nav-item="child"]',
    ),
  ].map((el) => {
    const label = (el.querySelector('.truncate') ?? el).textContent ?? '';
    if (el.dataset.navGroup) return `# ${label}`;
    return el.dataset.navItem === 'child' ? `  ${label}` : label;
  });
}

const parent = (href: string) =>
  container.querySelector<HTMLButtonElement>(`button[data-submenu="${href}"]`);
const link = (href: string) => container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
const groupHeader = (title: string) =>
  container.querySelector<HTMLButtonElement>(`button[data-nav-group="${title}"]`);

describe('the menu without SIMPLE_NAV', () => {
  it('is as it was: Agent Center under Chat, Analytics, Execution, Reports and Competitors', async () => {
    await render({ simpleNav: false });
    expect(rows()).toEqual([
      'Chat',
      'Agent Center',
      '# Analytics',
      'Visibility',
      '  Overview',
      '  Mentions',
      '  Citations',
      'Prompts',
      '  Tracked Prompts',
      '  Prompt Suggestions',
      '  Topics',
      '  Query Fan-outs',
      '  Insights',
      'AI Referral Traffic',
      '# Execution',
      'Action Center',
      'Content',
      '  Opportunities',
      '  Plan',
      '  Editor',
      '  Library',
      'Audit',
      'Reports',
      'Competitors',
    ]);
    expect(link('/dashboard/action-center/today')).toBeNull();
    expect(container.textContent).not.toContain('More');
  });
});

describe('the simplified menu (SIMPLE_NAV)', () => {
  it('is Chat, the Action Center with its tabs, ANALYTICS with Prompts first, and MORE', async () => {
    await render();
    expect(rows()).toEqual([
      'Chat',
      'Action Center',
      '  Today',
      '  Actions',
      '  Signals',
      '  Agents',
      '  History',
      '# Analytics',
      'Prompts',
      '  Tracked Prompts',
      '  Prompt Suggestions',
      '  Topics',
      '  Query Fan-outs',
      '  Insights',
      'Visibility',
      '  Overview',
      '  Mentions',
      '  Citations',
      'AI Referral Traffic',
      '# More',
      'Content',
      '  Opportunities',
      '  Plan',
      '  Editor',
      '  Library',
      'Audit',
      'Reports',
      'Competitors',
    ]);
    const tabs = [...container.querySelectorAll('#submenu--dashboard-action-center a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(tabs).toEqual([
      '/dashboard/action-center/today',
      '/dashboard/action-center/actions',
      '/dashboard/action-center/signals',
      '/dashboard/agents',
      '/dashboard/action-center/history',
    ]);
    // Agent Center is no item of its own: Agents, under the Action Center.
    expect(container.textContent).not.toContain('Agent Center');
    expect(container.querySelectorAll('a[href="/dashboard/agents"]')).toHaveLength(1);
  });

  it('keeps Ads last in ANALYTICS, with its New pill, only with Ads on', async () => {
    await render({ ads: true });
    const all = rows();
    expect(all.indexOf('Ads')).toBe(all.indexOf('AI Referral Traffic') + 1);
    expect(all.indexOf('# More')).toBe(all.indexOf('Ads') + 1);
    expect(link('/dashboard/ads')?.querySelector('[data-slot="new-pill"]')?.textContent).toBe(
      'New',
    );
    await render({ ads: false });
    expect(link('/dashboard/ads')).toBeNull();
  });

  it('leaves Agents out without the new Chat; the Action Center stays', async () => {
    await render({ chatAgentic: false });
    expect(link('/dashboard/agents')).toBeNull();
    expect(rows().slice(0, 6)).toEqual([
      'Chat',
      'Action Center',
      '  Today',
      '  Actions',
      '  Signals',
      '  History',
    ]);
  });

  it('leaves Agents out when its section is off the menu, and counts it there', async () => {
    await render({ hidden: ['agents'] });
    expect(link('/dashboard/agents')).toBeNull();
    expect(link('/dashboard/action-center/today')).not.toBeNull();
    expect(container.textContent).toContain('1 section off your menu.');
  });

  it('never takes the Action Center off a menu, and drops a group all off it', async () => {
    await render({ hidden: ['content', 'audit', 'reports', 'competitors'] });
    expect(groupHeader('More')).toBeNull();
    expect(parent('/dashboard/action-center')).not.toBeNull();
    expect(container.textContent).toContain('4 sections off your menu.');
  });

  it('hides Agents on a plan without agents, and locks Chat with its crown as before', async () => {
    gate.isCloud = true;
    gate.features = ['basic_insights', 'content_optimization', 'competitor_tracking'];
    await render();
    expect(link('/dashboard/agents')).toBeNull();
    expect(link('/dashboard/chat')).toBeNull();
    // Locked items show the plan they need; AI Referral Traffic needs one too.
    expect(container.textContent).toContain('ChatGrowth');
    expect(container.textContent).toContain('AI Referral TrafficGrowth');
    expect(link('/dashboard/action-center/today')).not.toBeNull();
  });

  it('marks the tab of the page shown, Agents on its pages too, History on KPIs', async () => {
    nav.pathname = '/dashboard/agents/new';
    await render();
    expect(link('/dashboard/agents')?.getAttribute('aria-current')).toBe('page');
    expect(parent('/dashboard/action-center')?.className).toContain('text-primary');
    nav.pathname = '/dashboard/action-center/today';
    await render();
    expect(link('/dashboard/action-center/today')?.getAttribute('aria-current')).toBe('page');
    expect(link('/dashboard/agents')?.getAttribute('aria-current')).toBeNull();
    // KPIs, one of History's views: History is current, as its tab is.
    nav.pathname = '/dashboard/action-center/kpis';
    await render();
    expect(link('/dashboard/action-center/history')?.getAttribute('aria-current')).toBe('page');
    expect(
      [...container.querySelectorAll('[aria-current="page"]')].map((a) => a.getAttribute('href')),
    ).toEqual(['/dashboard/action-center/history']);
  });

  it('shows the tracked prompts’ count beside Tracked Prompts', async () => {
    await render();
    expect(getTrackedPromptCount).toHaveBeenCalledWith('brand-1');
    expect(link('/dashboard/prompts/tracked')?.textContent).toBe('Tracked Prompts12');
  });

  it('folds the Action Center like any submenu, remembered in this browser', async () => {
    await render();
    const ac = parent('/dashboard/action-center')!;
    expect(ac.getAttribute('aria-expanded')).toBe('true');
    await act(async () => ac.click());
    expect(ac.getAttribute('aria-expanded')).toBe('false');
    expect(link('/dashboard/action-center/today')).toBeNull();
    expect(stored.get('ansvisor.sidebar.action-centerOpen')).toBe('0');

    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(parent('/dashboard/action-center')?.getAttribute('aria-expanded')).toBe('false');
    // It opens when one of its pages shows.
    act(() => root.unmount());
    root = createRoot(container);
    nav.pathname = '/dashboard/action-center/signals';
    await render();
    expect(parent('/dashboard/action-center')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('folds MORE under its title, open by default and remembered', async () => {
    await render();
    expect(groupHeader('More')?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => groupHeader('More')!.click());
    expect(groupHeader('More')?.getAttribute('aria-expanded')).toBe('false');
    expect(link('/dashboard/audit')).toBeNull();
    expect(stored.get('ansvisor.sidebar.group.moreOpen')).toBe('0');
    // Analytics keeps its own.
    expect(groupHeader('Analytics')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the folds already stored for Prompts and Analytics', async () => {
    stored.set('ansvisor.sidebar.promptsOpen', '0');
    stored.set('ansvisor.sidebar.group.analyticsOpen', '0');
    nav.pathname = '/dashboard/action-center/today';
    await render();
    expect(groupHeader('Analytics')?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => groupHeader('Analytics')!.click());
    expect(parent('/dashboard/prompts')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens and closes the Action Center with the arrow keys', async () => {
    await render();
    const ac = parent('/dashboard/action-center')!;
    ac.focus();
    await act(async () => {
      ac.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(ac.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      ac.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(ac.getAttribute('aria-expanded')).toBe('true');
    // Down from it goes into its tabs.
    await act(async () => {
      ac.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.getAttribute('href')).toBe('/dashboard/action-center/today');
  });

  it('collapses to icons, the Action Center one link to its first tab, and opens on hover', async () => {
    vi.useFakeTimers();
    useSidebarStore.setState({ isCollapsed: true });
    await render();
    const aside = container.querySelector('aside')!;
    expect(aside.className).toContain('w-16');
    expect(groupHeader('More')).toBeNull();
    const ac = link('/dashboard/action-center')!;
    expect(ac.querySelector('[title="Action Center"]')).not.toBeNull();
    expect(link('/dashboard/action-center/today')).toBeNull();

    await act(async () => {
      aside.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(aside.className).toContain('w-60');
    expect(link('/dashboard/action-center/today')).not.toBeNull();
  });

  it('is pinned open or closed with the button at its foot, as before', async () => {
    await render();
    const pin = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse sidebar"]',
    )!;
    await act(async () => pin.click());
    expect(useSidebarStore.getState().isCollapsed).toBe(true);
    expect(container.querySelector('aside')?.className).toContain('w-16');
  });
});

describe('the mobile menu with SIMPLE_NAV', () => {
  it('lists the same menu, the Action Center’s tabs under it', async () => {
    await render({ mobile: true });
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle navigation menu"]',
    )!;
    await act(async () => trigger.click());
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    const at = (href: string) => hrefs.indexOf(href);
    expect(at('/dashboard/chat')).toBeGreaterThan(-1);
    expect(at('/dashboard/action-center')).toBe(at('/dashboard/chat') + 1);
    expect(
      hrefs.slice(at('/dashboard/action-center') + 1, at('/dashboard/action-center') + 6),
    ).toEqual([
      '/dashboard/action-center/today',
      '/dashboard/action-center/actions',
      '/dashboard/action-center/signals',
      '/dashboard/agents',
      '/dashboard/action-center/history',
    ]);
    expect(at('/dashboard/prompts')).toBeLessThan(at('/dashboard/insights'));
    expect(at('/dashboard/traffic')).toBeLessThan(at('/dashboard/content'));
    expect(at('/dashboard/reports')).toBeLessThan(at('/dashboard/competitors'));
    expect(document.body.textContent).not.toContain('Agent Center');
  });

  it('is as it was without it', async () => {
    await render({ mobile: true, simpleNav: false });
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle navigation menu"]',
    )!;
    await act(async () => trigger.click());
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.indexOf('/dashboard/agents')).toBe(hrefs.indexOf('/dashboard/chat') + 1);
    expect(hrefs).not.toContain('/dashboard/action-center/today');
    expect(hrefs.indexOf('/dashboard/insights')).toBeLessThan(hrefs.indexOf('/dashboard/prompts'));
  });
});
