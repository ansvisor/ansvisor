import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AdsOpportunity, AdsOpportunityDetail } from '@/lib/ads/api';

/**
 * An opportunity's drawer (ADS-01 §3.2, §11), opened from the table's Open:
 * the row's decision and why, the latest answer per platform as quoted plain
 * text, fan-outs and seeds, no sponsored line without data, and closed by
 * ✕, the overlay or Esc with focus back on Open.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
const api = vi.hoisted(() => ({ readAdsOpportunities: vi.fn(), readAdsOpportunity: vi.fn() }));
vi.mock('@/lib/ads/api', () => api);
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const { AdsOpportunities } = await import('./_opportunities');
const { RoleProvider } = await import('@/components/providers/role-provider');
const { useBrandStore } = await import('@/stores/use-brand-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROW: AdsOpportunity = {
  promptId: 'p1',
  text: 'Best CRM for small teams',
  topic: null,
  decision: 'earn_pay',
  recommended: 'earn',
  override: { decision: 'earn_pay', setBy: 'u1', setAt: '2026-11-13T09:00:00Z' },
  leader: 'c1',
  leaderName: 'Kestrel',
  ourPosition: null,
  weNamed: false,
  weCited: false,
  volume: 14_000,
  estAiVolume: 6300,
  adChannels: ['chatgpt'],
  paidMeasured: false,
  reasons: [
    { code: 'rival_leads', competitorId: 'c1' },
    { code: 'volume_at_least', volume: 14_000, threshold: 1000 },
    { code: 'paid_not_measured', rivalPays: true, wePay: true },
    { code: 'a_later_code' },
  ],
};
const DETAIL: AdsOpportunityDetail = {
  promptId: 'p1',
  answers: [
    {
      platform: 'chatgpt-web',
      region: 'US',
      at: '2026-11-13T08:00:00Z',
      excerpt: 'Kestrel is the usual pick. <script>alert("x")</script> <b>Harbor</b> is cheaper.',
      mentionPosition: null,
      competitors: [
        { name: 'Kestrel', position: 1 },
        { name: 'Harbor', position: 2 },
      ],
      domains: ['g2.com', 'kestrel.example'],
    },
    {
      platform: 'google-aio',
      region: null,
      at: '2026-11-12T08:00:00Z',
      excerpt: 'Northwind is named second.',
      mentionPosition: 2,
      competitors: [],
      domains: [],
    },
  ],
  fanOuts: [{ query: 'best crm 2026', platform: 'google-aio' }],
  keywords: ['best crm', 'crm small team'],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  api.readAdsOpportunities.mockReset().mockResolvedValue({
    period: '30d',
    rows: [ROW],
    total: 1,
    locked: 0,
    notAnalysed: 0,
  });
  api.readAdsOpportunity.mockReset().mockResolvedValue(DETAIL);
  useBrandStore.setState({ brands: [], activeBrandId: 'b1' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role="analyst">
          <AdsOpportunities period="30d" writable />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const openButton = () =>
  container.querySelector<HTMLButtonElement>('[data-action="ads.openOpportunity"]')!;
const drawer = () => document.querySelector<HTMLElement>('[data-slot="ads-drawer"]');
async function open() {
  await act(async () => {
    openButton().focus();
    openButton().click();
  });
}

describe('AdsOpportunityDrawer', () => {
  it("shows the row's decision and why, then the latest answer per platform, fan-outs and seeds", async () => {
    await open();
    expect(api.readAdsOpportunity).toHaveBeenCalledWith('b1', 'p1', '30d');
    const d = drawer()!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.querySelector('h2')?.textContent).toBe('Best CRM for small teams');
    expect(d.querySelector('[data-decision]')?.textContent).toBe('Earn + pay');
    expect(d.textContent).toContain('Recommended: Earn');
    // Each reason the rule gave, in words; a code it doesn't know yet, left out.
    expect([...d.querySelectorAll('ul[aria-label="Why"] li')].map((li) => li.textContent)).toEqual([
      'Kestrel leads the AI answer',
      '14,000 Google searches a month, at least 1,000',
      "Who pays isn't measured yet",
    ]);
    const answers = [...d.querySelectorAll('[data-slot="ads-answer"]')];
    expect(answers.map((a) => a.querySelector('p')?.textContent)).toEqual([
      'ChatGPT · United States · Nov 13, 2026',
      'Google AI Overviews · Nov 12, 2026',
    ]);
    expect(answers[0].textContent).toContain('You: not named · Names: Kestrel, Harbor');
    expect(answers[0].textContent).toContain('Cites: g2.com, kestrel.example');
    expect(answers[1].textContent).toContain('You: #2');
    expect(answers[1].textContent).not.toContain('Cites');
    expect(d.querySelector('[data-slot="ads-fanouts"]')?.textContent).toBe('best crm 2026');
    expect(d.querySelector('[data-slot="ads-keywords"]')?.textContent).toBe(
      'best crmcrm small team',
    );
  });

  it('renders the answer as quoted text: a <script> in it is only text', async () => {
    await open();
    const quote = drawer()!.querySelector('blockquote')!;
    expect(quote.textContent).toBe(DETAIL.answers[0].excerpt);
    expect(quote.children).toHaveLength(0);
    expect(
      document.querySelector('[data-slot="ads-drawer"] script, [data-slot="ads-drawer"] b'),
    ).toBeNull();
  });

  it('says nothing about sponsored units while none are stored, and never estimates one', async () => {
    await open();
    expect(drawer()!.textContent).not.toMatch(/sponsor|paid ad|estimated/i);
  });

  it('says so when there is no answer in the period, or the read fails', async () => {
    api.readAdsOpportunity.mockResolvedValue({ ...DETAIL, answers: [], fanOuts: [], keywords: [] });
    await open();
    expect(drawer()!.textContent).toContain('No AI answer on this prompt in this period yet.');
    expect(drawer()!.querySelector('[data-slot="ads-fanouts"]')).toBeNull();
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );

    api.readAdsOpportunity.mockRejectedValue(new Error('Ads opportunities/p1: 500'));
    await open();
    expect(drawer()!.querySelector('[role="alert"]')?.textContent).toBe(
      "The answers couldn't be read. Close this and open it again.",
    );
  });

  it('keeps focus inside, closes with Esc, ✕ or the overlay, and gives focus back to Open', async () => {
    await open();
    expect(drawer()!.contains(document.activeElement)).toBe(true);
    expect(container.querySelector('tr[data-prompt-id]')?.getAttribute('data-state')).toBe(
      'selected',
    );

    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(openButton());
    expect(container.querySelector('tr[data-prompt-id]')?.getAttribute('data-state')).toBeNull();

    const closers = () => [
      ...document.querySelectorAll<HTMLElement>('[data-action="drawer.close"]'),
    ];
    await open();
    expect(closers().map((el) => el.tagName)).toEqual(['DIV', 'BUTTON']);
    await act(async () => closers()[1].click());
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(openButton());

    await open();
    await act(async () => {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        closers()[0].dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
    });
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(openButton());
  });
});
