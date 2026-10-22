import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import { libraryTabCounts, type ContentDraftListItem } from '@/lib/content/drafts';
import ContentLibraryPage from './page';

const getContentDrafts = vi.fn();
const getContentStartOptions = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  // A list stands for a brand under the cap: its tabs count its rows.
  getContentDrafts: async (...args: unknown[]) => {
    const read = await getContentDrafts(...args);
    return Array.isArray(read) ? { drafts: read, counts: libraryTabCounts(read) } : read;
  },
  getContentStartOptions: (...args: unknown[]) => getContentStartOptions(...args),
  createContentDraft: vi.fn(),
}));
// Start's Team: its assignee picker reads the team, and the sent task is assigned.
vi.mock('@/lib/actions/team', () => ({ listMembers: vi.fn(async () => []) }));
vi.mock('@/lib/actions/action-center', () => ({ assignAction: vi.fn() }));
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const brandState = vi.hoisted(() => ({
  activeBrandId: 'brand-1' as string | null,
  brands: [{ id: 'brand-1', industry: 'Travel & Hospitality', shoppingModeEnabled: false }],
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: typeof brandState) => unknown) => selector(brandState),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const row = (over: Partial<ContentDraftListItem>): ContentDraftListItem => ({
  id: 'd1',
  title: 'Pipeline forecasting',
  pageType: 'feature_page',
  method: 'optimize',
  status: 'in_review',
  author: 'user',
  createdBy: { id: 'u1', fullName: 'Ada Lovelace', avatarUrl: null },
  isMine: true,
  scoreBefore: 62,
  scoreAfter: 78,
  agentState: null,
  updatedAt: '2026-10-20T10:00:00Z',
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function renderPage() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ContentLibraryPage />
      </NextIntlClientProvider>,
    );
  });
}

const tab = (name: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) =>
    el.textContent?.startsWith(name),
  )!;

beforeEach(() => {
  brandState.activeBrandId = 'brand-1';
  window.history.replaceState(null, '', '/dashboard/content/library');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getContentDrafts.mockReset();
  getContentStartOptions.mockReset().mockResolvedValue({
    opportunities: [],
    prompts: [],
    promptsSeen: 0,
    topics: [],
  });
  push.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Content Library', () => {
  it('lists the brand’s drafts with who wrote them, and counts each tab', async () => {
    getContentDrafts.mockResolvedValue([
      row({}),
      row({
        id: 'd2',
        title: 'Northwind vs HubSpot',
        pageType: 'comparison',
        method: 'create',
        author: 'agent',
        createdBy: null,
        isMine: false,
        scoreBefore: null,
        scoreAfter: null,
      }),
      row({
        id: 'd3',
        title: '',
        status: 'published',
        isMine: false,
        createdBy: { id: 'u2', fullName: null, avatarUrl: null, email: 'grace@acme.com' },
        scoreBefore: 81,
        scoreAfter: null,
      }),
    ]);
    await renderPage();

    expect(getContentDrafts).toHaveBeenCalledWith('brand-1');
    expect(tab('All').textContent).toBe('All3');
    expect(tab('In review').textContent).toBe('In review2');
    expect(tab('Ready').textContent).toBe('Ready0');

    const rows = [...container.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(rows[0]).toEqual([
      'Pipeline forecasting',
      'Feature page',
      'Optimize',
      'AL' + 'You',
      'In review',
      '62 → 78',
    ]);
    expect(rows[1]).toEqual([
      'Northwind vs HubSpot',
      'Comparison',
      'Create',
      'Content Agent',
      'In review',
      '—',
    ]);
    // No title yet; a teammate with no name is named by e-mail.
    expect(rows[2][0]).toBe('Untitled');
    expect(rows[2][3]).toBe('Ggrace@acme.com');
    expect(rows[2][5]).toBe('81');

    const link = container.querySelector('tbody a')!;
    expect(link.getAttribute('href')).toBe('/dashboard/content/editor/d1');
  });

  it('counts each tab in all past the cap, and says the list holds the latest', async () => {
    getContentDrafts.mockResolvedValue({
      drafts: [row({}), row({ id: 'd2', status: 'published' })],
      counts: { all: 812, draft: 300, in_review: 12, ready: 0, published: 500 },
    });
    await renderPage();
    expect(tab('All').textContent).toBe('All812');
    expect(tab('Published').textContent).toBe('Published500');
    expect(container.textContent).toContain('Showing the 2 changed most recently of 812.');

    await act(async () => {
      tab('Ready').click();
    });
    expect(container.textContent).not.toContain('changed most recently');
  });

  it('shows a tab’s drafts only, and keeps the tab in the URL', async () => {
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', status: 'published' })]);
    await renderPage();

    await act(async () => {
      tab('Published').click();
    });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(window.location.search).toBe('?tab=published');

    await act(async () => {
      tab('Ready').click();
    });
    expect(container.textContent).toContain('Nothing marked ready.');
  });

  it('shows where the Content Agent is, and reads the list again while it writes', async () => {
    vi.useFakeTimers();
    try {
      getContentDrafts.mockResolvedValue([
        row({ status: 'draft', author: 'agent', agentState: 'writing' }),
        row({ id: 'd2', status: 'draft', agentState: 'failed' }),
        // Written by hand after the agent failed, and marked ready.
        row({ id: 'd3', status: 'ready', agentState: 'failed' }),
      ]);
      await renderPage();
      const status = [...container.querySelectorAll('tbody tr')].map(
        (tr) => tr.querySelectorAll('td')[4].textContent,
      );
      expect(status).toEqual(['Agent writing…', 'Agent failed', 'Ready']);
      expect(getContentDrafts).toHaveBeenCalledTimes(1);

      getContentDrafts.mockResolvedValue([row({ status: 'in_review', author: 'agent' })]);
      await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
      expect(getContentDrafts).toHaveBeenCalledTimes(2);
      expect(container.querySelector('tbody tr td:nth-child(5)')!.textContent).toBe('In review');
      await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
      expect(getContentDrafts).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the tab the URL names', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?tab=in_review');
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', status: 'draft' })]);
    await renderPage();
    expect(tab('In review').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('says what the Library is for while it is empty', async () => {
    getContentDrafts.mockResolvedValue([]);
    await renderPage();
    expect(container.textContent).toContain('Nothing written yet');
    expect(container.textContent).toContain(
      'Pages you and the Content Agent write or change in Ansvisor show up here.',
    );
  });

  it('offers a retry when the read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getContentDrafts.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([row({})]);
    await renderPage();
    expect(container.textContent).toContain("Couldn't load the Library.");

    const retry = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    )!;
    await act(async () => {
      retry.click();
    });
    expect(getContentDrafts).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    error.mockRestore();
  });

  it('opens New content for the brand', async () => {
    getContentDrafts.mockResolvedValue([]);
    await renderPage();
    const newContent = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'New content',
    )!;
    await act(async () => newContent.click());
    expect(getContentStartOptions).toHaveBeenCalledWith('brand-1');
    expect(document.body.textContent).toContain('Pick how you want to start.');
    expect(push).not.toHaveBeenCalled();
  });

  it('asks for a brand when none is selected', async () => {
    brandState.activeBrandId = null;
    await renderPage();
    expect(getContentDrafts).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Select a brand to see its content.');
  });
});
