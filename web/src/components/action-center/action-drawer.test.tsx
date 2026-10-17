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

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/actions/action-center', () => ({
  addTask: vi.fn(),
  assignAction: vi.fn(),
  deleteTask: vi.fn(),
  getActionDetail: vi.fn(async () => ({
    tasks: [],
    signals: [],
    events: [],
    kpis: [],
    positionOutcome: null,
  })),
  setActionDueDate: vi.fn(),
  updateActionStatus: vi.fn(),
  updateTaskStatus: vi.fn(),
  updateTaskTitle: vi.fn(),
}));

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

beforeEach(() => {
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
          onChanged={() => {}}
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
});
