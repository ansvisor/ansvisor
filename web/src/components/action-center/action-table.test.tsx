import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ActionItem } from '@/lib/actions/action-center';
import { ActionTable } from './action-table';

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
  dueDate: null,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  taskTotal: 0,
  taskCompleted: 0,
  signalCount: 1,
};

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();
const onStatusChange = vi.fn();
const onDelete = vi.fn();

function render(props: Partial<React.ComponentProps<typeof ActionTable>> = {}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ActionTable
          actions={[action]}
          onSelect={onSelect}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
          canDelete
          {...props}
        />
      </NextIntlClientProvider>,
    );
  });
}

async function openMenu() {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

const disabled = (item: HTMLElement) =>
  item.hasAttribute('data-disabled') || item.getAttribute('aria-disabled') === 'true';

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

describe('ActionTable row menu', () => {
  it('offers In Progress, Completed, Dismiss and Delete, the current status off', async () => {
    render();
    const items = await openMenu();
    expect(items.map((item) => item.textContent)).toEqual([
      'In Progress',
      'Completed',
      'Dismiss',
      'Delete',
    ]);
    expect(items.map(disabled)).toEqual([true, false, false, false]);
  });

  it('changes the status from the list, without opening the drawer', async () => {
    render();
    const items = await openMenu();
    await act(async () => items[1].click());
    expect(onStatusChange).toHaveBeenCalledWith(action, 'completed');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('asks before deleting, and deletes on Delete', async () => {
    render();
    const items = await openMenu();
    await act(async () => items[3].click());
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Delete this action?');
    const confirm = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Delete',
    )!;
    await act(async () => confirm.click());
    expect(onDelete).toHaveBeenCalledWith(action);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps Delete off for members who can't delete", async () => {
    render({ canDelete: false });
    const items = await openMenu();
    expect(disabled(items[3])).toBe(true);
  });

  it('waits while a change to the row is in flight, and has no menu without handlers', () => {
    render({ busyIds: new Set(['a1']) });
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]')!.disabled,
    ).toBe(true);
    render({ onStatusChange: undefined, onDelete: undefined });
    expect(container.querySelector('button[aria-label^="Actions for"]')).toBeNull();
  });
});

// New Ansvisor (AC-ALT2): no one assigned means the whole workspace's.
describe('ActionTable assignee', () => {
  const assigneeCell = () => container.querySelectorAll('tbody tr td')[3];

  it('shows an action with no one on it as Everyone', () => {
    render();
    expect(assigneeCell().textContent).toBe('Everyone');
    expect(assigneeCell().querySelector('[title]')?.getAttribute('title')).toBe(
      'Everyone in the workspace: no one is assigned yet',
    );
  });

  it("shows an assigned member's initials", () => {
    render({
      actions: [
        { ...action, assignee: { id: 'u1', fullName: 'Ayse Kaya', email: null, avatarUrl: null } },
      ],
    });
    expect(assigneeCell().textContent).toBe('AK');
  });
});
