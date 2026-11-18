import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PlanId } from '@/config/plans';

/**
 * Ads' page (ADS-01 §3, mockup): the header every app page has, the five
 * tabs kept in the hash, the Overview and Opportunities with their period,
 * Export off until there is data, and an honest empty state on each other
 * tab. Every plan sees the Overview and Opportunities, its rows from the
 * server (§8); Growth and above read the rest, and Starter and the free trial
 * see the lock with what Growth adds.
 */

vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  // The real header puts the AI usage and Ask Chat beside the title.
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => (
    <div data-slot="header-with-ai-usage">{children}</div>
  ),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => analytics);
// The Overview's read and figures are _overview.test.tsx's.
vi.mock('./_overview', () => ({
  AdsOverview: (props: { period: string; onOpenTab: (tab: string) => void }) => (
    <button
      data-slot="ads-overview"
      data-period={props.period}
      onClick={() => props.onOpenTab('op')}
    />
  ),
}));

// Opportunities' rows, lock row and writes are _opportunities.test.tsx's; here, what it tells
// Chat's side panel of its list.
vi.mock('./_opportunities', async () => {
  const { useEffect } = await import('react');
  return {
    AdsOpportunities: (props: {
      period: string;
      writable: boolean;
      thresholds: boolean;
      onChatView?: (view: object | null) => void;
    }) => {
      const { onChatView } = props;
      useEffect(() => {
        onChatView?.({ rows: [{ ref: 'p1', label: 'Best CRM for startups' }], total: 1 });
        return () => onChatView?.(null);
      }, [onChatView]);
      return (
        <div
          data-slot="ads-opportunities"
          data-period={props.period}
          data-writable={String(props.writable)}
          data-thresholds={String(props.thresholds)}
        />
      );
    },
  };
});

// Connections' reads and Notify me.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const api = vi.hoisted(() => ({ notifyAdsPlatform: vi.fn(), readAdsAnalytics: vi.fn() }));
vi.mock('@/lib/ads/api', async (original) => ({
  ...(await original<typeof import('@/lib/ads/api')>()),
  ...api,
}));

// The brand store keeps its state in localStorage, which this jsdom lacks.
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

const { AdsView } = await import('./_ads-view');
const { PlanProvider } = await import('@/components/providers/plan-provider');
const { useBrandStore } = await import('@/stores/use-brand-store');
const { ChatPageSetterContext } = await import('@/components/chat/panel/chat-panel-context');
const { UpgradeDialogContext } = await import('@/components/providers/upgrade-gate');
const { AdsApiError } = await import('@/lib/ads/api');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const setPage = vi.fn();
const openUpgrade = vi.fn();

