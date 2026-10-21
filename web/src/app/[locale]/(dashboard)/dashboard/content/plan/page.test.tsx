import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { PlanOpportunity, PlanPage } from '@/lib/content/plan';
import ContentPlanPage from './page';

const getContentPlan = vi.fn();
const getContentPlanInsights = vi.fn();
vi.mock('@/lib/actions/content-plan', () => ({
  getContentPlan: (...args: unknown[]) => getContentPlan(...args),
  getContentPlanInsights: (...args: unknown[]) => getContentPlanInsights(...args),
}));
// New content is new-content-dialog.test.tsx's; here, what the Plan opens it on.
const dialog = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('@/components/content/new-content-dialog', () => ({
  NewContentDialog: (props: Record<string, unknown>) => {
    dialog.props = props;
    return null;
  },
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const brandState = vi.hoisted(() => ({
  activeBrandId: 'brand-1' as string | null,
  brands: [{ id: 'brand-1', siteType: 'b2b' }],
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: typeof brandState) => unknown) => selector(brandState),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const page = (path: string, over: Partial<PlanPage> = {}): PlanPage => ({
  page: `https://acme.example${path}`,
  title: null,
  citations: { cur: 2, prev: 2 },
  platformsDown: [],
  aiVisits: 0,
  overlaps: 0,
  ...over,
});
const opportunity: PlanOpportunity = {
  id: 'o1',
  title: 'Create an office coffee page',
  pageTitle: 'Office coffee subscriptions',
  decision: 'create',
  score: 74,
  targetPage: null,
  targetTitle: null,
  competitorsCited: ['Daily Grind Co.', 'Origin Box'],
  visibility: 6,
  prompts: 2,
};
const PLAN = {
  pages: [
    page('/guides/coffee-subscriptions', {
      title: 'Coffee subscriptions',
      citations: { cur: 3, prev: 10 },
      platformsDown: ['chatgpt-web', 'perplexity-web'],
    }),
    page('/guides/espresso', {
      title: 'Espresso guide',
      citations: { cur: 12, prev: 10 },
      aiVisits: 42,
      overlaps: 1,
    }),
  ],
  answers: { cur: 100, prev: 100 },
  tracking: { prevFrom: '2026-08-23', trackedSince: '2026-06-01' },
  opportunities: [opportunity],
  drafts: [],
};

const INSIGHTS = {
  // The listed addresses hold 80; the tail beyond them 40 more.
  totalCitations: 120,
  citations: [
    {
      url: 'https://rival.example/guides/espresso-machines',
      title: null,
      own: false,
      citations: 30,
    },
    { url: 'https://acme.example/guides/espresso', title: null, own: true, citations: 10 },
    { url: 'https://acme.example/blog/latte-art', title: null, own: true, citations: 20 },
    { url: 'https://www.reddit.com/r/espresso/x', title: null, own: false, citations: 20 },
  ],
  results: {
    visits: 1240,
    keyEvents: 48,
    transactions: 12,
    revenue: 3210.4,
    analytics: true,
    purchases: true,
  },
};

let container: HTMLDivElement;
let root: Root;

async function renderPage() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ContentPlanPage />
      </NextIntlClientProvider>,
    );
  });
}

const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.startsWith(name),
  )!;
const rowTexts = () =>
  [...container.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].slice(1, 4).map((td) => td.textContent),
  );

