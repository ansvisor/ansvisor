import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionItem } from '@/lib/actions/action-center';
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
  setActionDueDate: vi.fn(),
  updateActionStatus: vi.fn(),
  updateTaskStatus: vi.fn(),
  updateTaskTitle: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/actions/action-center', () => server);
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
  for (const fn of [server.addTask, server.setActionDueDate]) fn.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderDrawer() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ActionDrawer
          brandId="b1"
          action={action}
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
});
