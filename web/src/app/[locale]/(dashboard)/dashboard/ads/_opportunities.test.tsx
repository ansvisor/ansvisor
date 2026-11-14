import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { TeamRole } from '@/components/providers/role-provider';
import type { AdsDecision, AdsOpportunities, AdsOpportunity } from '@/lib/ads/api';

/**
 * Ads' Opportunities (ADS-01 §3.2, §9.3, §9.7): every row with a decision
 * and Open, the decision filters, Starter's rows and lock row from the
 * server, a decision changed by Admins and Managers only (put back when the
 * server refuses it), and the thresholds for Admins only.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
const api = vi.hoisted(() => ({
  readAdsOpportunities: vi.fn(),
  setAdsDecision: vi.fn(),
  readAdsSettings: vi.fn(),
  saveAdsSettings: vi.fn(),
}));
vi.mock('@/lib/ads/api', () => api);
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const { AdsOpportunities: Opportunities } = await import('./_opportunities');
const { RoleProvider } = await import('@/components/providers/role-provider');
const { useBrandStore } = await import('@/stores/use-brand-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const row = (promptId: string, decision: AdsDecision, over: Partial<AdsOpportunity> = {}) => ({
  promptId,
  text: `Prompt ${promptId}`,
  topic: { id: 't1', name: 'CRM' },
  decision,
  recommended: decision,
  override: null,
  leader: 'c1',
  leaderName: 'Kestrel',
  ourPosition: null,
  weNamed: false,
  weCited: false,
  volume: 14_000,
  estAiVolume: 6300,
  adChannels: ['chatgpt', 'google'] as AdsOpportunity['adChannels'],
  paidMeasured: false,
  ...over,
});
const ROWS: AdsOpportunity[] = [
  // A person's decision over the rule's.
  row('p1', 'earn_pay', {
    recommended: 'earn',
    override: { decision: 'earn_pay', setBy: 'u1', setAt: '2026-11-13T09:00:00Z' },
  }),
  row('p2', 'earn_pay', { ourPosition: 2, weNamed: true, weCited: true, adChannels: [] }),
  row('p3', 'pay', { leader: 'us', leaderName: null, ourPosition: 1, weNamed: true, volume: null }),
  row('p4', 'earn', { leader: 'none', leaderName: null, weNamed: true, topic: null }),
  row('p5', 'earn'),
  row('p6', 'overlap'),
];
const page = (rows = ROWS, locked = 0): AdsOpportunities => ({
  period: '30d',
  rows,
  total: rows.length + locked,
  locked,
  notAnalysed: 0,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const fn of [...Object.values(api), toast.error, toast.success]) fn.mockReset();
  useBrandStore.setState({ brands: [], activeBrandId: 'b1' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

async function render(
  read: AdsOpportunities | Error = page(),
  { role = 'manager', writable = true }: { role?: TeamRole; writable?: boolean } = {},
) {
  if (read instanceof Error) api.readAdsOpportunities.mockRejectedValue(read);
  else api.readAdsOpportunities.mockResolvedValue(read);
  // Mounted anew each time, so it reads again.
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <Opportunities period="30d" writable={writable} />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const rows = () => [...container.querySelectorAll<HTMLElement>('tbody tr[data-prompt-id]')];
const cells = (r: HTMLElement) => [...r.querySelectorAll('td')].map((td) => td.textContent);
const ids = () => rows().map((r) => r.dataset.promptId);
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-action="${id}"]`)];
const filter = (label: string) => all('ads.filterDecision').find((b) => b.textContent === label)!;
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const pick = async (r: number, item: string) => {
  await click(rows()[r].querySelector('[data-action="ads.overrideDecision"]')!);
  await click(all('ads.setDecision').find((i) => i.textContent === item)!);
};

describe('AdsOpportunities', () => {
  it('lists every row with a decision and Open, who AI picks, Google searches and channels (§9.3)', async () => {
    await render();
    expect(api.readAdsOpportunities).toHaveBeenCalledWith('b1', '30d');
    expect(rows()).toHaveLength(ROWS.length);
    for (const r of rows()) {
      expect(r.querySelector('[data-decision]')).not.toBeNull();
      expect(r.querySelector('[data-action="ads.openOpportunity"]')?.textContent).toBe('Open');
    }
    expect(cells(rows()[0])).toEqual([
      'Prompt p1Topic · CRM',
      'Earn + payChange the decisionRecommended: Earn',
      'KestrelYou: not named',
      '14k',
      'ChatGPT, Google',
      'Open',
    ]);
    expect(cells(rows()[1]).slice(2, 5)).toEqual(['KestrelYou: #2, cited', '14k', 'No ad channel']);
    expect(cells(rows()[2]).slice(2, 4)).toEqual(['YouYou: #1', 'Not measured']);
    expect(cells(rows()[3]).slice(0, 3)).toEqual([
      'Prompt p4',
      'EarnChange the decision',
      'No clear leaderYou: named',
    ]);
    expect(container.textContent).toContain("Who pays on these prompts isn't measured yet");

    // Open keeps the prompt opened, for its drawer.
    await click(rows()[2].querySelector('[data-action="ads.openOpportunity"]')!);
    expect(rows().map((r) => r.dataset.state ?? '')).toEqual(['', '', 'selected', '', '', '']);
  });

  it('fills Channels only where the decision says to pay; Earn and Overlap need no ad', async () => {
    await render();
    const channels = (id: string) =>
      rows()
        .find((r) => r.dataset.promptId === id)!
        .querySelector<HTMLElement>('[data-slot="ads-channels"]')!;
    // Pay and Earn + pay list their channels.
    expect(channels('p3').textContent).toBe('ChatGPT, Google');
    expect(channels('p1').textContent).toBe('ChatGPT, Google');
    // Earn and Overlap show a muted dash that reads as "No ad needed".
    for (const id of ['p4', 'p5', 'p6']) {
      const cell = channels(id);
      expect(cell.querySelector('[aria-hidden]')?.textContent).toBe('—');
      expect(cell.querySelector('.sr-only')?.textContent).toBe('No ad needed');
      expect(cell.textContent).not.toContain('ChatGPT');
    }
    // The header stays.
    expect(container.querySelector('thead')?.textContent).toContain('Channels');
  });

  it('says what the Google searches estimate for AI on hover', async () => {
    await render();
    vi.useFakeTimers();
    const volume = rows()[0].querySelector('[data-slot="ads-searches"] span')!;
    await act(async () => {
      for (const type of ['pointerenter', 'mouseenter', 'mousemove']) {
        volume.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe(
      '14,000 Google searches a month. AI prompts, estimated: 6,300 a month',
    );
  });

  it('filters by decision: All, Earn + pay, Pay, Earn', async () => {
    await render();
    expect(all('ads.filterDecision').map((b) => b.textContent)).toEqual([
      'All · 6',
      'Earn + pay · 2',
      'Pay · 1',
      'Earn · 2',
    ]);
    await click(filter('Pay · 1'));
    expect(ids()).toEqual(['p3']);
    expect(filter('Pay · 1').getAttribute('aria-pressed')).toBe('true');
    await click(filter('Earn · 2'));
    expect(ids()).toEqual(['p4', 'p5']);
    await click(filter('Earn + pay · 2'));
    expect(ids()).toEqual(['p1', 'p2']);
    await click(filter('All · 6'));
    expect(ids()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  });

  it('shows Starter the server’s 3 rows and the lock row with Upgrade; Growth sees all (§9.7)', async () => {
    await render(page(ROWS.slice(0, 3), 5), { writable: false });
    expect(ids()).toEqual(['p1', 'p2', 'p3']);
    // One slim row across the columns: the lock, the count and Upgrade, not a card.
    const lock = container.querySelector<HTMLElement>('[data-slot="ads-lock-row"]')!;
    expect(lock.tagName).toBe('TR');
    const cell = lock.querySelector('td')!;
    expect(lock.querySelectorAll('td')).toHaveLength(1);
    expect(cell.colSpan).toBe(6);
    expect(cell.querySelector('svg')).not.toBeNull();
    expect(lock.querySelector('[data-slot="upgrade-card"]')).toBeNull();
    expect(lock.textContent).toBe(
      '5 more prompts · Ads opportunities are included from GrowthUpgrade',
    );
    const upgrade = lock.querySelector('[data-action="plan.upgrade"]')!;
    expect(upgrade.textContent).toBe('Upgrade');
    expect(upgrade.getAttribute('href')).toBe('/dashboard/settings?tab=billing');
    // Locked rows stay locked under each filter.
    await click(filter('Earn · 0'));
    expect(container.textContent).toContain('No prompts with this decision.');
    expect(container.querySelector('[data-slot="ads-lock-row"]')).not.toBeNull();

    await render(page());
    expect(ids()).toHaveLength(6);
    expect(container.querySelector('[data-slot="ads-lock-row"]')).toBeNull();
  });

  it('offers the decision menu to Admins and Managers, never to an Analyst or past the plan', async () => {
    const menus = () => all('ads.overrideDecision').length;
    for (const role of ['admin', 'manager'] as const) {
      await render(page(), { role });
      expect(menus(), role).toBe(6);
    }
    await render(page(), { role: 'analyst' });
    expect(menus()).toBe(0);
    expect(rows()[0].querySelector('[data-decision]')?.textContent).toBe('Earn + pay');
    await render(page(), { writable: false });
    expect(menus()).toBe(0);
  });

  it('saves a decision at once, then back to the recommendation', async () => {
    const override = { decision: 'pay', setBy: 'u1', setAt: '2026-11-14T09:00:00Z' };
    api.setAdsDecision.mockResolvedValue({ promptId: 'p2', override });
    await render();
    await pick(1, 'Pay');
    expect(api.setAdsDecision).toHaveBeenCalledWith('b1', 'p2', 'pay');
    expect(cells(rows()[1])[1]).toBe('PayChange the decisionRecommended: Earn + pay');
    expect(filter('Pay · 2')).toBeDefined();

    api.setAdsDecision.mockResolvedValue({ promptId: 'p2', override: null });
    await pick(1, 'Back to the recommendation (Earn + pay)');
    expect(api.setAdsDecision).toHaveBeenLastCalledWith('b1', 'p2', null);
    expect(cells(rows()[1])[1]).toBe('Earn + payChange the decision');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('puts the decision back when the server refuses it, and says so', async () => {
    let refuse: (err: Error) => void = () => {};
    api.setAdsDecision.mockReturnValue(new Promise((_, reject) => (refuse = reject)));
    await render();
    // Channels follow the decision in force: none on Earn, the channels on Earn + pay.
    const channels = () => cells(rows()[3])[4];
    expect(channels()).toBe('—No ad needed');
    await pick(3, 'Earn + pay');
    expect(cells(rows()[3])[1]).toBe('Earn + payChange the decisionRecommended: Earn');
    expect(channels()).toBe('ChatGPT, Google');
    await act(async () => refuse(new Error('Ads opportunities/p4/decision: 403')));
    expect(cells(rows()[3])[1]).toBe('EarnChange the decision');
    expect(channels()).toBe('—No ad needed');
    expect(toast.error).toHaveBeenCalledWith("The decision couldn't be saved. Try again.");
  });

  it('gives only Admins the thresholds, saved together, and reads the rows again', async () => {
    for (const role of ['manager', 'analyst'] as const) {
      await render(page(), { role });
      expect(all('ads.thresholds'), role).toEqual([]);
    }
    const defaults = { minIntentWeight: 0.85, leadPosition: 1, minPaidVolume: 1000 };
    api.readAdsSettings.mockResolvedValue({
      saved: { leadPosition: 2 },
      thresholds: { ...defaults, leadPosition: 2 },
      defaults,
    });
    api.saveAdsSettings.mockImplementation(async (t) => ({ saved: t, thresholds: t, defaults }));
    await render(page(), { role: 'admin' });
    api.readAdsOpportunities.mockClear();
    await click(all('ads.thresholds')[0]);
    const fields = all('ads.threshold') as HTMLInputElement[];
    expect(fields.map((f) => [f.value, f.placeholder])).toEqual([
      ['', '0.85'],
      ['2', '1'],
      ['', '1000'],
    ]);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      set.call(fields[2], '5000');
      fields[2].dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(all('ads.saveThresholds')[0]);
    expect(api.saveAdsSettings).toHaveBeenCalledWith({
      minIntentWeight: null,
      leadPosition: 2,
      minPaidVolume: 5000,
    });
    expect(toast.success).toHaveBeenCalledWith('Thresholds saved');
    expect(api.readAdsOpportunities).toHaveBeenCalledOnce();
  });

  it('says so when Opportunities can’t be read, or there are none yet', async () => {
    await render(new Error('Ads opportunities: 500'));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Opportunities couldn't be read. Reload the page to try again.",
    );
    await render(page([]));
    expect(container.querySelector('[data-slot="ads-empty"] h2')?.textContent).toBe(
      'No buying-intent prompts yet',
    );
  });
});