beforeEach(() => {
  brandState.activeBrandId = 'brand-1';
  window.history.replaceState(null, '', '/dashboard/content/plan');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getContentPlan.mockReset().mockResolvedValue(PLAN);
  getContentPlanInsights.mockReset().mockResolvedValue(INSIGHTS);
  dialog.props = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Content plan', () => {
  it('counts the work and ranks it, with why for the period', async () => {
    await renderPage();
    expect(getContentPlan).toHaveBeenCalledWith('brand-1', 30);
    expect(button('Create').textContent).toBe('Create1New pages AI needs');
    expect(button('Optimize').textContent).toBe('Optimize1Pages losing ground');
    expect(button('Protect').textContent).toBe('Protect1Top pages · edit with care');
    expect(button('Overlaps').textContent).toBe('Overlaps1Pages competing for the same prompts');

    expect(rowTexts()).toEqual([
      [
        'Office coffee subscriptionsNew page',
        'Create',
        'Daily Grind Co. and Origin Box cited · you 6%Opportunity',
      ],
      [
        'Coffee subscriptionsGuide/guides/coffee-subscriptions',
        'Optimize',
        'Citations −70% on ChatGPT and PerplexityCitations',
      ],
      [
        'Espresso guideGuide/guides/espresso⚠ Overlap',
        'Protect',
        'Top page · 12 citations · 42 AI visitsProtect',
      ],
    ]);
    expect(container.querySelector('thead')!.textContent).toContain('Why · last 30 days');
  });

  it('filters the list by a card, and clears it on a second click', async () => {
    await renderPage();
    await act(async () => button('Overlaps').click());
    expect(button('Overlaps').getAttribute('aria-pressed')).toBe('true');
    expect(rowTexts().map((r) => r[1])).toEqual(['Protect']);
    expect(container.textContent).toContain('Filtered · click it again to clear');

    await act(async () => button('Overlaps').click());
    expect(rowTexts()).toHaveLength(3);
  });

  it('reads the other periods, a quarter too, and keeps the period in the URL', async () => {
    await renderPage();
    await act(async () => button('Last 7 days').click());
    expect(getContentPlan).toHaveBeenLastCalledWith('brand-1', 7);
    expect(window.location.search).toBe('?days=7');
    expect(container.querySelector('thead')!.textContent).toContain('Why · last 7 days');

    await act(async () => button('Last 90 days').click());
    expect(getContentPlan).toHaveBeenLastCalledWith('brand-1', 90);
    expect(getContentPlanInsights).toHaveBeenLastCalledWith('brand-1', 90);
    expect(window.location.search).toBe('?days=90');
    expect(container.textContent).toContain('From AI visits · 90 full days to yesterday (UTC):');
  });

  it('opens on the period in the URL, read once', async () => {
    window.history.replaceState(null, '', '/dashboard/content/plan?days=7');
    await renderPage();
    expect(getContentPlan.mock.calls).toEqual([['brand-1', 7]]);
  });

  it('starts an opportunity for an existing page on that page', async () => {
    getContentPlan.mockResolvedValue({
      ...PLAN,
      pages: [],
      opportunities: [
        {
          ...opportunity,
          decision: 'optimize',
          targetPage: 'https://acme.example/pricing',
          targetTitle: 'Pricing',
        },
      ],
    });
    await renderPage();
    await act(async () => container.querySelector<HTMLButtonElement>('tbody tr button')!.click());
    expect(dialog.props).toMatchObject({
      preset: {
        kind: 'opportunity',
        id: 'o1',
        page: { url: 'https://acme.example/pricing', title: 'Pricing' },
      },
    });
  });

  it('starts a row in New content, or opens the draft already being written', async () => {
    getContentPlan.mockResolvedValue({
      ...PLAN,
      drafts: [
        {
          id: 'd1',
          author: 'agent',
          isMine: false,
          method: 'optimize',
          opportunityId: null,
          sourceUrl: 'https://acme.example/guides/espresso',
        },
      ],
    });
    await renderPage();
    const rows = container.querySelectorAll('tbody tr');

    await act(async () => rows[1].querySelector('button')!.click());
    expect(dialog.props).toMatchObject({
      open: true,
      preset: { kind: 'page', url: 'https://acme.example/guides/coffee-subscriptions' },
    });
    await act(async () => (dialog.props!.onOpenChange as (open: boolean) => void)(false));
    expect(dialog.props).toMatchObject({ open: false, preset: null });

    await act(async () => rows[0].querySelector('button')!.click());
    expect(dialog.props).toMatchObject({ preset: { kind: 'opportunity', id: 'o1', page: null } });

    expect(rows[2].textContent).toContain('Agent');
    expect(rows[2].querySelector('a')!.getAttribute('href')).toBe('/dashboard/content/editor/d1');
  });

  it('shows what AI visits brought in, and what AI cites by page type', async () => {
    await renderPage();
    expect(getContentPlanInsights).toHaveBeenCalledWith('brand-1', 30);
    expect(container.textContent).toContain(
      'From AI visits · 30 full days to yesterday (UTC):1,240 visits · 48 key events · 12 orders · 3,210 revenue',
    );
    const mix = container.querySelector('section[aria-labelledby="plan-mix-title"]')!;
    // AI's mix (guides 40 of 60 typed) against the brand's own pages' (guides 10 of 30).
    // The gap shows twice: under the shares on a phone, in its column on wider screens.
    expect([...mix.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Guide67% · 33%Gap · 1 pageGap · 1 page',
      'Blog post33% · 67%1 page',
    ]);
    expect(mix.querySelector('p')!.textContent).toBe(
      "The shares cover 50% of the period's AI citations: the most cited addresses whose type shows. Forums, encyclopedias, news and the long tail of less cited pages aren't in them.",
    );
  });

  it('filters the list by a page type, and clears it on a second click', async () => {
    await renderPage();
    const guide = () =>
      container.querySelector<HTMLButtonElement>(
        'section[aria-labelledby="plan-mix-title"] button',
      )!;
    await act(async () => guide().click());
    expect(guide().getAttribute('aria-pressed')).toBe('true');
    expect(rowTexts().map((r) => r[0])).toEqual([
      'Coffee subscriptionsGuide/guides/coffee-subscriptions',
      'Espresso guideGuide/guides/espresso⚠ Overlap',
    ]);
    await act(async () => guide().click());
    expect(rowTexts()).toHaveLength(3);
  });

  it('asks for Google Analytics to show what AI visitors did', async () => {
    getContentPlanInsights.mockResolvedValue({
      ...INSIGHTS,
      results: { ...INSIGHTS.results, analytics: false, purchases: false },
    });
    await renderPage();
    expect(container.textContent).toContain(
      'From AI visits · 30 full days to yesterday (UTC):1,240 visitsConnect Google Analytics to see what they did next.',
    );
    expect(
      [...container.querySelectorAll('a')]
        .find((a) => a.textContent === 'Connect Google Analytics')!
        .getAttribute('href'),
    ).toBe('/dashboard/traffic');
  });

  it('drops a page-type filter the period’s mix no longer lists, and a brand’s filters on switching', async () => {
    await renderPage();
    const guide = () =>
      container.querySelector<HTMLButtonElement>(
        'section[aria-labelledby="plan-mix-title"] button',
      )!;
    await act(async () => guide().click());
    await act(async () => button('Overlaps').click());
    expect(rowTexts()).toHaveLength(1);

    // The 7 days' mix has no guide: the list isn't filtered by it.
    getContentPlanInsights.mockResolvedValue({
      ...INSIGHTS,
      citations: [
        { url: 'https://acme.example/blog/latte-art', title: null, own: true, citations: 5 },
      ],
    });
    await act(async () => button('Last 7 days').click());
    await act(async () => button('Overlaps').click());
    expect(container.textContent).not.toContain('Filtered');
    expect(rowTexts()).toHaveLength(3);

    await act(async () => button('Overlaps').click());
    brandState.activeBrandId = 'brand-2';
    brandState.brands.push({ id: 'brand-2', siteType: 'b2b' });
    await renderPage();
    expect(button('Overlaps').getAttribute('aria-pressed')).toBe('false');
    brandState.brands.pop();
  });

  it('says when the earlier period is tracked only in part, or not at all', async () => {
    getContentPlan.mockResolvedValue({
      ...PLAN,
      tracking: { prevFrom: '2026-08-23', trackedSince: '2026-09-09' },
    });
    await renderPage();
    expect(container.textContent).toContain(
      'The 30 days before are tracked only since Sep 9: pages are compared per tracked answer.',
    );

    getContentPlan.mockResolvedValue({
      ...PLAN,
      answers: { cur: 100, prev: 0 },
      tracking: { prevFrom: '2026-04-24', trackedSince: '2026-09-09' },
    });
    await act(async () => button('Last 90 days').click());
    expect(container.textContent).toContain(
      "No page reads as losing ground yet: tracking began Sep 9, so the 90 days before aren't tracked to compare with.",
    );
  });

  it('reads the mix again with the period, not after a draft is sent', async () => {
    await renderPage();
    expect(getContentPlanInsights).toHaveBeenCalledTimes(1);
    await act(async () => (dialog.props!.onSent as () => void)());
    expect(getContentPlan).toHaveBeenCalledTimes(2);
    expect(getContentPlanInsights).toHaveBeenCalledTimes(1);
  });

  it('says so when the plan can’t be read, and tries again', async () => {
    getContentPlan.mockRejectedValueOnce(new Error('boom'));
    await renderPage();
    expect(container.textContent).toContain("Couldn't load the content plan.");
    await act(async () => button('Try again').click());
    expect(getContentPlan).toHaveBeenCalledTimes(2);
    expect(rowTexts()).toHaveLength(3);
  });
});
