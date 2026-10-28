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
vi.mock('@/lib/actions/prompt', () => ({ getTrackedPromptCount: async () => 0 }));
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

  it('says nothing when the whole menu shows', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Sidebar />
        </NextIntlClientProvider>,
      );
    });
    expect(container.textContent).not.toContain('off your menu');
  });
});
