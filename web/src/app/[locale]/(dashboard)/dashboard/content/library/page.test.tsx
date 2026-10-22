import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import { libraryTabCounts, type ContentDraftListItem } from '@/lib/content/drafts';
import ContentLibraryPage from './page';

const getContentDrafts = vi.fn();
const getContentStartOptions = vi.fn();
const markContentDraftReady = vi.fn();
const setContentDraftStatus = vi.fn();
const archiveContentDraft = vi.fn();
const deleteContentDraft = vi.fn();
const getContentDraftPages = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  getContentDraftPages: (...args: unknown[]) => getContentDraftPages(...args),
  // A list stands for a brand under the cap: its tabs count its rows.
  getContentDrafts: async (...args: unknown[]) => {
    const read = await getContentDrafts(...args);
    return Array.isArray(read) ? { drafts: read, counts: libraryTabCounts(read) } : read;
  },
  getContentStartOptions: (...args: unknown[]) => getContentStartOptions(...args),
  createContentDraft: vi.fn(),
  markContentDraftReady: (...args: unknown[]) => markContentDraftReady(...args),
  setContentDraftStatus: (...args: unknown[]) => setContentDraftStatus(...args),
  archiveContentDraft: (...args: unknown[]) => archiveContentDraft(...args),
  deleteContentDraft: (...args: unknown[]) => deleteContentDraft(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
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
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('@/lib/download', () => ({ saveBlob }));

/** jsdom's Blob has no text(): read it as a browser's FileReader would. */
const readText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
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
  agentState: null,
  createdAt: '2026-10-18T09:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  archivedAt: null,
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
  toast.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  markContentDraftReady.mockReset().mockResolvedValue({ status: 'ready', tasksDone: 0 });
  setContentDraftStatus.mockReset().mockResolvedValue(undefined);
  archiveContentDraft.mockReset().mockResolvedValue(undefined);
  deleteContentDraft.mockReset().mockResolvedValue(undefined);
  getContentDraftPages.mockReset().mockImplementation(async (_brand: string, ids: string[]) =>
    ids.map((id) => ({
      id,
      title: 'Pipeline forecasting',
      bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams trust it.</p>',
      sourceUrl: 'https://acme.example/pricing',
    })),
  );
  saveBlob.mockReset();
  role.canManage = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Content Library', () => {
  it('lists the brand’s drafts with who wrote them, and counts each tab', async () => {
    // Dates this year read "Oct 18"; an older one keeps its year.
    vi.useFakeTimers({ now: new Date('2026-10-22T12:00:00Z'), toFake: ['Date'] });
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
      }),
      row({
        id: 'd3',
        title: '',
        status: 'published',
        isMine: false,
        createdBy: { id: 'u2', fullName: null, avatarUrl: null, email: 'grace@acme.com' },
        createdAt: '2025-12-30T10:00:00Z',
      }),
    ]);
    await renderPage();
    vi.useRealTimers();

    expect(getContentDrafts).toHaveBeenCalledWith('brand-1');
    expect(tab('All').textContent).toBe('All3');
    expect(tab('In review').textContent).toBe('In review2');
    expect(tab('Ready').textContent).toBe('Ready0');

    const rows = [...container.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    // Created and Updated where the AEO score was; the last cell is the row menu.
    expect(rows[0]).toEqual([
      'Pipeline forecasting',
      'Feature page',
      'Optimize',
      'AL' + 'You',
      'In review',
      'Oct 18',
      'Oct 20',
      '',
    ]);
    expect(rows[1].slice(0, 5)).toEqual([
      'Northwind vs HubSpot',
      'Comparison',
      'Create',
      'Content Agent',
      'In review',
    ]);
    // No title yet; a teammate with no name is named by e-mail.
    expect(rows[2][0]).toBe('Untitled');
    expect(rows[2][3]).toBe('Ggrace@acme.com');
    expect(rows[2][5]).toBe('Dec 30, 2025');
    expect([...container.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Content',
      'Type',
      'Method',
      'By',
      'Status',
      'Created',
      'Updated',
      'Row actions',
    ]);

    const link = container.querySelector('tbody a')!;
    expect(link.getAttribute('href')).toBe('/dashboard/content/editor/d1');
  });

  it('counts each tab in all past the cap, and says the list holds the latest', async () => {
    getContentDrafts.mockResolvedValue({
      drafts: [row({}), row({ id: 'd2', status: 'published' })],
      counts: { all: 812, draft: 300, in_review: 12, ready: 0, published: 500, archived: 3 },
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

describe('a Library row’s menu (00233)', () => {
  const menuItems = async (title: string) => {
    const trigger = container.querySelector<HTMLElement>(`[aria-label="Actions for ${title}"]`)!;
    await act(async () => trigger.click());
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };
  const pick = async (title: string, item: string) => {
    const found = (await menuItems(title)).find((el) => el.textContent === item)!;
    await act(async () => found.click());
  };

  it('sets a status, Ready as the editor’s Mark ready, and reads the list again', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    const items = await menuItems('Pipeline forecasting');
    expect(items.map((el) => el.textContent)).toEqual([
      'In progress',
      'In review',
      'Ready',
      'Published',
      'Export Word',
      'Export HTML',
      'Export Markdown',
      'Send to Archive',
      'Delete',
    ]);
    // Its own status is the one already set.
    expect(items[1].hasAttribute('data-disabled')).toBe(true);

    await act(async () => items[2].click());
    expect(markContentDraftReady).toHaveBeenCalledWith('d1');
    expect(getContentDrafts).toHaveBeenCalledTimes(2);

    await pick('Pipeline forecasting', 'Published');
    expect(setContentDraftStatus).toHaveBeenCalledWith('d1', 'published');
  });

  it('lets members set a status only', async () => {
    role.canManage = false;
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    expect((await menuItems('Pipeline forecasting')).map((el) => el.textContent)).toEqual([
      'In progress',
      'In review',
      'Ready',
      'Published',
      'Export Word',
      'Export HTML',
      'Export Markdown',
    ]);
  });

  it('archives with an Undo, and keeps archived drafts under Archived, to restore', async () => {
    getContentDrafts.mockResolvedValue([
      row({}),
      row({ id: 'd2', title: 'Old pricing page', archivedAt: '2026-10-21T08:00:00Z' }),
    ]);
    await renderPage();
    expect(tab('All').textContent).toBe('All1');
    expect(tab('Archived').textContent).toBe('Archived1');
    expect(container.textContent).not.toContain('Old pricing page');

    await pick('Pipeline forecasting', 'Send to Archive');
    expect(archiveContentDraft).toHaveBeenCalledWith('d1', true);
    expect(toast).toHaveBeenCalledWith('Archived: Pipeline forecasting', {
      action: { label: 'Undo', onClick: expect.any(Function) },
    });
    await act(async () => toast.mock.calls[0][1].action.onClick());
    expect(archiveContentDraft).toHaveBeenLastCalledWith('d1', false);

    await act(async () => tab('Archived').click());
    expect(container.textContent).toContain('Old pricing page');
    await pick('Old pricing page', 'Restore');
    expect(archiveContentDraft).toHaveBeenLastCalledWith('d2', false);
  });

  it('deletes only once confirmed', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    await pick('Pipeline forecasting', 'Delete');
    expect(deleteContentDraft).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Delete “Pipeline forecasting”?');

    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Delete',
    )!;
    await act(async () => confirm.click());
    expect(deleteContentDraft).toHaveBeenCalledWith('d1');
    expect(toast.success).toHaveBeenCalledWith('Deleted: Pipeline forecasting');
    expect(getContentDrafts).toHaveBeenCalledTimes(2);
  });

  it('says what to do when a newer draft does the same work as the one restored', async () => {
    archiveContentDraft.mockRejectedValue(new Error('newer_draft'));
    getContentDrafts.mockResolvedValue([row({ archivedAt: '2026-10-21T10:00:00Z' })]);
    window.history.replaceState(null, '', '/dashboard/content/library?tab=archived');
    await renderPage();
    await pick('Pipeline forecasting', 'Restore');
    expect(toast.error).toHaveBeenCalledWith(
      "A newer draft does this task's work. Archive or delete it first, then restore this one.",
    );
  });

  it('exports one draft’s page, as the editor’s Export', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    await pick('Pipeline forecasting', 'Export Markdown');
    await act(async () => {});
    expect(getContentDraftPages).toHaveBeenCalledWith('brand-1', ['d1']);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('ansvisor_content_pipeline-forecasting.md');
    expect(await readText(blob)).toBe('# Pipeline forecasting\n\nTeams trust it.\n');
  });

  it('says so when the server refuses the archive', async () => {
    archiveContentDraft.mockRejectedValue(new Error('forbidden'));
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    await pick('Pipeline forecasting', 'Send to Archive');
    expect(toast.error).toHaveBeenCalledWith(
      'Only admins and managers can archive or delete content.',
    );
  });
});

