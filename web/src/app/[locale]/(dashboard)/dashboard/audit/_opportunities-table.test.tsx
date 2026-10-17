import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditOpportunity, ExcludedPage } from '@/lib/actions/audits';
import { OPPORTUNITIES_STEP, OpportunitiesTable } from './_opportunities-table';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const opportunity = (over: Partial<AuditOpportunity> = {}): AuditOpportunity => ({
  key: 'acme.com/pricing',
  url: 'https://acme.com/pricing',
  path: '/pricing',
  title: 'Pricing',
  reasons: [
    {
      type: 'no_ai_traffic',
      signal: 'revenue',
      percentile: 95.4,
      citationState: 'targeted_not_cited',
    },
  ],
  pinned: false,
  running: false,
  aiVisits: 0,
  lastAudit: { at: '2026-10-14T12:00:00.000Z', score: 0.63, auditId: 'a1' },
  ...over,
});

const blog = opportunity({
  key: 'acme.com/blog',
  url: 'https://acme.com/blog',
  path: '/blog',
  reasons: [{ type: 'never_audited' }],
  pinned: true,
  aiVisits: 12,
  lastAudit: null,
});

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();
const onRestore = vi.fn();

function render(
  opportunities: AuditOpportunity[],
  {
    excluded = [] as ExcludedPage[],
    selected = new Set<string>(),
    toolbar = null as React.ReactNode,
  } = {},
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <OpportunitiesTable
          opportunities={opportunities}
          excluded={excluded}
          staleDays={90}
          selected={selected}
          onSelect={onSelect}
          onRestore={onRestore}
          toolbar={toolbar}
        />
      </NextIntlClientProvider>,
    );
  });
}

const rows = () => [...container.querySelectorAll('tbody > tr')];
const cells = (row: Element) => [...row.querySelectorAll('td')].map((td) => td.textContent?.trim());
const box = (label: string) =>
  container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('OpportunitiesTable', () => {
  it('shows each page with why, its AI visits and its last audit', () => {
    render([
      blog,
      opportunity(),
      opportunity({
        key: 'k3',
        path: '/compare',
        aiVisits: null,
        reasons: [{ type: 'stale_audit', days: 120 }],
      }),
    ]);

    expect(rows().map(cells)).toEqual([
      ['', '/blog', 'PinnedNever audited', '12', 'never'],
      ['', '/pricing', 'No AI trafficTop 5% by revenueTargeted, not cited', '0', 'Oct 14 · 63'],
      ['', '/compare', 'Audited 120 days ago', '—', 'Oct 14 · 63'],
    ]);
    // The page opens the live page; the last audit its report.
    const [pageLink] = rows()[1].querySelectorAll('a');
    expect(pageLink.getAttribute('href')).toBe('https://acme.com/pricing');
    expect(pageLink.getAttribute('target')).toBe('_blank');
    expect(rows()[1].querySelectorAll('a')[1].getAttribute('href')).toBe('/dashboard/audit/a1');
  });

  it('names the competitor cited on the prompts closest to a page', () => {
    render([
      opportunity({
        reasons: [
          { type: 'competitor_cited', prompts: 3, competitors: ['Crema Club', 'Northline'] },
        ],
      }),
      opportunity({
        key: 'k2',
        path: '/gifts',
        reasons: [{ type: 'competitor_cited', prompts: 1, competitors: ['Crema Club'] }],
      }),
    ]);
    expect(rows().map((r) => cells(r)[2])).toEqual([
      'Crema Club +1 cited on 3 prompts',
      'Crema Club cited on 1 prompt',
    ]);
  });

  it('selects pages not being audited, one by one or all shown', () => {
    const running = opportunity({ key: 'run', path: '/run', running: true, lastAudit: null });
    render([opportunity(), blog, running], {
      selected: new Set(['acme.com/blog']),
      toolbar: <div role="toolbar">bulk</div>,
    });

    expect(rows()[2].textContent).toContain('Running');
    expect(box('Select /run').disabled).toBe(true);
    expect(box('Select all opportunities shown').getAttribute('data-state')).toBe('indeterminate');
    expect(container.querySelector('[role=toolbar]')?.textContent).toBe('bulk');

    act(() => box('Select /pricing').click());
    expect(onSelect).toHaveBeenLastCalledWith(['acme.com/pricing'], true);
    act(() => box('Select all opportunities shown').click());
    expect(onSelect).toHaveBeenLastCalledWith(['acme.com/pricing', 'acme.com/blog'], true);
  });

  it('shows 50 pages at a time', () => {
    const many = Array.from({ length: OPPORTUNITIES_STEP + 5 }, (_, i) =>
      opportunity({ key: `p${i}`, path: `/p${i}` }),
    );
    render(many);
    expect(rows()).toHaveLength(OPPORTUNITIES_STEP);
    act(() => button('Show more')!.click());
    expect(rows()).toHaveLength(OPPORTUNITIES_STEP + 5);
    expect(button('Show more')).toBeUndefined();
  });

  it('lists the excluded pages on demand, each to restore', () => {
    render([opportunity()], {
      excluded: [
        { key: 'acme.com/legal', url: 'https://acme.com/legal', path: '/legal', title: null },
      ],
    });
    expect(container.textContent).toContain('1 excluded page');
    act(() => button('Show')!.click());
    act(() => button('Restore')!.click());
    expect(onRestore).toHaveBeenCalledWith(['https://acme.com/legal']);
  });

  it('says where opportunities come from when there are none', () => {
    render([]);
    expect(container.textContent).toContain('No pages to audit right now.');
    expect(container.textContent).toContain('not in 90 days');
    expect(container.querySelector('table')).toBeNull();
  });
});
