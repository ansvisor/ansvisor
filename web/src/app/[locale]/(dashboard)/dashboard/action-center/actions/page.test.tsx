import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brand } from '@/types';
import type { ActionItem } from '@/lib/actions/action-center';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

/**
 * The actions list's Export CSV (AC-005): it reads what each listed action's
 * Affected tab names, then downloads the list with it, as UTF-8 Excel reads.
 * Actions lists actions only: the set-up steps are Today's.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const brand: Brand = {
  id: 'brand-id',
  organizationId: 'organization-id',
  name: 'Acme',
  slug: 'acme',
  industry: 'Technology',
  region: 'US',
  shoppingModeEnabled: false,
  isActive: true,
  domains: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const action: ActionItem = {
  id: 'a1',
  actionNo: 35,
  category: 'recover',
  kind: 'recover_lost_citations',
  impact: 'high',
  status: 'new',
  payload: {},
  kpiKeys: [],
  assignee: null,
  dueDate: null,
  createdAt: '2026-10-16T09:05:31Z',
  updatedAt: '2026-10-16T09:05:31Z',
  taskTotal: 8,
  taskCompleted: 0,
  signalCount: 3,
  priorityScore: 90,
  priorityLevel: 'critical',
  priorityReason: null,
};

const { getActions, getActionsAffected, role, saveBlob, toast, firstRun } = vi.hoisted(() => ({
  getActions: vi.fn(),
  getActionsAffected: vi.fn(),
  role: { canManage: true },
  saveBlob: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  // Who listens for the end of the brand's first run.
  firstRun: { finished: new Set<(brandId: string) => void>() },
}));

// No white label kit: downloads keep Ansvisor's names (export-name.test.ts has a kit's).
vi.mock('@/lib/actions/white-label', () => ({
  getExportBranding: async () => ({ ok: true, branding: null }),
}));
vi.mock('next-intl', () => ({
  // Chat's "How do I finish …" names its action: the test reads which one.
  useTranslations: () => (key: string, values?: { title?: string }) =>
    key === 'actionHow' ? `${key}: ${values?.title}` : key,
}));
const setActiveBrand = vi.hoisted(() => vi.fn());
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (
    selector: (state: {
      getActiveBrand: () => Brand;
      brands: Brand[];
      setActiveBrand: (id: string) => void;
    }) => unknown,
  ) =>
    selector({
      getActiveBrand: () => brand,
      brands: [brand, { ...brand, id: 'other-brand' }],
      setActiveBrand,
    }),
}));
vi.mock('@/lib/actions/action-center', () => ({ getActions, getActionsAffected }));
// A row's Start now (AC plan P-3) reads its work through content-drafts, which needs the
// server's Supabase client; the list's rows are stubbed here.
vi.mock('@/components/action-center/start-now', () => ({
  useStartNow: () => ({ busy: false, start: vi.fn() }),
}));
vi.mock('@/lib/actions/content-drafts', () => ({ getStartNowWork: vi.fn() }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/hooks/use-first-run', () => ({
  onFirstRunFinished: (listener: (brandId: string) => void) => {
    firstRun.finished.add(listener);
    return () => firstRun.finished.delete(listener);
  },
}));
vi.mock('@/lib/actions/team', () => ({ listBrandMembers: vi.fn(async () => []) }));
vi.mock('@/lib/download', () => ({ saveBlob }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/action-center/action-center-tabs', () => ({ ActionCenterTabs: () => null }));
// The table as the page renders it: its rows in order, its sort, and where a header click goes.
const table = vi.hoisted(() => ({
  props: null as {
    actions: ActionItem[];
    sort?: string;
    onSortChange?: (sort: string) => void;
  } | null,
}));
vi.mock('@/components/action-center/action-table', () => ({
  ActionTable: (props: NonNullable<typeof table.props>) => {
    table.props = props;
    return null;
  },
}));
// The drawer as the page opens it: its action, and where it reports a change.
const drawer = vi.hoisted(() => ({
  props: null as {
    action: ActionItem | null;
    onPatched: (id: string, patch: Partial<ActionItem>) => void;
  } | null,
}));
vi.mock('@/components/action-center/action-drawer', () => ({
  ActionDrawer: (props: NonNullable<typeof drawer.props>) => {
    drawer.props = props;
    return null;
  },
}));
const { default: ActionCenterActionsPage } = await import('./page');
const { ChatPageSetterContext } = await import('@/components/chat/panel/chat-panel-context');

let container: HTMLDivElement;
let root: Root;

const exportButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'exportCsv')!;

const openUpgrade = vi.fn();
async function render(isLocked = false) {
  await act(async () =>
    root.render(
      <UpgradeDialogContext.Provider
        value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
      >
        <ActionCenterActionsPage />
      </UpgradeDialogContext.Provider>,
    ),
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  getActions.mockReset().mockResolvedValue([action]);
  role.canManage = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  getActionsAffected.mockReset();
  saveBlob.mockReset();
  toast.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Stale filter (00432)', () => {
  it('lists only New actions no one has worked on for a month, from the URL', async () => {
    window.history.replaceState(null, '', '/?status=stale');
    const stale: ActionItem = { ...action, id: 'a2', staleAt: '2026-10-31T03:00:00Z' };
    const leftNew: ActionItem = {
      ...action,
      id: 'a3',
      status: 'on_hold',
      staleAt: '2026-10-31T03:00:00Z',
    };
    getActions.mockResolvedValue([action, stale, leftNew]);
    getActionsAffected.mockResolvedValue({});
    await render();
    await act(async () => exportButton().click());
    expect(getActionsAffected).toHaveBeenLastCalledWith('brand-id', ['a2']);
  });
});

describe('the From Products chip (ECOM-013)', () => {
  const chip = () =>
    [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('fromProducts'),
    );
  const product: ActionItem = { ...action, id: 'a2', category: 'growth', kind: 'shopping_product' };
  const category: ActionItem = {
    ...action,
    id: 'a3',
    category: 'compete',
    kind: 'shopping_category',
  };

  it('lists only what Product Visibility sent, and lets it go on a second click', async () => {
    getActions.mockResolvedValue([action, product, category]);
    getActionsAffected.mockResolvedValue({});
    await render();
    expect(chip()!.textContent).toBe('fromProducts2');
    expect(chip()!.getAttribute('aria-pressed')).toBe('false');

    await act(async () => chip()!.click());
    expect(chip()!.getAttribute('aria-pressed')).toBe('true');
    await act(async () => exportButton().click());
    expect(getActionsAffected).toHaveBeenLastCalledWith('brand-id', ['a2', 'a3']);

    await act(async () => chip()!.click());
    await act(async () => exportButton().click());
    expect(getActionsAffected.mock.lastCall![1]).toHaveLength(3);
  });

  it('opens on it from the URL, and shows no chip without such an action', async () => {
    window.history.replaceState(null, '', '/?from=products');
    getActions.mockResolvedValue([action, product]);
    getActionsAffected.mockResolvedValue({});
    await render();
    expect(chip()!.getAttribute('aria-pressed')).toBe('true');
    await act(async () => exportButton().click());
    expect(getActionsAffected).toHaveBeenLastCalledWith('brand-id', ['a2']);

    act(() => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, '', '/');
    getActions.mockResolvedValue([action]);
    await render();
    expect(chip()).toBeUndefined();
  });

  it('shows the chip on from the URL with no such action left, to turn it off', async () => {
    window.history.replaceState(null, '', '/?from=products');
    getActions.mockResolvedValue([action]);
    getActionsAffected.mockResolvedValue({});
    await render();
    expect(chip()!.textContent).toBe('fromProducts0');
    expect(chip()!.getAttribute('aria-pressed')).toBe('true');

    await act(async () => chip()!.click());
    expect(chip()).toBeUndefined();
    await act(async () => exportButton().click());
    expect(getActionsAffected).toHaveBeenLastCalledWith('brand-id', ['a1']);
  });
});

describe('the actions list Export CSV', () => {
  it("adds each action's affected count and names, in a file Excel reads as UTF-8", async () => {
    getActionsAffected.mockResolvedValue({
      a1: { count: 3, items: ['Best coffee subscription?', 'Coffee delivery'] },
    });
    await render();
    await act(async () => exportButton().click());

    expect(getActionsAffected).toHaveBeenCalledWith('brand-id', ['a1']);
    const [blob, fileName] = saveBlob.mock.calls[0] as [Blob, string];
    expect(fileName).toMatch(/^ansvisor_acme_actions_\d{4}-\d{2}-\d{2}\.csv$/);
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const [header, row] = new TextDecoder().decode(bytes.slice(3)).split('\n');
    expect(header).toContain(',signal_count,affected_count,affected_items,created');
    expect(row).toContain(',3,3,Best coffee subscription?; Coffee delivery,');
    // Each row starts with the code the list shows and Chat names it by.
    expect(header.startsWith('number,')).toBe(true);
    expect(row.startsWith('AC-35,')).toBe(true);
    expect(exportButton().disabled).toBe(false);
  });

  it('says so when the affected items cannot be read, and downloads nothing', async () => {
    getActionsAffected.mockRejectedValue(new Error('offline'));
    await render();
    await act(async () => exportButton().click());

    expect(toast.error).toHaveBeenCalledWith('export.exportFailed');
    expect(saveBlob).not.toHaveBeenCalled();
    expect(exportButton().disabled).toBe(false);
  });

  it("holds the button while it reads, and drops the file once the brand's view is gone", async () => {
    let answer: (value: unknown) => void = () => {};
    getActionsAffected.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render();
    await act(async () => exportButton().click());
    expect(exportButton().disabled).toBe(true);

    act(() => root.unmount());
    await act(async () => answer({}));
    expect(saveBlob).not.toHaveBeenCalled();
    // Mounted again for afterEach's unmount.
    root = createRoot(container);
  });
});

const text = () => container.textContent ?? '';

describe('the actions list', () => {
  it('lists the actions only, with the five cards and the filters', async () => {
    await render();
    expect(text()).toContain('cards.priority');
    expect(text()).not.toContain('card.title');
    expect(exportButton()).toBeDefined();
  });

  it('reads the list again when the first run finishes, and once more for the first actions', async () => {
    await render();
    expect(getActions).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      // Another brand's run: nothing to read here.
      await act(async () => firstRun.finished.forEach((listener) => listener('other-brand')));
      expect(getActions).toHaveBeenCalledTimes(1);

      await act(async () => firstRun.finished.forEach((listener) => listener('brand-id')));
      expect(getActions).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });
      expect(getActions).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Chat's Open in Actions (actions/[id]) names the action's brand, so its drawer opens. */
  it('switches to the brand a link names, once, when it is one of the person’s', async () => {
    setActiveBrand.mockClear();
    window.history.replaceState(null, '', '/?action=a1&brand=other-brand');
    await render();
    expect(setActiveBrand).toHaveBeenCalledWith('other-brand');
    expect(setActiveBrand).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    root = createRoot(container);
    setActiveBrand.mockClear();
    window.history.replaceState(null, '', '/?action=a1&brand=not-theirs');
    await render();
    expect(setActiveBrand).not.toHaveBeenCalled();
  });

  /** Where actions/[id] sends a Chat answer's "AC-1497": its drawer, or none for an action not here. */
  it('opens the drawer of the action a link names, and none for one it doesn’t hold', async () => {
    const opened = () => drawer.props?.action?.id ?? null;
    window.history.replaceState(null, '', '/?action=a1&brand=brand-id');
    await render();
    expect(opened()).toBe('a1');
    act(() => root.unmount());
    root = createRoot(container);
    drawer.props = null;
    window.history.replaceState(null, '', '/?action=not-here&brand=brand-id');
    await render();
    expect(opened()).toBeNull();
  });

  it('keeps a category the URL names', async () => {
    window.history.replaceState(null, '', '/?category=recover');
    await render();
    expect(text()).toContain('cards.priority');
    expect(exportButton()).toBeDefined();
  });
});