describe('the Library’s Export and Created filter (CE-002)', () => {
  const openExport = async () => {
    const trigger = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Export',
    )!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };

  it('exports the drafts listed, with their pages, as CSV', async () => {
    getContentDrafts.mockResolvedValue([
      row({}),
      row({ id: 'd2', title: 'Churn guide', author: 'agent', status: 'ready' }),
    ]);
    await renderPage();
    const items = await openExport();
    expect(items.map((el) => el.textContent)).toEqual([
      'Export CSV',
      'Export Excel',
      'Export Word',
    ]);
    await act(async () => items[0].click());
    await act(async () => {});

    expect(getContentDraftPages).toHaveBeenCalledWith('brand-1', ['d1', 'd2']);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toMatch(/^ansvisor_content_library_all_\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readText(blob);
    expect(csv).toContain(
      'Pipeline forecasting,In review,Optimize,Feature page,Ada Lovelace,2026-10-18',
    );
    expect(csv).toContain('Churn guide,Ready,Optimize,Feature page,Content Agent');
    expect(csv).toContain('Teams trust it.');
  });

  it('lists only the drafts created in the range the URL names, and exports those', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?created=7d');
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    getContentDrafts.mockResolvedValue([
      row({ id: 'new', title: 'Fresh page', createdAt: recent }),
      row({ id: 'old', title: 'Old page', createdAt: '2026-01-05T09:00:00Z' }),
    ]);
    await renderPage();
    expect(container.textContent).toContain('Fresh page');
    expect(container.textContent).not.toContain('Old page');

    const items = await openExport();
    await act(async () => items[0].click());
    await act(async () => {});
    expect(getContentDraftPages).toHaveBeenCalledWith('brand-1', ['new']);
  });

  it('says when nothing in the tab was created in the range', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?created=30d');
    getContentDrafts.mockResolvedValue([row({ createdAt: '2026-01-05T09:00:00Z' })]);
    await renderPage();
    expect(container.textContent).toContain('Nothing in this tab was created in this period.');
    const exportButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Export',
    )!;
    expect(exportButton.disabled).toBe(true);
  });
});
