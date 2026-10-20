import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { ContentDraftListItem } from '@/lib/content/drafts';
import ContentLibraryPage from './page';

const getContentDrafts = vi.fn();
const createContentDraft = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  getContentDrafts: (...args: unknown[]) => getContentDrafts(...args),
  createContentDraft: (...args: unknown[]) => createContentDraft(...args),
}));
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
const brandState = vi.hoisted(() => ({ activeBrandId: 'brand-1' as string | null }));
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
  createContentDraft.mockReset();
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

  it('starts a blank draft and opens it in the editor', async () => {
    getContentDrafts.mockResolvedValue([]);
    createContentDraft.mockResolvedValue('d9');
    await renderPage();
    const newContent = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'New content',
    )!;
    await act(async () => newContent.click());
    expect(createContentDraft).toHaveBeenCalledWith('brand-1');
    expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d9');
  });

  it('says so when a draft can’t be started', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getContentDrafts.mockResolvedValue([]);
    createContentDraft.mockRejectedValue(new Error('denied'));
    await renderPage();
    const newContent = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'New content',
    )!;
    await act(async () => newContent.click());
    expect(push).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Couldn't start a draft. Try again.");
    expect(newContent.disabled).toBe(false);
    error.mockRestore();
  });

  it('asks for a brand when none is selected', async () => {
    brandState.activeBrandId = null;
    await renderPage();
    expect(getContentDrafts).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Select a brand to see its content.');
  });
});
