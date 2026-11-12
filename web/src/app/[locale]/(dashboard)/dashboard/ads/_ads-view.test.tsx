import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PlanId } from '@/config/plans';

/**
 * Ads' page (ADS-01 §3, mockup), Phase 0's first step: the header every app
 * page has, the five tabs kept in the hash, the period and Export off until
 * there is data, and an honest empty state on each tab. Growth and above read
 * it; Starter and the free trial see the lock with what Growth adds.
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

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  analytics.track.mockClear();
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
}: { plan?: PlanId; status?: string | null; cloud?: boolean } = {}) {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', cloud ? 'true' : '');
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PlanProvider planId={plan} subscriptionStatus={status}>
          <AdsView />
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
    expect(empty()?.textContent).toContain('Campaigns will list your ad campaigns');

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

  it('keeps the period and Export off until Ads has data, 30 days shown', async () => {
    await render();
    const periods = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-action="ads.period"]'),
    ];
    expect(periods.map((b) => b.textContent)).toEqual(['7d', '30d', '90d']);
    expect(periods.every((b) => b.disabled)).toBe(true);
    expect(periods.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    // The shared range control, named Period, with no label above it in the tab row.
    const group = periods[0].closest('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Period');
    expect(group.parentElement?.querySelector('label')).toBeNull();
    const exportButton = container.querySelector<HTMLButtonElement>('[data-action="ads.export"]')!;
    expect(exportButton.textContent).toBe('Export');
    expect(exportButton.disabled).toBe(true);
  });

  it('shows an honest empty state on each tab: no numbers, no sample data', async () => {
    await render();
    for (const name of ['Overview', 'Opportunities', 'Paid SoV', 'Campaigns', 'Connections']) {
      await act(async () => tab(name).click());
      expect(empty()?.querySelector('h2')?.textContent).toBe('Coming soon in this preview');
      expect(empty()?.textContent).not.toMatch(/\d/);
    }
    expect(lock()).toBeNull();
  });

  describe('the plan gate (ADS-01 §8, owner A2)', () => {
    it('opens every tab on Growth and Enterprise', async () => {
      for (const plan of ['growth', 'enterprise'] as const) {
        await render({ plan });
        expect(lock(), plan).toBeNull();
        expect(empty(), plan).not.toBeNull();
      }
      expect(analytics.track).not.toHaveBeenCalled();
    });

    it('locks each tab on Starter, with the one line Growth adds and Upgrade', async () => {
      await render({ plan: 'starter' });
      expect(empty()).toBeNull();
      expect(lock()?.textContent).toContain('Ads is included from the Growth plan');
      expect(lock()?.textContent).toContain(
        'See which buying-intent prompts to win with content, which to pay for, and where to do both.',
      );
      const upgrade = lock()!.querySelector('a')!;
      expect(upgrade.getAttribute('href')).toBe('/dashboard/settings?tab=billing');
      expect(upgrade.textContent).toBe('GrowthUpgrade');
      // The tabs still switch, each locked.
      await act(async () => tab('Opportunities').click());
      expect(panel().dataset.tab).toBe('op');
      expect(lock()).not.toBeNull();
      // Counted as an upgrade wall, by its feature and page.
      expect(analytics.track).toHaveBeenCalledWith('upgrade_wall_shown', {
        reason: 'plan',
        feature: 'ads_read',
        source: 'ads',
      });
    });

    it('locks it in the free trial, whatever the plan; an Enterprise deal’s trial keeps its plan', async () => {
      for (const plan of ['starter', 'growth'] as const) {
        await render({ plan, status: 'trialing' });
        expect(empty(), plan).toBeNull();
        expect(lock()?.textContent, plan).toContain(
          'Ads is included from the Growth plan, after the free trial',
        );
      }
      await render({ plan: 'enterprise', status: 'trialing' });
      expect(lock()).toBeNull();
      expect(empty()).not.toBeNull();
    });

    it('opens on the demo brand, shown as Growth has it, in the trial too', async () => {
      useBrandStore.setState({
        brands: [{ id: 'demo', isDemo: true } as never],
        activeBrandId: 'demo',
      });
      await render({ plan: 'starter', status: 'trialing' });
      expect(lock()).toBeNull();
      expect(empty()).not.toBeNull();
    });

    it('has no plan gate self-hosted', async () => {
      await render({ plan: 'starter', cloud: false });
      expect(lock()).toBeNull();
      expect(empty()).not.toBeNull();
    });
  });
});
