import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * Brand Visibility's shared layout (the owner's mockup): the header, the run
 * line and the three tabs, which show at once and stay while the tab under
 * them changes; the tabs keep the filters they share, and what they read,
 * and the other tabs are prefetched once the open one is on screen.
 */

const nav = vi.hoisted(() => ({
  pathname: '/dashboard/insights',
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
  Link: ({
    href,
    children,
    prefetch,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    prefetch?: boolean | null;
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ refresh: nav.refresh }),
}));
const tracking = vi.hoisted(() => ({
  getTrackingWindow: vi.fn(),
  getJobStatus: vi.fn(),
  triggerTrackingCheck: vi.fn(),
  cancelTrackingJob: vi.fn(),
  getBrandPrompts: vi.fn(async () => []),
}));
vi.mock('@/lib/actions/tracking', () => tracking);
// The run line's read goes through the tabs' read route, beside theirs.
vi.mock('@/lib/visibility-reads', () => ({ getTrackingWindow: tracking.getTrackingWindow }));
const access = vi.hoisted(() => ({ isCloud: false, canManage: true, planId: 'starter' }));
vi.mock('@/components/providers/plan-provider', () => ({
  usePlanContext: () => ({ isCloud: access.isCloud, planId: access.planId }),
}));
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ canManage: access.canManage }),
}));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({ guard: (fn: () => unknown) => fn }),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The brand store keeps its state in localStorage, which this jsdom lacks.
vi.hoisted(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, String(value)),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
});

const { BrandVisibilityShellView } = await import('./shell');
const { TabHeaderActions, useBrandRead, useBrandVisibilityShell } = await import('./shell-context');
const { TabError } = await import('./tab-error');
const { CitationsSkeleton, MentionsSkeleton, OverviewSkeleton } = await import('./tab-skeleton');
const { useBrandStore } = await import('@/stores/use-brand-store');
const { MenuAccessProvider } = await import('@/components/providers/menu-access-provider');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const brand = {
  id: 'b1',
  name: 'Brewline Coffee',
  slug: 'brewline',
  domains: [],
  // The demo brand: its pages read its sample data like any brand's.
  isDemo: true,
};

const window1 = {
  anchored: null,
  activeRun: null,
  lastRunAt: new Date(Date.now() - 11 * 3600_000).toISOString(),
  nextRunAt: new Date(Date.now() + 13 * 3600_000).toISOString(),
};

/** A tab: it says when its figures are on screen, as the tabs do. */
function Tab({ label = 'TAB CONTENT', drawn = true }: { label?: string; drawn?: boolean }) {
  const { shown } = useBrandVisibilityShell();
  useEffect(() => {
    if (drawn) shown();
  }, [drawn, shown]);
  return (
    <>
      <TabHeaderActions>
        <button type="button">Export CSV</button>
      </TabHeaderActions>
      <p>{label}</p>
    </>
  );
}

async function render(path: string, tab: React.ReactNode = <Tab />, hidden: string[] = []) {
  const [pathname] = path.split('?');
  nav.pathname = pathname;
  window.history.replaceState(null, '', path);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <MenuAccessProvider hidden={hidden} canManageMenus={false}>
          <BrandVisibilityShellView>{tab}</BrandVisibilityShellView>
        </MenuAccessProvider>
      </NextIntlClientProvider>,
    );
  });
}

const tabLink = (name: string) =>
  [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Visibility"] a')].find(
    (a) => a.textContent === name,
  )!;

