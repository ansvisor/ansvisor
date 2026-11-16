import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AdsOverview as Overview } from '@/lib/ads/api';

/**
 * Ads' Overview (ADS-01 §3.1, §9.2): the KPIs and the earn-or-pay bar, whose
 * parts add up to the buying-intent prompts, with "Not measured" wherever
 * paid or spend isn't, and Starter's lock from the server's count.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const api = vi.hoisted(() => ({ readAdsOverview: vi.fn() }));
vi.mock('@/lib/ads/api', () => api);
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const { AdsOverview } = await import('./_overview');
const { useBrandStore } = await import('@/stores/use-brand-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Today's normal case: paid not measured. */
const UNPAID: Overview = {
  period: '30d',
  total: 12,
  notAnalysed: 4,
  locked: 0,
  paidMeasured: false,
  bar: { earned: 5, earnedPaid: null, paidOnly: null, neither: 7 },
  paidSov: null,
  signups: 9,
};

let container: HTMLDivElement;
let root: Root;
const onOpenTab = vi.fn();

beforeEach(() => {
  api.readAdsOverview.mockReset();
  onOpenTab.mockReset();
  useBrandStore.setState({ brands: [], activeBrandId: 'b1' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Mounted anew each time, so it reads again. */
async function render(overview: Overview | Error = UNPAID, period: '7d' | '30d' = '30d') {
  if (overview instanceof Error) api.readAdsOverview.mockRejectedValue(overview);
  else api.readAdsOverview.mockResolvedValue(overview);
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AdsOverview period={period} onOpenTab={onOpenTab} />
      </NextIntlClientProvider>,
    );
  });
}

const kpis = () =>
  [...container.querySelectorAll('[data-slot="ads-kpi"]')].map((k) => k.textContent);
const parts = () =>
  [...container.querySelectorAll<HTMLElement>('[data-part]')].map((li) => [
    li.dataset.part,
    Number(li.querySelector('b')?.textContent),
  ]);
const sum = () => parts().reduce((total, [, n]) => total + Number(n), 0);
const action = (id: string) => container.querySelector<HTMLElement>(`[data-action="${id}"]`);

describe('AdsOverview', () => {
  it('reads the active brand’s Overview over the period', async () => {
    await render(UNPAID, '7d');
    expect(api.readAdsOverview).toHaveBeenCalledWith('b1', '7d');
    expect(container.querySelector('[data-slot="ads-earn-or-pay"]')?.textContent).toContain(
      'Earn or pay · 12 promptsLast 7 days',
    );
  });

  it('while paid isn’t measured, shows earned and neither, which add up, and says so (§9.2)', async () => {
    await render();
    expect(parts()).toEqual([
      ['earned', 5],
      ['neither', 7],
    ]);
    expect(sum()).toBe(UNPAID.total);
    expect(container.textContent).toContain(
      "Paid isn't measured yet, so the bar shows only earned and neither.",
    );
    expect(kpis()[1]).toBe(
      "Covered (earned or paid)42%5 of 12 prompts, earned only: paid isn't measured yet",
    );
  });

  it('once paid is measured, shows four parts that add up', async () => {
    await render({
      ...UNPAID,
      paidMeasured: true,
      bar: { earned: 4, earnedPaid: 3, paidOnly: 2, neither: 3 },
    });
    expect(parts().map(([part]) => part)).toEqual(['earned', 'earnedPaid', 'paidOnly', 'neither']);
    expect(sum()).toBe(UNPAID.total);
    expect(kpis()[1]).toBe('Covered (earned or paid)75%9 of 12 prompts');
    expect(container.textContent).not.toContain("Paid isn't measured");
  });

  it('says Not measured for Paid SoV and the cost per signup, and counts the signups', async () => {
    await render();
    expect(kpis()[2]).toBe(
      "Paid SoVNot measuredSponsored ads in AI answers aren't captured yetWho pays per prompt",
    );
    expect(kpis()[3]).toBe(
      'Cost per AI-assisted signupNot measuredNeeds a connected ad account9 AI-assisted signups in this period',
    );
    await render({ ...UNPAID, signups: null });
    expect(container.querySelector('[data-slot="ads-signups"]')?.textContent).toBe(
      'AI-assisted signups: not measured',
    );
  });

  it('links the prompts not analysed to Prompts Insights’ volumes', async () => {
    await render();
    expect(kpis()[0]).toBe('Buying-intent prompts12Not analysed (4)');
    expect(action('ads.openVolumes')?.getAttribute('href')).toBe('/dashboard/prompts/insights');
    await render({ ...UNPAID, notAnalysed: 0 });
    expect(action('ads.openVolumes')).toBeNull();
  });

  it('opens Opportunities and Paid SoV', async () => {
    await render();
    expect(action('ads.openOpportunities')?.textContent).toBe('See 7 open prompts');
    await act(async () => action('ads.openOpportunities')!.click());
    expect(onOpenTab).toHaveBeenLastCalledWith('op');
    await act(async () => action('ads.openSov')!.click());
    expect(onOpenTab).toHaveBeenLastCalledWith('sov');
  });

  it('shows Starter the whole Overview, with the Opportunities rows the server locks', async () => {
    await render({ ...UNPAID, locked: 9 });
    expect(sum()).toBe(UNPAID.total);
    expect(container.textContent).toContain(
      '9 more prompts in Opportunities are included from the Growth plan.',
    );
    await render();
    expect(container.textContent).not.toContain('included from');
  });

  it('says so when the Overview can’t be read', async () => {
    await render(new Error('Ads Overview: 500'));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "The Overview couldn't be read. Reload the page to try again.",
    );
  });
});