describe('what Chat’s side panel sees (W1-08)', () => {
  it('tells the panel its filters, questions and the actions in view', async () => {
    const setPage = vi.fn();
    await act(async () =>
      root.render(
        <ChatPageSetterContext.Provider value={setPage}>
          <UpgradeDialogContext.Provider
            value={{ isLocked: false, reason: 'ended', adminName: null, openUpgrade }}
          >
            <ActionCenterActionsPage />
          </UpgradeDialogContext.Provider>
        </ChatPageSetterContext.Provider>,
      ),
    );
    const page = setPage.mock.lastCall![0];
    expect(page).toMatchObject({
      pageName: 'title',
      filters: [],
      referenceables: [{ type: 'task', id: action.id }],
    });
    expect(page.suggestions).toEqual(expect.arrayContaining(['actionsImpact', 'actionsWeek']));
    // And its view (the owner's plan, item 8): the default sort and the actions in view by code.
    expect(page.view).toEqual({
      sort: { key: 'updated', dir: 'desc' },
      rows: [{ ref: 'AC-35', label: expect.any(String) }],
      total: 1,
    });
    // Leaving the page takes it back.
    act(() => root.unmount());
    expect(setPage).toHaveBeenLastCalledWith(null);
    root = createRoot(container);
  });

  it('tells the panel the sort and search picked, and the rows on screen in that order (item 8)', async () => {
    const numbered = (n: number, priorityScore: number): ActionItem => ({
      ...action,
      id: `a${n}`,
      actionNo: n,
      brandNo: n,
      priorityScore,
    });
    getActions.mockResolvedValue([numbered(3, 40), numbered(7, 95), numbered(12, 60)]);
    const setPage = vi.fn();
    const renderWithPanel = async () => {
      act(() => root.unmount());
      root = createRoot(container);
      await act(async () =>
        root.render(
          <ChatPageSetterContext.Provider value={setPage}>
            <UpgradeDialogContext.Provider
              value={{ isLocked: false, reason: 'ended', adminName: null, openUpgrade }}
            >
              <ActionCenterActionsPage />
            </UpgradeDialogContext.Provider>
          </ChatPageSetterContext.Provider>,
        ),
      );
      return setPage.mock.lastCall![0].view;
    };
    window.history.replaceState(null, '', '/?sort=priority');
    const sorted = await renderWithPanel();
    expect(sorted).toMatchObject({ sort: { key: 'priority', dir: 'desc' }, total: 3 });
    // By the code the list shows (the brand's number), in the list's order.
    expect(sorted.rows.map((row: { ref: string }) => row.ref)).toEqual(['AC-07', 'AC-12', 'AC-03']);
    // A search that finds none: its words, no rows, and how many match.
    window.history.replaceState(null, '', '/?sort=priority_asc&q=nothing-like-this');
    expect(await renderWithPanel()).toEqual({
      sort: { key: 'priority', dir: 'asc' },
      search: 'nothing-like-this',
      rows: [],
      total: 0,
    });
    // Before the list is read: no rows and no count yet.
    getActions.mockReturnValue(new Promise(() => {}));
    window.history.replaceState(null, '', '/?sort=due_date');
    expect(await renderWithPanel()).toEqual({ sort: { key: 'due_date', dir: 'asc' } });
  });

  it('asks how to finish the first of the Top actions, whatever order the list came in', async () => {
    const opportunity = (id: string, title: string, priorityScore: number): ActionItem => ({
      ...action,
      id,
      kind: 'content_opportunity',
      payload: { title },
      priorityScore,
    });
    getActions.mockResolvedValue([
      opportunity('low', 'Low one', 20),
      opportunity('high', 'High one', 95),
      opportunity('mid', 'Mid one', 60),
    ]);
    const setPage = vi.fn();
    await act(async () =>
      root.render(
        <ChatPageSetterContext.Provider value={setPage}>
          <UpgradeDialogContext.Provider
            value={{ isLocked: false, reason: 'ended', adminName: null, openUpgrade }}
          >
            <ActionCenterActionsPage />
          </UpgradeDialogContext.Provider>
        </ChatPageSetterContext.Provider>,
      ),
    );
    expect(setPage.mock.lastCall![0].suggestions[0]).toBe('actionHow: High one');
  });
});

