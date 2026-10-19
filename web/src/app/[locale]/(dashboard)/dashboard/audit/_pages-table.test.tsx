import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditedPage, AuditTemplate } from '@/lib/actions/audits';
import { AuditPagesTable, groupPagesByTemplate, pageLabel } from './_pages-table';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push }),
}));

// Midday UTC, so the dates read the same in any timezone.
const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;

const page = (over: Partial<AuditedPage> = {}): AuditedPage => ({
  key: 'acme.com/pricing',
  host: 'acme.com',
  path: '/pricing',
  url: 'https://acme.com/pricing',
  auditId: 'a3',
  score: 0.63,
  previousScore: 0.58,
  status: 'improving',
  lastAuditedAt: at(14),
  trend: [0.5, 0.58, 0.63],
  issues: 14,
  runs: [
    {
      id: 'a3',
      url: 'https://acme.com/pricing',
      status: 'completed',
      totalScore: 0.63,
      createdAt: at(14),
    },
    {
      id: 'a2',
      url: 'https://acme.com/pricing',
      status: 'failed',
      totalScore: null,
      createdAt: at(10),
    },
    {
      id: 'a1',
      url: 'https://acme.com/pricing',
      status: 'completed',
      totalScore: 0.58,
      createdAt: at(1),
    },
  ],
  runCount: 3,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onLoadMore = vi.fn();
const onDeleteRun = vi.fn();
const onSelect = vi.fn();

function render(
  pages: AuditedPage[],
  total = pages.length,
  {
    selected = new Set<string>(),
    toolbar = null as React.ReactNode,
    templates = null as AuditTemplate[] | null,
  } = {},
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditPagesTable
          pages={pages}
          total={total}
          primaryHost="acme.com"
          loadingMore={false}
          onLoadMore={onLoadMore}
          onDeleteRun={onDeleteRun}
          selected={selected}
          onSelect={onSelect}
          headerAction={<button type="button">Export all</button>}
          toolbar={toolbar}
          templates={templates}
        />
      </NextIntlClientProvider>,
    );
  });
}

const rows = () => [...container.querySelectorAll('tbody > tr')];
const cells = (row: Element) => [...row.querySelectorAll('td')].map((td) => td.textContent?.trim());
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

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

describe('AuditPagesTable', () => {
  it('shows one row per page with its score, issues, status and last audit', () => {
    render([
      page(),
      page({
        key: 'acme.com/blog',
        path: '/blog',
        auditId: 'b1',
        score: 0.74,
        status: 'good',
        issues: 7,
        lastAuditedAt: at(2),
        trend: [0.74],
      }),
    ]);

    expect(container.querySelector('[data-slot=card-title]')?.textContent).toBe('Pages');
    expect(rows().map(cells)).toEqual([
      ['', '', '/pricing', '63', '14', 'Improving', 'Oct 14, 2026'],
      ['', '', '/blog', '74', '7', 'Good', 'Oct 2, 2026'],
    ]);
    // The score alone: no trend line next to it.
    expect(container.querySelectorAll('tbody svg[role=img]')).toHaveLength(0);
  });

  it("tags a page whose last audit was an auto-audit run's", () => {
    render([page({ lastAuditSource: 'auto' }), page({ key: 'acme.com/blog', path: '/blog' })]);
    expect(rows().map((row) => cells(row).at(-1))).toEqual(['Oct 14, 2026Auto', 'Oct 14, 2026']);
  });

  it('opens the latest report from the row, and the earlier audits from the arrow', () => {
    render([page()]);

    act(() => (rows()[0] as HTMLElement).click());
    expect(push).toHaveBeenCalledWith('/dashboard/audit/a3');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard/audit/a3');

    push.mockClear();
    const arrow = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(arrow.getAttribute('aria-label')).toBe('Show earlier audits of /pricing');
    act(() => arrow.click());
    expect(push).not.toHaveBeenCalled();
    expect(arrow.getAttribute('aria-expanded')).toBe('true');

    const history = document.getElementById(arrow.getAttribute('aria-controls')!)!;
    const runs = [...history.querySelectorAll('li')];
    expect(runs.map((li) => li.querySelectorAll('span')[1].textContent)).toEqual([
      '63',
      'Failed',
      '58',
    ]);
    expect(runs[0].textContent).toContain('Oct 14, 2026');
    expect(runs.map((li) => li.querySelector('a')?.getAttribute('href'))).toEqual([
      '/dashboard/audit/a3',
      '/dashboard/audit/a2',
      '/dashboard/audit/a1',
    ]);

    act(() => arrow.click());
    expect(document.getElementById(arrow.getAttribute('aria-controls')!)).toBeNull();
  });

  it('says how many older audits the history leaves out', () => {
    render([page({ runCount: 53 })]);
    act(() => (container.querySelector('button[aria-expanded]') as HTMLButtonElement).click());
    expect(container.textContent).toContain('50 older audits not shown');
  });

  it('shows a page that never completed, and one being re-audited', () => {
    render([
      page({
        key: 'acme.com/broken',
        path: '/broken',
        score: null,
        previousScore: null,
        status: 'failed',
        issues: null,
        trend: [],
      }),
      page({ status: 'running' }),
    ]);

    expect(rows().map(cells)).toEqual([
      ['', '', '/broken', '—', '—', 'Failed', 'Oct 14, 2026'],
      ['', '', '/pricing', '63', '14', 'Running', 'Oct 14, 2026'],
    ]);
    expect(rows()[1].querySelector('.animate-spin')).not.toBeNull();
  });

  it('loads more pages while some are left', () => {
    render([page()], 2);
    act(() => button('Load more').click());
    expect(onLoadMore).toHaveBeenCalledOnce();

    render([page()], 1);
    expect(button('Load more')).toBeUndefined();
  });
});