beforeEach(() => {
  vi.useFakeTimers();
  tracking.getTrackingWindow.mockReset().mockResolvedValue(window1);
  nav.push.mockReset();
  nav.refresh.mockReset();
  access.isCloud = false;
  access.canManage = true;
  access.planId = 'starter';
  useBrandStore.setState({ brands: [brand as never], activeBrandId: 'b1', loaded: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
});

describe('Visibility’s header and tabs', () => {
  it('show at once, named Visibility, with the three tabs and the current one marked', async () => {
    tracking.getTrackingWindow.mockReturnValue(new Promise(() => {}));
    await render('/dashboard/mentions');
    expect(container.querySelector('h1')?.textContent).toBe('Visibility');
    expect(
      [...container.querySelectorAll('nav[aria-label="Visibility"] a')].map((a) => [
        a.textContent,
        a.getAttribute('aria-current'),
      ]),
    ).toEqual([
      ['Overview', null],
      ['Mentions', 'page'],
      ['Citations', null],
    ]);
    // The tab is drawn under them while the run line's times are still on their way.
    expect(container.textContent).toContain('TAB CONTENT');
    expect(container.textContent).toContain('Brewline Coffee');
    expect(container.querySelector('[data-testid="run-line-loading"]')).not.toBeNull();
    // The skeleton is a div: no p may hold it (a hydration error in the browser).
    expect(container.querySelector('p [data-testid="run-line-loading"]')).toBeNull();
    expect(container.textContent).not.toContain('Answer Engine Insights');
    expect(container.textContent).not.toContain('Brand Visibility');
  });

  it('leave off a tab whose section the person’s menu hides, as the menu does', async () => {
    await render('/dashboard/mentions', <Tab />, ['citations']);
    expect(
      [...container.querySelectorAll('nav[aria-label="Visibility"] a')].map((a) => a.textContent),
    ).toEqual(['Overview', 'Mentions']);
    await render('/dashboard/mentions', <Tab />, ['insights']);
    expect(
      [...container.querySelectorAll('nav[aria-label="Visibility"] a')].map((a) => a.textContent),
    ).toEqual(['Mentions', 'Citations']);
  });

  it('read the run line at once, beside the tab’s reads, and fill it in', async () => {
    await render('/dashboard/insights', <Tab drawn={false} />);
    // Not after the tab's reads: they are fetches, which run side by side.
    expect(tracking.getTrackingWindow).toHaveBeenCalledTimes(1);
    expect(tracking.getTrackingWindow).toHaveBeenCalledWith('b1');
    expect(container.textContent).toContain('Last run');
    expect(container.querySelector('[data-testid="run-line-loading"]')).toBeNull();
  });

  it('put the tab’s own actions in the header, beside Reports', async () => {
    await render('/dashboard/citations');
    const slot = container.querySelector('[data-testid="tab-actions"]')!;
    expect(slot.textContent).toBe('Export CSV');
    expect(container.querySelector('a[href="/dashboard/reports"]')?.textContent).toBe('Reports');
    // The run buttons: admins and managers on a self-hosted install.
    expect(container.textContent).toContain('Run All');
    expect(container.textContent).toContain('Test Single Prompt');
  });

  it('leave Run All to self-hosted installs', async () => {
    access.isCloud = true;
    await render('/dashboard/insights');
    expect(container.textContent).not.toContain('Run All');
    expect(container.textContent).not.toContain('Test Single Prompt');
  });
});

describe('the old addresses', () => {
  it('open their tab, and keep their query as it is', async () => {
    for (const [path, tab] of [
      ['/dashboard/insights?range=7d&model=chatgpt-web', 'Overview'],
      ['/dashboard/mentions?tab=perception&range=90d&platform=claude&q=latte', 'Mentions'],
      ['/dashboard/citations?preset=all&platform=perplexity-web&scope=all', 'Citations'],
    ] as const) {
      await render(path);
      expect(tabLink(tab).getAttribute('aria-current'), path).toBe('page');
      expect(`${window.location.pathname}${window.location.search}`).toBe(path);
    }
  });
});

describe('Product Visibility, the fourth tab', () => {
  const tabs = () =>
    [...container.querySelectorAll('nav[aria-label="Visibility"] a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
      a.getAttribute('aria-current'),
    ]);
  const withBrand = async (
    brandFields: object,
    planId = 'growth',
    path = '/dashboard/insights',
    hidden: string[] = [],
  ) => {
    access.planId = planId;
    useBrandStore.setState({
      brands: [{ ...brand, ...brandFields } as never],
      activeBrandId: 'b1',
      loaded: true,
    });
    await render(path, <Tab />, hidden);
  };

  it('shows for a brand in Shopping mode on a plan with it, on its old address', async () => {
    await withBrand({ shoppingModeEnabled: true });
    expect(tabs()).toEqual([
      ['Overview', '/dashboard/insights', 'page'],
      ['Mentions', '/dashboard/mentions', null],
      ['Citations', '/dashboard/citations', null],
      ['Product Visibility', '/dashboard/shopping', null],
    ]);
  });

  it('shows for an e-commerce brand whose Shopping mode is still off', async () => {
    await withBrand({ shoppingModeEnabled: false, siteType: 'ecommerce' });
    expect(tabs().map(([name]) => name)).toContain('Product Visibility');
  });

  it('is not there when the member’s menu hides Product Visibility', async () => {
    await withBrand({ shoppingModeEnabled: true }, 'growth', '/dashboard/insights', ['shopping']);
    expect(tabs().map(([name]) => name)).toEqual(['Overview', 'Mentions', 'Citations']);
  });

  it('is not there for another brand, or on a plan without it', async () => {
    await withBrand({ shoppingModeEnabled: false, siteType: 'b2b' });
    expect(tabs().map(([name]) => name)).toEqual(['Overview', 'Mentions', 'Citations']);
    await withBrand({ shoppingModeEnabled: true }, 'starter');
    expect(tabs().map(([name]) => name)).toEqual(['Overview', 'Mentions', 'Citations']);
  });

  it('is the current tab on its address, keeps its view, and carries no filter to the others', async () => {
    await withBrand({ shoppingModeEnabled: true }, 'growth', '/dashboard/shopping?tab=readiness');
    expect(tabs()).toEqual([
      ['Overview', '/dashboard/insights', null],
      ['Mentions', '/dashboard/mentions', null],
      ['Citations', '/dashboard/citations', null],
      ['Product Visibility', '/dashboard/shopping?tab=readiness', 'page'],
    ]);
  });
});

describe('switching tabs', () => {
  it('keeps the date range, engine, country and topic', async () => {
    await render('/dashboard/insights?range=7d&model=chatgpt-web%2Cgpt-5-chat-latest&topic=t1');
    expect(tabLink('Mentions').getAttribute('href')).toBe(
      '/dashboard/mentions?range=7d&platform=chatgpt-web&topic=t1',
    );
    expect(tabLink('Citations').getAttribute('href')).toBe(
      '/dashboard/citations?preset=7d&platform=chatgpt-web%2Cgpt-5-chat-latest&topic=t1',
    );
  });

  it('follows the filters the tab changed since, which it keeps in the address', async () => {
    await render('/dashboard/mentions');
    // Nothing picked yet: Citations opens on its own default.
    expect(tabLink('Citations').getAttribute('href')).toBe('/dashboard/citations');
    // The tab writes its filters without telling the router (url-state.ts).
    window.history.replaceState(null, '', '/dashboard/mentions?range=90d&platform=claude&topic=t2');
    act(() => {
      tabLink('Citations').click();
    });
    expect(nav.push).toHaveBeenCalledWith(
      '/dashboard/citations?preset=90d&platform=claude&topic=t2',
    );

    // Pointed at or focused, the link itself is up to date too.
    await act(async () => {
      tabLink('Overview').focus();
    });
    expect(tabLink('Overview').getAttribute('href')).toBe(
      '/dashboard/insights?range=90d&model=claude&topic=t2',
    );
  });
});

describe('the other tabs', () => {
  const prefetchOf = (name: string) => tabLink(name).getAttribute('data-prefetch');

  it('are prefetched once the open tab’s figures are on screen, not before', async () => {
    await render('/dashboard/mentions', <Tab drawn={false} />);
    expect([prefetchOf('Overview'), prefetchOf('Mentions'), prefetchOf('Citations')]).toEqual([
      'false',
      'false',
      'false',
    ]);

    await render('/dashboard/mentions', <Tab />);
    // The open tab is already here.
    expect([prefetchOf('Overview'), prefetchOf('Mentions'), prefetchOf('Citations')]).toEqual([
      'true',
      'false',
      'true',
    ]);
  });
});

describe('what a tab read', () => {
  /** A tab showing a read it keeps for the brand. */
  function Reading({ read }: { read: (brandId: string) => Promise<string> }) {
    const value = useBrandRead('topics', 'b1', read);
    return <p data-testid="kept">{value ?? 'LOADING'}</p>;
  }
  const kept = () => container.querySelector('[data-testid="kept"]')?.textContent;

  it('shows at once when the tab is opened again, and is read again quietly', async () => {
    const first = vi.fn(async () => 'Espresso, Filter');
    await render('/dashboard/insights', <Reading read={first} />);
    expect(kept()).toBe('Espresso, Filter');

    // Another tab, then back: the layout stayed, and so did what was read.
    await render('/dashboard/mentions', <Tab />);
    let answer: (value: string) => void = () => {};
    const again = vi.fn(() => new Promise<string>((resolve) => (answer = resolve)));
    await render('/dashboard/insights', <Reading read={again} />);
    expect(kept()).toBe('Espresso, Filter');
    expect(again).toHaveBeenCalledWith('b1');

    await act(async () => answer('Espresso, Filter, Cold brew'));
    expect(kept()).toBe('Espresso, Filter, Cold brew');
  });

  it('keeps what was read when the read again fails', async () => {
    await render('/dashboard/insights', <Reading read={async () => 'Espresso'} />);
    await render('/dashboard/mentions', <Tab />);
    await render(
      '/dashboard/insights',
      <Reading read={() => Promise.reject(new Error('offline'))} />,
    );
    expect(kept()).toBe('Espresso');
  });
});

describe('a tab that breaks', () => {
  it('says so with Retry, under the header and tabs that stay', async () => {
    const reset = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await render(
      '/dashboard/mentions',
      <TabError error={new Error('boom')} reset={reset} title="Couldn't load the mentions" />,
    );
    expect(container.querySelector('h1')?.textContent).toBe('Visibility');
    expect(tabLink('Overview')).toBeDefined();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't load the mentions",
    );
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!;
    await act(async () => retry.click());
    expect(reset).toHaveBeenCalledTimes(1);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('the tabs’ skeletons', () => {
  it('say they are loading, shaped like each tab, and never say there is no data', async () => {
    for (const [Skeleton, id] of [
      [OverviewSkeleton, 'overview-skeleton'],
      [MentionsSkeleton, 'mentions-skeleton'],
      [CitationsSkeleton, 'citations-skeleton'],
    ] as const) {
      await render('/dashboard/insights', <Skeleton />);
      const shown = container.querySelector(`[data-testid="${id}"]`)!;
      expect(shown.getAttribute('role')).toBe('status');
      expect(shown.getAttribute('aria-busy')).toBe('true');
      expect(shown.textContent).toBe('Loading…');
      expect(container.textContent).not.toMatch(/No (tracking )?data|No results|No citations/);
    }
  });
});
