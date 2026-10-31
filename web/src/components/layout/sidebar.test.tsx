import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span data-image={alt} />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
const nav = vi.hoisted(() => ({ pathname: '/dashboard/action-center' }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const getTrackedPromptCount = vi.hoisted(() => vi.fn(async () => 0));
vi.mock('@/lib/actions/prompt', () => ({ getTrackedPromptCount }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({ canUse: () => true, requiredPlanFor: () => null, isCloud: false }),
}));
vi.mock('@/hooks/use-agent-key-status', () => ({ useAgentKeyStatus: () => 'configured' }));
const saveChatRailOpen = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/lib/actions/chat-prefs', () => ({ saveChatRailOpen }));
vi.mock('@/components/layout/brand-switcher', () => ({ BrandSwitcher: () => null }));
vi.mock('@/components/layout/user-profile-nav-item', () => ({ UserProfileNavItem: () => null }));
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => null }));
// A menu of its own, so the test pins how the sidebar shows a badge, not
// which items the product marks new today.
vi.mock('@/config/dashboard', () => {
  const Icon = () => <svg />;
  return {
    dashboardNav: [
      {
        title: 'Execution',
        items: [
          { title: 'Action Center', href: '/dashboard/action-center', icon: Icon, badge: 'New' },
          {
            title: 'Content',
            href: '/dashboard/content',
            icon: Icon,
            badge: 'New',
            children: [
              { title: 'Opportunities', href: '/dashboard/content' },
              { title: 'Plan', href: '/dashboard/content/plan' },
            ],
          },
        ],
      },
      {
        title: 'Analytics',
        items: [
          {
            title: 'Prompts',
            href: '/dashboard/prompts',
            icon: Icon,
            children: [{ title: 'Tracked Prompts', href: '/dashboard/prompts/tracked' }],
          },
          { title: 'Mentions', href: '/dashboard/mentions', icon: Icon },
        ],
      },
    ],
  };
});

// The sidebar's store keeps its state in localStorage, which this jsdom lacks.
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

const { Sidebar } = await import('./sidebar');
const { MenuAccessProvider } = await import('@/components/providers/menu-access-provider');
const { useSidebarStore } = await import('@/stores/use-sidebar-store');
const { useChatRailStore } = await import('@/stores/use-chat-rail-store');
const { ChatAgenticProvider } = await import('@/components/providers/chat-agentic-provider');
const { useBrandStore } = await import('@/stores/use-brand-store');

