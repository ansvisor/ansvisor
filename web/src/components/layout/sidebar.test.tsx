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
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard/action-center',
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
const { useSidebarStore } = await import('@/stores/use-sidebar-store');
const { useBrandStore } = await import('@/stores/use-brand-store');
const { MenuAccessProvider } = await import('@/components/providers/menu-access-provider');

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

  it('leaves the viewer’s hidden sections off', async () => {
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
});
