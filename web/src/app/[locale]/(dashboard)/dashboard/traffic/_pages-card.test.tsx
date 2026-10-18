import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { TrafficDateWindow, TrafficPageRow, TrafficPages } from '@/lib/actions/traffic';

/**
 * The Pages section (AT-006): three work lists and the full list, each with
 * its count, read for the page's range; a row's next step is an audit or
 * prompts that point to the page.
 */

const getTrafficPages = vi.fn();
const runAudit = vi.fn();
const push = vi.fn();
vi.mock('@/lib/actions/traffic', () => ({
  getTrafficPages: (...args: unknown[]) => getTrafficPages(...args),
}));
vi.mock('@/lib/actions/audits', () => ({
  runAudit: (...args: unknown[]) => runAudit(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
  useRouter: () => ({ push }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const { PagesCard } = await import('./_pages-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '33333333-3333-3333-3333-333333333333';
const WEEK: TrafficDateWindow = { dateFrom: '2026-10-11T09:00:00.000Z' };

const page = (over: Partial<TrafficPageRow> = {}): TrafficPageRow => ({
  page: '/gifts',
  aiVisits: 0,
  aiKeyEvents: 0,
  aiPlatforms: [],
  citations: 0,
  targetingPrompts: 0,
  sessions: 320,
  engagedSessions: 200,
  keyEvents: 12,
  transactions: 0,
  revenue: 0,
  engagementSeconds: 0,
  inSitemap: true,
  valueRank: 1,
  ...over,
});

const pages = (rows: TrafficPageRow[], counts: Partial<TrafficPages['counts']> = {}) => ({
  counts: { noAiTraffic: 3, citedNotClicked: 1, trafficNoPrompt: 2, all: 14, ...counts },
  rows,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getTrafficPages.mockReset();
  runAudit.mockReset();
  push.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render({
  domain = 'acme-coffee.example.com',
  analyticsMissing = false,
}: { domain?: string; analyticsMissing?: boolean } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PagesCard
          brandId={BRAND}
          dateWindow={WEEK}
          rangeLabel="Last 7 days"
          domain={domain}
          analyticsMissing={analyticsMissing}
        />
      </NextIntlClientProvider>,
    );
  });
}

const text = () => container.textContent ?? '';
const tab = (label: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) =>
    el.textContent?.startsWith(label),
  )!;
const button = (label: string) =>
  [...container.querySelectorAll<HTMLElement>('button, a')].find((el) => el.textContent === label)!;

describe('PagesCard', () => {
  it('opens on No AI traffic for the page range, with every list counted', async () => {
    getTrafficPages.mockResolvedValue(
      pages([
        page({ citations: 6 }),
        page({ page: '/menu', targetingPrompts: 2, keyEvents: 4, valueRank: 2 }),
        page({ page: '/about', keyEvents: 0, valueRank: 3 }),
      ]),
    );
    await render();

    expect(getTrafficPages).toHaveBeenCalledWith(BRAND, WEEK, { tab: 'noAiTraffic', limit: 10 });
    expect(tab('No AI traffic').textContent).toBe('No AI traffic3');
    expect(tab('Cited, not clicked').textContent).toBe('Cited, not clicked1');
    expect(tab('Traffic, no prompt').textContent).toBe('Traffic, no prompt2');
    expect(tab('All pages').textContent).toBe('All pages14');

    // Why AI engines skip each page, ranked by key events.
    expect(text()).toContain('6 citations in answers');
    expect(text()).toContain('2 prompts target this page');
    expect(text()).toContain('nothing you track points here');
    expect(text()).toContain('ConversionsRank by conversions');
    expect(text()).toContain('32012#1');
    expect(text()).toContain('3 of 3 pages · same range as the rest of the page');
    expect(text()).not.toContain('Show more');
  });

  it('audits a cited page and offers prompts for one nothing points at', async () => {
    getTrafficPages.mockResolvedValue(
      pages([page({ citations: 6 }), page({ page: '/about', valueRank: 2 })]),
    );
    runAudit.mockResolvedValue({ id: 'audit-1' });
    await render();

    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/dashboard/prompts']);

    await act(async () => button('Audit page').click());
    expect(runAudit).toHaveBeenCalledWith(BRAND, 'https://acme-coffee.example.com/gifts');
    expect(push).toHaveBeenCalledWith('/dashboard/audit/audit-1');
  });

  it("can't audit without the brand's domain", async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 6 })]));
    await render({ domain: '' });
    expect(button('Audit page').hasAttribute('disabled')).toBe(true);
  });

  it('reads another list from the first ten, with its own columns', async () => {
    getTrafficPages.mockResolvedValue(pages([]));
    await render();
    getTrafficPages.mockResolvedValue(
      pages([
        page({
          page: '/subscriptions',
          aiVisits: 7,
          aiKeyEvents: 2,
          aiPlatforms: ['chatgpt.com', 'perplexity.ai'],
        }),
      ]),
    );
    await act(async () => tab('Traffic, no prompt').click());

    expect(getTrafficPages).toHaveBeenLastCalledWith(BRAND, WEEK, {
      tab: 'trafficNoPrompt',
      limit: 10,
    });
    expect(text()).toContain('/subscriptions');
    expect(text()).toContain('ChatGPT, Perplexity');
    expect(button('Add prompts').getAttribute('href')).toBe('/dashboard/prompts');
  });

  it("never shows one list's rows under another's columns while it loads", async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 25 })]));
    await render();
    expect(text()).toContain('/gifts');

    getTrafficPages.mockReturnValue(new Promise(() => {}));
    await act(async () => tab('Traffic, no prompt').click());
    expect(text()).not.toContain('/gifts');
    expect(text()).not.toContain('Show more');
    expect(container.querySelector('table')).toBeNull();
  });

  it('shows ten more pages at a time', async () => {
    getTrafficPages.mockResolvedValue(
      pages(
        Array.from({ length: 10 }, (_, i) => page({ page: `/p${i}` })),
        { noAiTraffic: 12 },
      ),
    );
    await render();
    expect(text()).toContain('10 of 12 pages');

    await act(async () => button('Show more').click());
    expect(getTrafficPages).toHaveBeenLastCalledWith(BRAND, WEEK, {
      tab: 'noAiTraffic',
      limit: 20,
    });
  });

  it('labels every list a page is on in All pages', async () => {
    getTrafficPages.mockResolvedValue(pages([]));
    await render();
    getTrafficPages.mockResolvedValue(
      pages([
        page({ citations: 25, sessions: 40 }),
        page({ page: '/subscriptions', aiVisits: 8, citations: 4 }),
      ]),
    );
    await act(async () => tab('All pages').click());

    const badges = [...container.querySelectorAll('tbody [data-slot="badge"]')].map(
      (b) => b.textContent,
    );
    expect(badges).toEqual(['No AI traffic', 'Cited, not clicked']);
    // A page on no list is doing fine.
    const status = [...container.querySelectorAll('tbody tr')][1].lastElementChild;
    expect(status?.textContent).toBe('—');
  });

  it("says when a list is empty, when it couldn't load, and what needs Analytics", async () => {
    getTrafficPages.mockResolvedValue(pages([], { noAiTraffic: 0 }));
    await render({ analyticsMissing: true });
    expect(text()).toContain('Every page with traffic or in your sitemap got AI visits');
    expect(text()).toContain('the No AI traffic list need Google Analytics');

    getTrafficPages.mockRejectedValue(new Error('Server error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => tab('Cited, not clicked').click());
    expect(text()).toContain("The pages couldn't be loaded.");
  });
});