/**
 * Owner's feedback (14 Nov): the list opens on the date it shows, Updated,
 * most recent first; Newest (by creation, shown nowhere) is gone, its old
 * links landing on the one date sort; the Updated header flips it.
 */
describe('the list’s order', () => {
  const at = (id: string, actionNo: number, updatedAt: string, createdAt: string): ActionItem => ({
    ...action,
    id,
    actionNo,
    updatedAt,
    createdAt,
  });
  // Created newest first, but updated in another order: Newest used to list a, b, c.
  const rows = [
    at('a', 3, '2026-10-29T00:00:00+00:00', '2026-11-01T00:00:00+00:00'),
    at('b', 2, '2026-11-09T00:00:00+00:00', '2026-10-20T00:00:00+00:00'),
    at('c', 1, '2026-11-08T00:00:00+00:00', '2026-10-10T00:00:00+00:00'),
  ];
  const ids = () => table.props!.actions.map((row) => row.id);
  const sortParam = () => new URLSearchParams(window.location.search).get('sort');
  /** The URL is written 300ms after a change. */
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    table.props = null;
    getActions.mockResolvedValue(rows);
  });
  afterEach(() => vi.useRealTimers());

  it('opens on the most recently updated first, with no sort in the URL', async () => {
    await render();
    expect(table.props!.sort).toBe('updated');
    expect(ids()).toEqual(['b', 'c', 'a']);
    expect(text()).toContain('sort.updated');
    await settle();
    expect(sortParam()).toBeNull();
  });

  it('takes an old link’s ?sort=newest to the same date sort', async () => {
    window.history.replaceState(null, '', '/?sort=newest&status=new');
    await render();
    expect(table.props!.sort).toBe('updated');
    expect(ids()).toEqual(['b', 'c', 'a']);
    await settle();
    expect(sortParam()).toBeNull();
    expect(new URLSearchParams(window.location.search).get('status')).toBe('new');
  });

  it('turns the other way round on a header click, and back, in the URL', async () => {
    await render();
    await act(async () => table.props!.onSortChange!('updated_asc'));
    expect(ids()).toEqual(['a', 'c', 'b']);
    expect(table.props!.sort).toBe('updated_asc');
    expect(text()).toContain('sort.updated_asc');
    await settle();
    expect(sortParam()).toBe('updated_asc');

    await act(async () => table.props!.onSortChange!('updated'));
    expect(ids()).toEqual(['b', 'c', 'a']);
    await settle();
    expect(sortParam()).toBeNull();
  });

  it('keeps a sort the URL names, Priority included', async () => {
    window.history.replaceState(null, '', '/?sort=updated_asc');
    await render();
    expect(ids()).toEqual(['a', 'c', 'b']);

    act(() => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, '', '/?sort=priority');
    getActions.mockResolvedValue([
      { ...rows[0], priorityScore: 40 },
      { ...rows[1], priorityScore: 10 },
      { ...rows[2], priorityScore: 70 },
    ]);
    await render();
    expect(table.props!.sort).toBe('priority');
    expect(ids()).toEqual(['c', 'a', 'b']);
    await settle();
    expect(sortParam()).toBe('priority');
  });
});

/** Owner's feedback (14 Nov): Chat says "AC-251"; the list's search finds it. */
describe('finding an action by its code', () => {
  const numbered = (id: string, actionNo: number): ActionItem => ({ ...action, id, actionNo });
  const ids = () => table.props?.actions.map((row) => row.id) ?? [];

  beforeEach(() => {
    getActions.mockResolvedValue([
      numbered('n251', 251),
      numbered('n2510', 2510),
      numbered('n1251', 1251),
      numbered('n25', 25),
    ]);
  });

  for (const query of ['AC-251', 'ac-251', '251']) {
    it(`lists only AC-251 for “${query}”`, async () => {
      table.props = null;
      window.history.replaceState(null, '', `/?q=${encodeURIComponent(query)}`);
      await render();
      expect(ids()).toEqual(['n251']);
    });
  }

  it('lists nothing for a number no action has, and every action without a search', async () => {
    table.props = null;
    window.history.replaceState(null, '', '/?q=AC-999');
    await render();
    expect(table.props).toBeNull();
    expect(text()).toContain('noResults');

    act(() => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, '', '/');
    await render();
    expect(ids()).toHaveLength(4);
  });
});
