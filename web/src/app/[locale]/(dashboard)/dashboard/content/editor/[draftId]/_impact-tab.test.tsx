import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentImpact } from '@/lib/content/impact';
import { ImpactTab } from './_impact-tab';

const getContentImpact = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  getContentImpact: (...args: unknown[]) => getContentImpact(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = 'https://acme.example.com/pricing';

const impact = (over: Partial<ContentImpact> = {}): ContentImpact => ({
  citations: { cur: 45, prev: 30 },
  promptCounts: { cur: 1, prev: 2, lost: 1 },
  aiVisits: { cur: 4, prev: 2 },
  gscClicks: { cur: 12, prev: 0 },
  gscSince: '2026-01-01',
  prompts: [
    {
      id: 'p1',
      text: 'best crm for realtors',
      cur: 3,
      prev: 1,
      curPlatforms: ['chatgpt', 'perplexity'],
      prevPlatforms: ['chatgpt'],
    },
    {
      id: 'p2',
      text: 'crm pricing',
      cur: 0,
      prev: 2,
      curPlatforms: [],
      prevPlatforms: ['google-ai-overviews'],
    },
  ],
  overlap: [],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function render(pageUrl: string | null = PAGE) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ImpactTab brandId="b1" pageUrl={pageUrl} />
      </NextIntlClientProvider>,
    );
  });
}

const metric = (label: string) =>
  [...container.querySelectorAll('.grid > div')].find(
    (cell) => cell.firstElementChild?.textContent === label,
  )?.textContent;
const periodButton = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-20T12:00:00Z'), toFake: ['Date'] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getContentImpact.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('the Impact tab', () => {
  it('shows what the page earns over the last 30 days against the 30 before', async () => {
    getContentImpact.mockResolvedValue(impact());
    await render();

    expect(getContentImpact).toHaveBeenCalledWith('b1', PAGE, 30);
    expect(periodButton('30d').getAttribute('aria-pressed')).toBe('true');
    expect(metric('Citations')).toBe('Citations45+50%');
    expect(metric('AI visits')).toBe('AI visits4Low sample');
    expect(metric('Google clicks')).toBe('Google clicks12New');
    // One prompt cites it now, as two did before.
    expect(metric('Prompts cited')).toBe('Prompts cited1−1');
  });

  it('lists the prompts, the lost one with where it was cited', async () => {
    getContentImpact.mockResolvedValue(impact());
    await render();

    expect(container.textContent).toContain('Prompts cited · 1 · 1 lost');
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      'best crm for realtorsChatGPT, PerplexityCited 3×',
      'crm pricingWas cited on Google AI OverviewLost',
    ]);
    expect(
      container.querySelector('a[href^="/dashboard/citations/url"]')!.getAttribute('href'),
    ).toBe(`/dashboard/citations/url?u=${encodeURIComponent(PAGE)}`);
  });

  it('counts the prompts over all of them, not the list it shows', async () => {
    // The list is cut at 100 (lost prompts last); the counts come whole.
    getContentImpact.mockResolvedValue(impact({ promptCounts: { cur: 140, prev: 150, lost: 12 } }));
    await render();
    expect(metric('Prompts cited')).toBe('Prompts cited140−10');
    expect(container.textContent).toContain('Prompts cited · 140 · 12 lost');
  });

  it('names the brand’s other pages cited for the same prompts', async () => {
    getContentImpact.mockResolvedValue(impact());
    await render();
    expect(container.textContent).toContain('The only page cited for its prompt · no overlap');

    getContentImpact.mockResolvedValue(
      impact({ overlap: [{ page: 'https://acme.example.com/blog/crm-guide', prompts: 1 }] }),
    );
    await act(async () => periodButton('7d').click());
    expect(container.textContent).toContain('/blog/crm-guide1 of 1 prompt');
  });

  it('reads the period picked', async () => {
    getContentImpact.mockResolvedValue(impact());
    await render();
    await act(async () => periodButton('90d').click());
    expect(getContentImpact).toHaveBeenLastCalledWith('b1', PAGE, 90);
    expect(periodButton('90d').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('The last 90 days against the 90 before');
  });

  it('says when Search Console has no data, or doesn’t reach back far enough', async () => {
    getContentImpact.mockResolvedValue(impact({ gscSince: null }));
    await render();
    expect(metric('Google clicks')).toBe('Google clicks—No Search Console data');

    // 190 days of page data: 1y starts before it, so no change is shown.
    getContentImpact.mockResolvedValue(
      impact({ gscSince: '2026-04-14', gscClicks: { cur: 300, prev: 0 } }),
    );
    await act(async () => periodButton('1y').click());
    expect(metric('Google clicks')).toBe('Google clicks300—');
    expect(container.textContent).toContain('Search Console keeps 190 days of page data');
  });

  it('says when no prompt cited the page', async () => {
    getContentImpact.mockResolvedValue(
      impact({
        citations: { cur: 0, prev: 0 },
        promptCounts: { cur: 0, prev: 0, lost: 0 },
        prompts: [],
        overlap: [],
      }),
    );
    await render();
    expect(container.textContent).toContain('No tracked prompt cited this page');
    expect(container.textContent).not.toContain('no overlap');
  });

  it('offers to retry when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getContentImpact.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(impact());
    await render();
    expect(container.textContent).toContain("Couldn't load the page's impact.");

    await act(async () => periodButton('Retry').click());
    expect(getContentImpact).toHaveBeenCalledTimes(2);
    expect(metric('Citations')).toBe('Citations45+50%');
  });

  it('has nothing to measure for a new page', async () => {
    await render(null);
    expect(getContentImpact).not.toHaveBeenCalled();
    expect(container.textContent).toContain('This draft is a new page, not live yet');
  });
});