describe('AuditPagesTable selection', () => {
  const blog = page({ key: 'acme.com/blog', path: '/blog', auditId: 'b1' });
  const running = page({ key: 'acme.com/run', path: '/run', status: 'running' });
  const box = (label: string) =>
    container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;

  it('selects a page from its box without opening it, and all pages not being audited', () => {
    render([page(), blog, running]);

    act(() => box('Select /pricing').click());
    expect(onSelect).toHaveBeenLastCalledWith(['acme.com/pricing'], true);
    expect(push).not.toHaveBeenCalled();

    // A page being audited can't be selected, so Select all leaves it out.
    expect(box('Select /run').disabled).toBe(true);
    act(() => box('Select all pages shown').click());
    expect(onSelect).toHaveBeenLastCalledWith(['acme.com/pricing', 'acme.com/blog'], true);
  });

  it('marks the selection and shows the bulk bar and the header action', () => {
    render([page(), blog], 2, {
      selected: new Set(['acme.com/blog']),
      toolbar: <div role="toolbar">bulk</div>,
    });

    expect(box('Select /blog').getAttribute('data-state')).toBe('checked');
    expect(box('Select /pricing').getAttribute('data-state')).toBe('unchecked');
    expect(box('Select all pages shown').getAttribute('data-state')).toBe('indeterminate');
    expect(rows()[1].getAttribute('data-state')).toBe('selected');
    expect(container.querySelector('[role=toolbar]')?.textContent).toBe('bulk');
    expect(button('Export all')).toBeDefined();

    // Clearing every box asks for all of them off.
    render([page(), blog], 2, { selected: new Set(['acme.com/pricing', 'acme.com/blog']) });
    expect(box('Select all pages shown').getAttribute('data-state')).toBe('checked');
    act(() => box('Select all pages shown').click());
    expect(onSelect).toHaveBeenLastCalledWith(['acme.com/pricing', 'acme.com/blog'], false);
  });
});

describe('Group by template (SA-007)', () => {
  const blog: AuditTemplate = {
    template: '/blog/*',
    pages: 38,
    audited: 12,
    sharedGaps: [
      { key: 'author-byline', label: 'Author byline', category: 'authority', pages: 11 },
      { key: 'faq-schema', label: 'FAQ schema', category: 'structure', pages: 9 },
    ],
  };
  const guides: AuditTemplate = { template: '/guides/*', pages: 5, audited: 1, sharedGaps: [] };
  const post = (path: string, template: string | null) =>
    page({ key: `acme.com${path}`, path, url: `https://acme.com${path}`, template });

  it('groups the shown pages by template, biggest first, the rest under Other pages', () => {
    const pages = [
      post('/pricing', null),
      post('/guides/a', '/guides/*'),
      post('/blog/a', '/blog/*'),
      post('/blog/b', '/blog/*'),
      // A template under three pages isn't one: it goes with the rest.
      post('/docs/a', '/docs/*'),
    ];
    expect(
      groupPagesByTemplate(pages, [blog, guides]).map((g) => [
        g.template?.template ?? null,
        g.pages.map((p) => p.path),
      ]),
    ).toEqual([
      ['/blog/*', ['/blog/a', '/blog/b']],
      ['/guides/*', ['/guides/a']],
      [null, ['/pricing', '/docs/a']],
    ]);
  });

  it('heads each group with its pages and what one fix covers', () => {
    render([post('/pricing', null), post('/blog/a', '/blog/*')], 2, { templates: [blog, guides] });
    expect(rows().map((r) => r.textContent?.trim().slice(0, 120))).toEqual([
      '/blog/* · 12 of 38 pages audited · Fix once: Author byline, FAQ schema · applies to 38 pages',
      expect.stringContaining('/blog/a'),
      'Other pages',
      expect.stringContaining('/pricing'),
    ]);
  });

  it('lists the pages as before when grouping is off', () => {
    render([post('/pricing', null), post('/blog/a', '/blog/*')]);
    expect(rows()).toHaveLength(2);
    expect(container.textContent).not.toContain('Other pages');
  });
});

describe('pageLabel', () => {
  it("lists the brand's own pages by path and other sites by host", () => {
    expect(pageLabel({ host: 'acme.com', path: '/pricing' }, 'acme.com')).toBe('/pricing');
    expect(pageLabel({ host: 'acme.com', path: '/' }, 'acme.com')).toBe('/');
    expect(pageLabel({ host: 'other.com', path: '/' }, 'acme.com')).toBe('other.com');
    expect(pageLabel({ host: 'other.com', path: '/blog' }, 'acme.com')).toBe('other.com/blog');
    expect(pageLabel({ host: 'acme.com', path: '/blog' }, null)).toBe('acme.com/blog');
  });
});
