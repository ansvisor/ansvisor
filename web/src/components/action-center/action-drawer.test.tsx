import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionItem } from '@/lib/actions/action-center';
import type { Signal } from '@/lib/signals/map';
import { promptVolumeEstimate } from '@/lib/volume-estimate';
import messages from '../../../messages/en.json';

/**
 * Status, assignee and due date sit right under the drawer's header, ahead of
 * the tabs, rather than in a footer below the content: they are what someone
 * opening an action checks and changes first.
 */

const server = vi.hoisted(() => ({
  addTask: vi.fn(),
  assignAction: vi.fn(),
  deleteTask: vi.fn(),
  getActionDetail: vi.fn(),
  getPromptDemand: vi.fn(),
  setActionDueDate: vi.fn(),
  updateActionStatus: vi.fn(),
  updateTaskStatus: vi.fn(),
  updateTaskTitle: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
const push = vi.hoisted(() => vi.fn());
const drafts = vi.hoisted(() => ({ getActionDrafts: vi.fn(), startDraftFromAction: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/actions/action-center', () => server);
vi.mock('@/lib/actions/content-drafts', () => drafts);
vi.mock('sonner', () => ({ toast }));

const { ActionDrawer } = await import('./action-drawer');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const action: ActionItem = {
  id: 'a1',
  actionNo: 7,
  category: 'recover',
  kind: 'recover_lost_citations',
  impact: 'high',
  priorityScore: 72,
  priorityLevel: 'high',
  priorityReason: null,
  status: 'in_progress',
  payload: {},
  kpiKeys: [],
  assignee: null,
  dueDate: '2026-11-01',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  taskTotal: 0,
  taskCompleted: 0,
  signalCount: 1,
};

let container: HTMLDivElement;
let root: Root;
const onChanged = vi.fn();
const onPatched = vi.fn();

const emptyDetail = { tasks: [], signals: [], events: [], kpis: [], positionOutcome: null };

beforeEach(() => {
  vi.clearAllMocks();
  server.getActionDetail.mockResolvedValue(emptyDetail);
  drafts.getActionDrafts.mockResolvedValue([]);
  for (const fn of [server.addTask, server.setActionDueDate]) fn.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderDrawer(shown: ActionItem = action) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ActionDrawer
          brandId="b1"
          action={shown}
          members={[]}
          onOpenChange={() => {}}
          onChanged={onChanged}
          onPatched={onPatched}
        />
      </NextIntlClientProvider>,
    );
  });
}

/** True when `a` comes before `b` in the document. */
const before = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('ActionDrawer', () => {
  it('puts status, assignee and due date under the header, ahead of the tabs', async () => {
    await renderDrawer();
    const drawer = document.body.querySelector('[role="dialog"]')!;
    const labels = [...drawer.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toEqual(['Status', 'Assignee', 'Due date']);

    const tabs = drawer.querySelector('nav')!;
    for (const label of drawer.querySelectorAll('label')) {
      expect(before(label, tabs)).toBe(true);
    }
    // Each field once (no second copy below the content), named by its label.
    for (const label of drawer.querySelectorAll('label')) {
      const control = drawer.querySelectorAll(`#${label.htmlFor}`);
      expect(control).toHaveLength(1);
    }
    expect(drawer.querySelector<HTMLInputElement>('#action-drawer-due-date')!.value).toBe(
      '2026-11-01',
    );
  });

  it("gives the Why the demand of a signal's prompt the action didn't keep", async () => {
    const lost = (id: string, promptId: string, promptText: string) =>
      ({
        id,
        category: 'citation',
        kind: 'lost_citations',
        impact: 'high',
        status: 'new',
        source: ['ai_results'],
        detectedAt: '2026-10-09T00:00:00Z',
        lastDetectedAt: '2026-10-09T00:00:00Z',
        resolvedAt: null,
        previousValue: null,
        currentValue: null,
        changeValue: null,
        payload: { promptId, promptText },
        kpiKeys: [],
        actionId: 'a1',
        where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
      }) as Signal;
    const estimate = promptVolumeEstimate({
      estAiVolume: 5500,
      googleVolumes: { a: 10_000, b: 12_200, c: 14_000 },
      aiVolumeMultiplier: 0.45,
      keywords: ['a', 'b', 'c'],
      fetchedAt: new Date().toISOString(),
    });
    server.getActionDetail.mockResolvedValue({
      ...emptyDetail,
      // p2 is named by a signal the nightly pass added, never kept by the action.
      signals: [
        lost('s1', 'p1', 'Best coffee subscription?'),
        lost('s2', 'p2', 'Coffee delivery near me'),
      ],
      entities: [
        { type: 'prompts', key: 'p1', label: 'Best coffee subscription?', removed: false },
      ],
    });
    server.getPromptDemand.mockResolvedValue({ p1: estimate, p2: estimate });

    await renderDrawer({ ...action, payload: { targetEntity: 'prompts', targetCount: 1 } });

    expect(server.getPromptDemand).toHaveBeenCalledWith('b1', ['p1', 'p2']);
    // Both prompts' demand, not the kept one's alone (4.1–6.9k).
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain(
      '2 prompts (8.2–13.8k AI searches a month, estimated)',
    );
  });

  describe('changes', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const dueDate = () => document.querySelector<HTMLInputElement>('#action-drawer-due-date')!;
    /** What the browser does as a date is picked or typed into the field. */
    const enter = (value: string) =>
      act(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        set.call(dueDate(), value);
        dueDate().dispatchEvent(new Event('input', { bubbles: true }));
      });
    const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(800)));

    it('shows a due date at once and saves only the one it settles on', async () => {
      await renderDrawer();
      // Typing 18 passes through the 1st.
      enter('2026-11-01');
      enter('2026-11-18');
      expect(dueDate().value).toBe('2026-11-18');
      expect(server.setActionDueDate).not.toHaveBeenCalled();

      await settle();
      expect(server.setActionDueDate).toHaveBeenCalledTimes(1);
      expect(server.setActionDueDate).toHaveBeenCalledWith('b1', 'a1', '2026-11-18');
      expect(onPatched).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ dueDate: '2026-11-18' }),
      );
      // The list isn't read again; the detail is, for its History.
      expect(onChanged).not.toHaveBeenCalled();
      expect(server.getActionDetail).toHaveBeenCalledTimes(2);
    });

    it("doesn't save a year still being typed, and puts the saved date back on leaving", async () => {
      await renderDrawer();
      enter('0002-11-01');
      await settle();
      expect(server.setActionDueDate).not.toHaveBeenCalled();

      act(() => dueDate().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
      expect(dueDate().value).toBe('2026-11-01');
      expect(server.setActionDueDate).not.toHaveBeenCalled();
    });

    it('saves on leaving the field, and a cleared date as none', async () => {
      await renderDrawer();
      enter('2026-12-05');
      await act(async () => dueDate().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
      expect(server.setActionDueDate).toHaveBeenCalledWith('b1', 'a1', '2026-12-05');

      enter('');
      await settle();
      expect(server.setActionDueDate).toHaveBeenLastCalledWith('b1', 'a1', null);
      expect(server.setActionDueDate).toHaveBeenCalledTimes(2);
    });

    it('says so when a save fails, and reads the list again', async () => {
      server.setActionDueDate.mockRejectedValueOnce(new Error('offline'));
      await renderDrawer();
      enter('2026-12-05');
      await settle();
      expect(toast.error).toHaveBeenCalledWith("Couldn't update the action.");
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("passes a new task's count to the list without reading it again", async () => {
      await renderDrawer();
      const button = (name: string) =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === name || b.textContent?.startsWith(`${name} (`),
        )!;
      await act(async () => button('Tasks').click());
      await act(async () => button('Add task').click());
      const field = document.querySelector<HTMLInputElement>('input[aria-label="Add task"]')!;
      act(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        set.call(field, 'Refresh /pricing');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      server.getActionDetail.mockResolvedValueOnce({
        ...emptyDetail,
        tasks: [
          { id: 't1', position: 1, status: 'completed' },
          { id: 't2', position: 2, status: 'skipped' },
          { id: 't3', position: 3, status: 'todo' },
        ],
      });
      await act(async () => button('Add').click());

      expect(server.addTask).toHaveBeenCalledWith('b1', 'a1', 'Refresh /pricing');
      // Skipped work leaves the count, as in the list.
      expect(onPatched).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ taskTotal: 2, taskCompleted: 1 }),
      );
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe('writing tasks (CE-022)', () => {
    const PRICING = 'https://acme.example/pricing';
    const FEATURES = 'https://acme.example/features';
    const task = (id: string, taskKey: string, title: string) => ({
      id,
      position: 1,
      status: 'todo',
      taskKey,
      title,
      titleParams: {},
      dependsOn: [],
      details: null,
    });
    const button = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === name || b.textContent?.startsWith(`${name} (`),
      );
    const openTask = async (title: string) => {
      await act(async () => button('Tasks')!.click());
      await act(async () => button(`1. ${title}`)!.click());
    };

    it('opens the Content Editor on a draft for the page the action names', async () => {
      server.getActionDetail.mockResolvedValue({
        ...emptyDetail,
        tasks: [task('t1', 'optimize_content', 'Optimize the page')],
      });
      drafts.startDraftFromAction.mockResolvedValue({
        draftId: 'd-new',
        created: true,
        importFailed: false,
      });
      await renderDrawer({ ...action, payload: { pages: [PRICING] } });
      await openTask('Optimize the page');

      await act(async () => button('Optimize page')!.click());
      expect(drafts.startDraftFromAction).toHaveBeenCalledWith('b1', 'a1', 't1', {
        page: PRICING,
        title: expect.any(String),
      });
      expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d-new');
    });

    it('opens the draft already written, and lists each page when the action names several', async () => {
      server.getActionDetail.mockResolvedValue({
        ...emptyDetail,
        tasks: [task('t1', 'refresh_content', 'Refresh the pages')],
      });
      drafts.getActionDrafts.mockResolvedValue([
        { id: 'd-pricing', method: 'optimize', sourceUrl: PRICING, status: 'draft' },
      ]);
      await renderDrawer({ ...action, payload: { pages: [PRICING, FEATURES] } });
      await openTask('Refresh the pages');

      expect(drafts.getActionDrafts).toHaveBeenCalledWith('b1', 'a1');
      const rows = [...document.querySelectorAll('li')].filter((li) =>
        li.textContent?.startsWith('/'),
      );
      expect(rows.map((li) => li.textContent)).toEqual(['/pricingOpen draft', '/featuresOptimize']);
      expect(rows[0].querySelector('a')!.getAttribute('href')).toBe(
        '/dashboard/content/editor/d-pricing',
      );
      await act(async () => rows[1].querySelector('button')!.click());
      expect(drafts.startDraftFromAction).toHaveBeenCalledWith(
        'b1',
        'a1',
        't1',
        expect.objectContaining({ page: FEATURES }),
      );
    });

    it('starts a new page without one, and says so when it can’t', async () => {
      server.getActionDetail.mockResolvedValue({
        ...emptyDetail,
        tasks: [
          task('t1', 'create_content_draft', 'Write the draft'),
          task('t2', 'create_content_brief', 'Write the brief'),
        ],
      });
      drafts.startDraftFromAction.mockResolvedValue({ error: 'failed' });
      await renderDrawer({ ...action, payload: { pages: [PRICING] } });
      await openTask('Write the draft');

      await act(async () => button('Create content')!.click());
      expect(drafts.startDraftFromAction).toHaveBeenCalledWith(
        'b1',
        'a1',
        't1',
        expect.objectContaining({ page: null }),
      );
      expect(toast.error).toHaveBeenCalledWith("Couldn't open the Content Editor. Try again.");
      expect(push).not.toHaveBeenCalled();
      // Only the writing task has one.
      await act(async () => button('1. Write the brief')!.click());
      expect(
        [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Create content'),
      ).toHaveLength(1);
    });
  });
});
