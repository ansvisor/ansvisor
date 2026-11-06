import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * Brand Visibility's shared layout (the owner's mockup): the header, the run
 * line and the three tabs, which show at once and stay while the tab under
 * them changes; the tabs keep the filters they share.
 */

const nav = vi.hoisted(() => ({
  pathname: '/dashboard/insights',
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
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
const access = vi.hoisted(() => ({ isCloud: false, canManage: true }));
vi.mock('@/components/providers/plan-provider', () => ({
  usePlanContext: () => ({ isCloud: access.isCloud }),
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

const { BrandVisibilityShellView, RUN_LINE_WAIT_MS } = await import('./shell');
const { TabHeaderActions, useBrandVisibilityShell } = await import('./shell-context');
const { TabError } = await import('./tab-error');
const { CitationsSkeleton, MentionsSkeleton, OverviewSkeleton } = await import('./tab-skeleton');
const { useBrandStore } = await import('@/stores/use-brand-store');

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

/** A tab: its first read goes out on opening, as the tabs' do. */
function Tab({ label = 'TAB CONTENT', read = true }: { label?: string; read?: boolean }) {
  const { readSent } = useBrandVisibilityShell();
  useEffect(() => {
    if (read) readSent();
  }, [read, readSent]);
  return (
    <>
      <TabHeaderActions>
        <button type="button">Export CSV</button>
      </TabHeaderActions>
      <p>{label}</p>
    </>
  );
}

async function render(path: string, tab: React.ReactNode = <Tab />) {
  const [pathname] = path.split('?');
  nav.pathname = pathname;
  window.history.replaceState(null, '', path);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <BrandVisibilityShellView>{tab}</BrandVisibilityShellView>
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
    expect(container.textContent).not.toContain('Answer Engine Insights');
    expect(container.textContent).not.toContain('Brand Visibility');
  });

  it('read the run line after the tab’s first read, and fill it in', async () => {
    await render('/dashboard/insights', <Tab read={false} />);
    // No tab read sent yet: the run line waits, so it never holds the tab's data.
    expect(tracking.getTrackingWindow).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_LINE_WAIT_MS);
    });
    expect(tracking.getTrackingWindow).toHaveBeenCalledWith('b1');
    expect(container.textContent).toContain('Last run');
    expect(container.querySelector('[data-testid="run-line-loading"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    tracking.getTrackingWindow.mockClear();
    await render('/dashboard/insights');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Sent right behind the tab's read.
    expect(tracking.getTrackingWindow).toHaveBeenCalledTimes(1);
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
