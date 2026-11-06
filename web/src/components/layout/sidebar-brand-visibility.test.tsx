import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * The left menu's Brand Visibility group (the owner's mockup), on the real
 * menu: Overview, Mentions and Citations under it, like Prompts and
 * Content, open whenever one of them shows, and its entries keep the
 * filters the tabs share.
 */

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span data-image={alt} />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
const nav = vi.hoisted(() => ({ pathname: '/dashboard/action-center', push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/actions/prompt', () => ({ getTrackedPromptCount: vi.fn(async () => 0) }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({ canUse: () => true, requiredPlanFor: () => null, isCloud: false }),
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
const { useSidebarStore } = await import('@/stores/use-sidebar-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render(path: string, hidden: string[] = []) {
  const [pathname] = path.split('?');
  nav.pathname = pathname;
  window.history.replaceState(null, '', path);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <MenuAccessProvider hidden={hidden} canManageMenus={false}>
          <Sidebar />
        </MenuAccessProvider>
      </NextIntlClientProvider>,
    );
  });
}

const group = () =>
  container.querySelector<HTMLButtonElement>('button[data-submenu="/dashboard/insights"]')!;
const entries = () =>
  [...container.querySelectorAll<HTMLAnchorElement>('#submenu--dashboard-insights a')].map((a) => ({
    label: a.textContent,
    href: a.getAttribute('href'),
    current: a.getAttribute('aria-current'),
  }));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useSidebarStore.setState({ isCollapsed: false });
  stored.clear();
  nav.push.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

describe('the Visibility group', () => {
  it('lists Overview, Mentions and Citations under it, with no Mentions or Citations items of their own', async () => {
    await render('/dashboard/action-center');
    expect(group().textContent).toBe('Visibility');
    expect(entries()).toEqual([
      { label: 'Overview', href: '/dashboard/insights', current: null },
      { label: 'Mentions', href: '/dashboard/mentions', current: null },
      { label: 'Citations', href: '/dashboard/citations', current: null },
    ]);
    // Each page is linked once: from the group, not from items of its own.
    expect(container.querySelectorAll('a[href="/dashboard/mentions"]')).toHaveLength(1);
    expect(container.querySelectorAll('a[href="/dashboard/citations"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-nav-item="link"][href="/dashboard/insights"]'),
    ).toBeNull();
  });

  it('marks the group and the tab shown as current, on each tab', async () => {
    for (const [path, label] of [
      ['/dashboard/insights', 'Overview'],
      ['/dashboard/mentions', 'Mentions'],
      ['/dashboard/citations', 'Citations'],
    ] as const) {
      await render(path);
      expect(group().className, path).toContain('text-primary');
      expect(
        entries()
          .filter((e) => e.current === 'page')
          .map((e) => e.label),
      ).toEqual([label]);
    }
  });

  it('opens by default when its page shows, though it was closed in this browser', async () => {
    stored.set('ansvisor.sidebar.insightsOpen', '0');
    stored.set('ansvisor.sidebar.group.analyticsOpen', '0');
    await render('/dashboard/action-center');
    expect(
      container.querySelector('button[data-nav-group="Analytics"]')!.getAttribute('aria-expanded'),
    ).toBe('false');

    act(() => root.unmount());
    root = createRoot(container);
    await render('/dashboard/citations');
    expect(group().getAttribute('aria-expanded')).toBe('true');
    expect(entries().map((e) => e.label)).toEqual(['Overview', 'Mentions', 'Citations']);
  });

  it('folds and unfolds like Prompts and Content, remembered in this browser', async () => {
    await render('/dashboard/action-center');
    expect(group().getAttribute('aria-expanded')).toBe('true');
    await act(async () => group().click());
    expect(group().getAttribute('aria-expanded')).toBe('false');
    expect(entries()).toEqual([]);
    expect(stored.get('ansvisor.sidebar.insightsOpen')).toBe('0');
  });

  it('keeps the tabs’ shared filters on its entries, from a Brand Visibility tab', async () => {
    await render(
      '/dashboard/insights?range=7d&model=chatgpt-web%2Cgpt-5-chat-latest&topic=t1&region=us',
    );
    expect(entries().map((e) => e.href)).toEqual([
      '/dashboard/insights?range=7d&model=chatgpt-web%2Cgpt-5-chat-latest&topic=t1&region=us',
      '/dashboard/mentions?range=7d&platform=chatgpt-web&region=us&topic=t1',
      '/dashboard/citations?preset=7d&platform=chatgpt-web%2Cgpt-5-chat-latest&region=us&topic=t1',
    ]);
  });

  it('shows the tabs the viewer’s menu keeps (menu access), and goes with all three off', async () => {
    await render('/dashboard/action-center', ['insights', 'mentions']);
    expect(entries().map((e) => e.label)).toEqual(['Citations']);

    await render('/dashboard/action-center', ['insights', 'mentions', 'citations']);
    expect(group()).toBeNull();
  });
});

describe('the mobile menu', () => {
  it('lists Brand Visibility’s tabs under it, keeping the shared filters', async () => {
    nav.pathname = '/dashboard/mentions';
    window.history.replaceState(null, '', '/dashboard/mentions?range=7d&topic=t1');
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <MenuAccessProvider hidden={[]} canManageMenus={false}>
            <MobileNav />
          </MenuAccessProvider>
        </NextIntlClientProvider>,
      );
    });
    const toggle = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle navigation menu"]',
    )!;
    await act(async () => toggle.click());
    const hrefs = [...document.querySelectorAll<HTMLAnchorElement>('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/dashboard/insights?range=7d&topic=t1');
    expect(hrefs).toContain('/dashboard/mentions?range=7d&topic=t1');
    expect(hrefs).toContain('/dashboard/citations?preset=7d&topic=t1');
    // No Mentions or Citations items of their own.
    expect(hrefs.filter((href) => href?.startsWith('/dashboard/mentions'))).toHaveLength(1);
    act(() => root.unmount());
    root = createRoot(container);
    document.body.innerHTML = '';
    document.body.appendChild(container);
  });
});