/** The dashboard sidebar, expanded (it opens collapsed). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom has none: the sidebar scrolls the current item into view.
  Element.prototype.scrollIntoView = vi.fn();
  // Expanded: a collapsed sidebar shows icons alone.
  useSidebarStore.setState({ isCollapsed: false });
  useBrandStore.setState({ activeBrandId: null });
  useChatRailStore.setState({ open: false });
  nav.pathname = '/dashboard/action-center';
  saveChatRailOpen.mockClear();
  getTrackedPromptCount.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Sidebar', () => {
  it('marks a submenu’s parent new, as a plain item, inside its button (#1603)', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Sidebar />
        </NextIntlClientProvider>,
      );
    });
    const content = container.querySelector('button[data-submenu="/dashboard/content"]');
    expect(content).not.toBeNull();
    expect(content!.querySelector('[data-slot="badge"]')?.textContent).toBe('New');
    // A plain item keeps its own.
    const actions = container.querySelector('a[href="/dashboard/action-center"]');
    expect(actions!.querySelector('[data-slot="badge"]')?.textContent).toBe('New');
  });

  it('leaves the viewer’s hidden sections off, and says where to change it', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <MenuAccessProvider hidden={['content']} canManageMenus={false}>
            <Sidebar />
          </MenuAccessProvider>
        </NextIntlClientProvider>,
      );
    });
    expect(container.querySelector('[data-submenu="/dashboard/content"]')).toBeNull();
    expect(container.querySelector('a[href="/dashboard/action-center"]')).not.toBeNull();
    expect(container.textContent).toContain('1 section off your menu. Change');
    expect(container.querySelector('a[href="/dashboard/settings/account"]')?.textContent).toBe(
      'Change',
    );
  });

  it('drops a group whose sections are all off the menu, title and all', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <MenuAccessProvider hidden={['prompts', 'mentions']} canManageMenus={false}>
            <Sidebar />
          </MenuAccessProvider>
        </NextIntlClientProvider>,
      );
    });
    expect(container.textContent).toContain('Execution');
    expect(container.textContent).not.toContain('Analytics');
    expect(container.querySelector('a[href="/dashboard/mentions"]')).toBeNull();
  });

  it('shows the whole menu without a menu to go by', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Sidebar />
        </NextIntlClientProvider>,
      );
    });
    expect(container.querySelector('[data-submenu="/dashboard/content"]')).not.toBeNull();
    expect(container.querySelector('a[href="/dashboard/mentions"]')).not.toBeNull();
    expect(container.textContent).not.toContain('off your menu');
  });

  it('reads the tracked prompts’ count only while Prompts is on the menu', async () => {
    useBrandStore.setState({ activeBrandId: 'brand-1' });
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <MenuAccessProvider hidden={['prompts']} canManageMenus={false}>
            <Sidebar />
          </MenuAccessProvider>
        </NextIntlClientProvider>,
      );
    });
    expect(getTrackedPromptCount).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Sidebar />
        </NextIntlClientProvider>,
      );
    });
    expect(getTrackedPromptCount).toHaveBeenCalledWith('brand-1');
  });

  it("is the rail on Chat's screens until the logo expands it, kept on the person; elsewhere as pinned", async () => {
    nav.pathname = '/dashboard/chat/all';
    const render = async (chatOn: boolean) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <ChatAgenticProvider enabled={chatOn}>
              <Sidebar />
            </ChatAgenticProvider>
          </NextIntlClientProvider>,
        );
      });
    // Pinned open elsewhere (beforeEach), the rail here.
    await render(true);
    const logo = container.querySelector<HTMLButtonElement>('[data-action="rail.toggle"]')!;
    expect(logo.getAttribute('aria-expanded')).toBe('false');
    expect(logo.getAttribute('aria-label')).toBe('Expand the Ansvisor menu');
    expect(container.querySelector('aside')?.className).toContain('w-16');

    await act(async () => logo.click());
    expect(saveChatRailOpen).toHaveBeenCalledWith(true);
    expect(useChatRailStore.getState().open).toBe(true);
    expect(logo.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('aside')?.className).toContain('w-60');
    // The pinned state elsewhere is untouched.
    expect(useSidebarStore.getState().isCollapsed).toBe(false);

    await act(async () => logo.click());
    expect(saveChatRailOpen).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('aside')?.className).toContain('w-16');

    // With the new Chat off, the logo goes home as before.
    await render(false);
    expect(container.querySelector('[data-action="rail.toggle"]')).toBeNull();
    expect(container.querySelector('a[href="/dashboard"]')).not.toBeNull();
  });
  describe('a titled group', () => {
    const renderSidebar = () =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <Sidebar />
          </NextIntlClientProvider>,
        );
      });
    const header = (title: string) =>
      container.querySelector<HTMLButtonElement>(`button[data-nav-group="${title}"]`)!;
    afterEach(() => {
      stored.delete('ansvisor.sidebar.group.analyticsOpen');
    });

    it('folds under its title with the chevron, and is remembered in this browser', async () => {
      await renderSidebar();
      expect(header('Analytics').getAttribute('aria-expanded')).toBe('true');
      expect(container.querySelector('a[href="/dashboard/mentions"]')).not.toBeNull();

      await act(async () => header('Analytics').click());
      expect(header('Analytics').getAttribute('aria-expanded')).toBe('false');
      expect(container.querySelector('a[href="/dashboard/mentions"]')).toBeNull();
      expect(stored.get('ansvisor.sidebar.group.analyticsOpen')).toBe('0');
      // The other group stays open.
      expect(container.querySelector('a[href="/dashboard/action-center"]')).not.toBeNull();
    });

    it('comes back folded, and opens when one of its pages shows', async () => {
      stored.set('ansvisor.sidebar.group.analyticsOpen', '0');
      await renderSidebar();
      expect(header('Analytics').getAttribute('aria-expanded')).toBe('false');

      act(() => root.unmount());
      root = createRoot(container);
      nav.pathname = '/dashboard/mentions';
      await renderSidebar();
      expect(header('Analytics').getAttribute('aria-expanded')).toBe('true');
      expect(container.querySelector('a[href="/dashboard/mentions"]')).not.toBeNull();
    });

    it('shows every item as icons alone, where there are no titles to fold', async () => {
      stored.set('ansvisor.sidebar.group.analyticsOpen', '0');
      useSidebarStore.setState({ isCollapsed: true });
      await renderSidebar();
      expect(container.querySelector('button[data-nav-group]')).toBeNull();
      expect(container.querySelector('a[href="/dashboard/mentions"]')).not.toBeNull();
    });
  });
});