beforeEach(() => {
  analytics.track.mockClear();
  for (const fn of [...Object.values(api), ...Object.values(toast), openUpgrade]) fn.mockReset();
  api.readAdsAnalytics.mockResolvedValue({ status: 'connected' });
  setPage.mockClear();
  window.history.replaceState(null, '', '/dashboard/ads');
  useBrandStore.setState({ brands: [], activeBrandId: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function render({
  plan = 'growth',
  status = 'active',
  cloud = true,
  locked = false,
}: { plan?: PlanId; status?: string | null; cloud?: boolean; locked?: boolean } = {}) {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', cloud ? 'true' : '');
  const dialog = { isLocked: locked, reason: 'ended' as const, adminName: null, openUpgrade };
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PlanProvider planId={plan} subscriptionStatus={status}>
          <UpgradeDialogContext.Provider value={dialog}>
            <ChatPageSetterContext.Provider value={setPage}>
              <AdsView />
            </ChatPageSetterContext.Provider>
          </UpgradeDialogContext.Provider>
        </PlanProvider>
      </NextIntlClientProvider>,
    );
  });
}

const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const tab = (name: string) => tabs().find((t) => t.textContent === name)!;
const panel = () => container.querySelector<HTMLElement>('[role="tabpanel"]')!;
const empty = () => container.querySelector('[data-slot="ads-empty"]');
const lock = () => container.querySelector('[data-slot="upgrade-card"]');
const overview = () => container.querySelector<HTMLElement>('[data-slot="ads-overview"]');
const opportunities = () => container.querySelector<HTMLElement>('[data-slot="ads-opportunities"]');
const slot = (name: string) => container.querySelector<HTMLElement>(`[data-slot="ads-${name}"]`);
const action = (id: string, within: ParentNode = container) =>
  within.querySelector<HTMLElement>(`[data-action="${id}"]`);
const periods = () => [
  ...container.querySelectorAll<HTMLButtonElement>('[data-action="ads.period"]'),
];

describe('AdsView', () => {
  it('has the header every app page has: Ads, its line, the AI usage and Ask Chat', async () => {
    await render();
    const header = container.querySelector('[data-slot="header-with-ai-usage"]')!;
    expect(header.querySelector('h1')?.textContent).toBe('Ads');
    expect(header.textContent).toContain('Earn the answer, pay for it, or both.');
  });

  it('lists the five tabs in the mockup’s order, the Overview open', async () => {
    await render();
    expect(tabs().map((t) => t.textContent)).toEqual([
      'Overview',
      'Opportunities',
      'Paid SoV',
      'Campaigns',
      'Connections',
    ]);
    expect(tabs().map((t) => t.dataset.tab)).toEqual(['ov', 'op', 'sov', 'cmp', 'con']);
    expect(tabs().every((t) => t.dataset.action === 'ads.tab')).toBe(true);
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    expect(tab('Campaigns').getAttribute('aria-selected')).toBe('false');
    expect(panel().dataset.tab).toBe('ov');
    expect(panel().getAttribute('aria-labelledby')).toBe(tab('Overview').id);
    expect(tab('Overview').getAttribute('aria-controls')).toBe(panel().id);
  });

  it('opens the tab the address’s hash names', async () => {
    window.history.replaceState(null, '', '/dashboard/ads#sov');
    await render();
    expect(tab('Paid SoV').getAttribute('aria-selected')).toBe('true');
    expect(panel().dataset.tab).toBe('sov');
    expect(empty()?.textContent).toContain('your share of the sponsored ads in AI answers');
  });

  it('opens the Overview for a hash it doesn’t know', async () => {
    window.history.replaceState(null, '', '/dashboard/ads#nope');
    await render();
    expect(panel().dataset.tab).toBe('ov');
  });

  it('switches on a click and keeps the tab in the hash, without a new history entry', async () => {
    await render();
    const length = window.history.length;
    await act(async () => tab('Campaigns').click());
    expect(window.location.hash).toBe('#cmp');
    expect(window.history.length).toBe(length);
    expect(tab('Campaigns').getAttribute('aria-selected')).toBe('true');
    expect(tab('Overview').getAttribute('aria-selected')).toBe('false');
    expect(panel().dataset.tab).toBe('cmp');
    expect(slot('campaigns')).not.toBeNull();

    await act(async () => tab('Opportunities').click());
    expect(window.location.hash).toBe('#op');
    expect(panel().dataset.tab).toBe('op');
  });

  it('follows the hash when it changes: a link to a tab, or Back', async () => {
    await render();
    await act(async () => {
      window.history.replaceState(null, '', '/dashboard/ads#con');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(tab('Connections').getAttribute('aria-selected')).toBe('true');
    expect(panel().dataset.tab).toBe('con');
    expect(slot('connections')).not.toBeNull();
  });

  it('says what Paid SoV stands for on hover', async () => {
    await render();
    const sov = tab('Paid SoV');
    const description = document.getElementById(sov.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe(
      'Paid Share of Voice: your share of sponsored ads shown in AI answers',
    );
    vi.useFakeTimers();
    await act(async () => {
      sov.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }));
      sov.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      sov.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe(
      'Paid Share of Voice: your share of sponsored ads shown in AI answers',
    );
  });

  it('reads the Overview over the period picked, 30 days first; Export stays off', async () => {
    await render();
    expect(periods().map((b) => b.textContent)).toEqual(['7d', '30d', '90d']);
    expect(periods().some((b) => b.disabled)).toBe(false);
    expect(periods().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(overview()?.dataset.period).toBe('30d');
    // The shared range control, named Period, with no label above it in the tab row.
    const group = periods()[0].closest('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Period');
    expect(group.parentElement?.querySelector('label')).toBeNull();
    await act(async () => periods()[0].click());
    expect(overview()?.dataset.period).toBe('7d');
    expect(periods()[0].getAttribute('aria-pressed')).toBe('true');
    const exportButton = container.querySelector<HTMLButtonElement>('[data-action="ads.export"]')!;
    expect(exportButton.textContent).toBe('Export');
    expect(exportButton.disabled).toBe(true);
    // Opportunities reads over it too, with its own Export; the other tabs have no data for a period yet.
    await act(async () => tab('Opportunities').click());
    expect(opportunities()?.dataset.period).toBe('7d');
    expect(periods().some((b) => b.disabled)).toBe(false);
    expect(container.querySelector('[data-action="ads.export"]')).toBeNull();
    await act(async () => tab('Campaigns').click());
    expect(periods().every((b) => b.disabled)).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-action="ads.export"]')?.disabled).toBe(
      true,
    );
  });

  it('tells Chat’s side panel the page, its period and three questions', async () => {
    await render();
    expect(setPage).toHaveBeenLastCalledWith({
      pageName: 'Ads',
      dateRange: { from: '30d', to: null, label: 'Last 30 days' },
      suggestions: [
        'Which buying-intent prompts should we pay for?',
        'Where do competitors lead the AI answer on our buying-intent prompts?',
        'Which open prompts can we win with content?',
      ],
      view: { tab: 'overview' },
    });
    await act(async () => periods()[2].click());
    expect(setPage.mock.lastCall?.[0].dateRange.label).toBe('Last 90 days');
    // On Opportunities, its prompts on screen too (the owner's plan, item 8); none once it's left.
    await act(async () => tab('Opportunities').click());
    expect(setPage.mock.lastCall?.[0].view).toEqual({
      tab: 'opportunities',
      rows: [{ ref: 'p1', label: 'Best CRM for startups' }],
      total: 1,
    });
    await act(async () => tab('Campaigns').click());
    expect(setPage.mock.lastCall?.[0].view).toEqual({ tab: 'campaigns' });
  });

  it('opens the tab the Overview asks for', async () => {
    await render();
    await act(async () => overview()!.click());
    expect(window.location.hash).toBe('#op');
    expect(panel().dataset.tab).toBe('op');
  });

  it('shows an honest empty state on Paid SoV: no numbers, no sample data', async () => {
    await render();
    expect(overview()).not.toBeNull();
    await act(async () => tab('Paid SoV').click());
    expect(empty()?.querySelector('h2')?.textContent).toBe('Coming soon in this preview');
    expect(empty()?.textContent).not.toMatch(/\d/);
    expect(lock()).toBeNull();
  });

  it('never says "Phase" to customers: what comes later is "coming soon" or plain words', () => {
    const strings = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : value && typeof value === 'object'
          ? Object.values(value).flatMap(strings)
          : [];
    const ads = strings(messages.ads);
    expect(ads.length).toBeGreaterThan(100);
    expect(ads.filter((text) => /\bphase\b/i.test(text))).toEqual([]);
  });

  describe('the plan gate (ADS-01 §8, owner A2)', () => {
    it('opens every tab on Growth and Enterprise', async () => {
      for (const plan of ['growth', 'enterprise'] as const) {
        await render({ plan });
        expect(lock(), plan).toBeNull();
        expect(overview(), plan).not.toBeNull();
        await act(async () => tab('Opportunities').click());
        expect(opportunities()?.dataset.writable, plan).toBe('true');
        await act(async () => tab('Paid SoV').click());
        expect(empty(), plan).not.toBeNull();
        await act(async () => tab('Overview').click());
      }
      expect(analytics.track).not.toHaveBeenCalled();
    });

    it('shows Starter the Overview and Opportunities, and locks each other tab with the one line Growth adds and Upgrade', async () => {
      await render({ plan: 'starter' });
      expect(overview()).not.toBeNull();
      expect(lock()).toBeNull();
      await act(async () => tab('Paid SoV').click());
      expect(empty()).toBeNull();
      expect(lock()?.textContent).toContain('Ads is included from the Growth plan');
      expect(lock()?.textContent).toContain(
        'See which buying-intent prompts to win with content, which to pay for, and where to do both.',
      );
      const upgrade = lock()!.querySelector('a')!;
      expect(upgrade.getAttribute('href')).toBe('/dashboard/settings?tab=billing');
      expect(upgrade.textContent).toBe('GrowthUpgrade');
      // The tabs still switch, each locked.
      await act(async () => tab('Campaigns').click());
      expect(panel().dataset.tab).toBe('cmp');
      expect(lock()).not.toBeNull();
      expect(slot('campaigns')).toBeNull();
      await act(async () => tab('Connections').click());
      expect([lock() !== null, slot('connections')]).toEqual([true, null]);
      // Opportunities: the server's rows and lock row, no decision changes.
      await act(async () => tab('Opportunities').click());
      expect(lock()).toBeNull();
      expect(opportunities()?.dataset.writable).toBe('false');
      // Counted as an upgrade wall, by its feature and page.
      expect(analytics.track).toHaveBeenCalledWith('upgrade_wall_shown', {
        reason: 'plan',
        feature: 'ads_read',
        source: 'ads',
      });
    });

    it('locks it but the Overview and Opportunities in the free trial, whatever the plan; an Enterprise deal’s trial keeps its plan', async () => {
      window.history.replaceState(null, '', '/dashboard/ads#sov');
      for (const plan of ['starter', 'growth'] as const) {
        await render({ plan, status: 'trialing' });
        expect(empty(), plan).toBeNull();
        expect(lock()?.textContent, plan).toContain(
          'Ads is included from the Growth plan, after the free trial',
        );
        await act(async () => tab('Opportunities').click());
        expect(lock(), plan).toBeNull();
        expect(opportunities()?.dataset.writable, plan).toBe('false');
        await act(async () => tab('Paid SoV').click());
      }
      await render({ plan: 'enterprise', status: 'trialing' });
      expect(lock()).toBeNull();
      expect(empty()).not.toBeNull();
    });

    it('opens on the demo brand, shown as Growth has it, in the trial too; its decisions stay the rule’s', async () => {
      window.history.replaceState(null, '', '/dashboard/ads#sov');
      useBrandStore.setState({
        brands: [{ id: 'demo', isDemo: true } as never],
        activeBrandId: 'demo',
      });
      await render({ plan: 'starter', status: 'trialing' });
      expect(lock()).toBeNull();
      expect(empty()).not.toBeNull();
      await act(async () => tab('Opportunities').click());
      expect(opportunities()?.dataset.writable).toBe('false');
    });

    it('lets Admins change the thresholds only where the workspace’s own plan can: not Starter or the trial, on any brand', async () => {
      const thresholds = async (over: Parameters<typeof render>[0]) => {
        await render(over);
        await act(async () => tab('Opportunities').click());
        return opportunities()?.dataset.thresholds;
      };
      for (const plan of ['growth', 'enterprise'] as const) {
        expect(await thresholds({ plan }), plan).toBe('true');
      }
      expect(await thresholds({ plan: 'enterprise', status: 'trialing' })).toBe('true');
      expect(await thresholds({ plan: 'starter' })).toBe('false');
      for (const plan of ['starter', 'growth'] as const) {
        expect(await thresholds({ plan, status: 'trialing' }), plan).toBe('false');
      }
      // The demo brand is shown as Growth has it; the thresholds stay the workspace's.
      act(() =>
        useBrandStore.setState({
          brands: [{ id: 'demo', isDemo: true } as never],
          activeBrandId: 'demo',
        }),
      );
      expect(await thresholds({ plan: 'starter' })).toBe('false');
      expect(await thresholds({ plan: 'growth', status: 'trialing' })).toBe('false');
      expect(await thresholds({ plan: 'growth' })).toBe('true');
      expect(await thresholds({ plan: 'starter', cloud: false })).toBe('true');
    });

    it('has no plan gate self-hosted', async () => {
      window.history.replaceState(null, '', '/dashboard/ads#sov');
      await render({ plan: 'starter', cloud: false });
      expect(lock()).toBeNull();
      expect(empty()).not.toBeNull();
      await act(async () => tab('Opportunities').click());
      expect(opportunities()?.dataset.writable).toBe('true');
    });
  });

  describe('Campaigns (ADS-01 §3.4)', () => {
    beforeEach(() => window.history.replaceState(null, '', '/dashboard/ads#cmp'));

    it('shows Growth read-only, with Compare plans and the add-on, which opens the contact form', async () => {
      await render();
      const strip = slot('plan')!;
      expect(strip.textContent).toContain('Your planGrowthRead-only: see spend and results');
      expect(strip.textContent).toContain('needs Enterprise or the Ads add-on');
      expect(action('plan.compare')?.getAttribute('href')).toBe('/dashboard/settings/billing');
      const addon = action('plan.addAdsAddon')!;
      expect(addon.textContent).toBe('Add Ads add-on');
      expect(addon.getAttribute('href')).toBe('https://www.ansvisor.com/contact-us');
      expect(addon.getAttribute('target')).toBe('_blank');
      expect(addon.title).toContain('Talk to us');
      // Read-only or on the demo brand, Compare plans opens the plan dialog.
      await render({ locked: true });
      await act(async () => action('plan.compare')!.click());
      expect(openUpgrade).toHaveBeenCalledTimes(1);
    });

    it('gives Enterprise and self-hosted one line and no upsell', async () => {
      for (const over of [{ plan: 'enterprise' as const }, { cloud: false }]) {
        await render(over);
        expect(slot('plan')?.textContent).toContain('Build and change campaigns once');
        expect(slot('plan')?.querySelectorAll('a, button')).toHaveLength(0);
      }
    });

    it('lists no campaign yet and states the Safety rules and billing, with no payment control', async () => {
      await render();
      const table = slot('campaigns')!.querySelector('table')!;
      expect([...table.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
        'Campaign',
        'Channel',
        'Status',
        'Spend',
        'AI-assisted signups',
        'Cost per signup',
      ]);
      expect(table.querySelector('tbody')?.textContent).toContain(
        'Connect an ad account · coming soon',
      );
      expect(slot('safety')?.querySelectorAll('li')).toHaveLength(4);
      expect(slot('safety')?.textContent).toContain(
        'Ansvisor never sees or changes payment methods.',
      );
      expect(slot('campaigns')?.querySelectorAll('input, select, textarea')).toHaveLength(0);
      // No dead control: each one says what it is and goes somewhere.
      for (const control of slot('campaigns')!.querySelectorAll('a, button')) {
        expect(control.getAttribute('data-action')).toMatch(/^plan\./);
        expect(control.getAttribute('href')).toBeTruthy();
      }
    });
  });

  describe('Connections (ADS-01 §3.5)', () => {
    const card = (id: string) => container.querySelector<HTMLElement>(`[data-platform="${id}"]`)!;
    beforeEach(() => {
      window.history.replaceState(null, '', '/dashboard/ads#con');
      useBrandStore.setState({ activeBrandId: 'b1' });
    });

    it('shows ChatGPT, Google and Microsoft coming soon with nothing to click, each billing on its own', async () => {
      await render();
      for (const id of ['chatgpt', 'google', 'microsoft']) {
        expect(card(id).textContent).toMatch(/Billing stays in .+Coming soon$/);
        expect(card(id).querySelectorAll('a, button')).toHaveLength(0);
      }
      expect(card('microsoft').textContent).toContain('Microsoft Advertising');
    });

    it('logs Notify me once for Meta or LinkedIn, then says "We\'ll tell you"', async () => {
      api.notifyAdsPlatform.mockResolvedValueOnce({ platform: 'meta', logged: true });
      await render();
      expect(card('meta').textContent).toContain('Coming later');
      await act(async () => action('conn.notify', card('meta'))!.click());
      expect(api.notifyAdsPlatform).toHaveBeenCalledWith('b1', 'meta');
      expect(toast.success).toHaveBeenCalledWith("We'll tell you when Meta Ads is ready.");
      expect(action('conn.notify', card('meta'))).toBeNull();
      expect(card('meta').textContent).toContain("We'll tell you");
      // Asked on an earlier visit: the server logs nothing more, and nothing more is said.
      api.notifyAdsPlatform.mockResolvedValueOnce({ platform: 'linkedin', logged: false });
      await act(async () => action('conn.notify', card('linkedin'))!.click());
      expect(card('linkedin').textContent).toContain("We'll tell you");
      expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it('opens the plan dialog on the demo brand, and says so when the ask fails', async () => {
      api.notifyAdsPlatform.mockRejectedValueOnce(
        new AdsApiError('x', 402, { code: 'demo_brand' }),
      );
      await render();
      await act(async () => action('conn.notify', card('meta'))!.click());
      expect(openUpgrade).toHaveBeenCalledTimes(1);
      api.notifyAdsPlatform.mockRejectedValueOnce(new Error('offline'));
      await act(async () => action('conn.notify', card('meta'))!.click());
      expect(toast.error).toHaveBeenCalledWith("Couldn't save that. Try again.");
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows Google Analytics as the app has it, managed in Settings › Integrations', async () => {
      const href = '/dashboard/settings/integrations#google-analytics';
      await render();
      expect(api.readAdsAnalytics).toHaveBeenCalledWith('b1');
      expect(card('analytics').textContent).toContain('ConnectedManage');
      expect(action('conn.manage', card('analytics'))?.getAttribute('href')).toBe(href);
      api.readAdsAnalytics.mockResolvedValueOnce({ status: 'not_connected' });
      await act(async () => useBrandStore.setState({ activeBrandId: 'b2' }));
      expect(card('analytics').textContent).toContain('Not connectedConnect');
      expect(action('conn.connect', card('analytics'))?.getAttribute('href')).toBe(href);
      api.readAdsAnalytics.mockRejectedValueOnce(new Error('offline'));
      await act(async () => useBrandStore.setState({ activeBrandId: 'b3' }));
      expect(card('analytics').textContent).toContain("Couldn't checkManage");
    });

    it('has no dead control: each one has its id and does something', async () => {
      await render();
      const controls = [...slot('connections')!.querySelectorAll('a, button')];
      expect(controls.map((c) => c.getAttribute('data-action'))).toEqual([
        'conn.notify',
        'conn.notify',
        'conn.manage',
      ]);
    });
  });
});
