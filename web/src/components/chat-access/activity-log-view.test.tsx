import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ActivityRow } from '@/lib/chat/activity-view';

/** The Activity log page (CHAT-20 §10a, mockup #g-activity). */

const actions = vi.hoisted(() => ({
  listActivity: vi.fn(),
  undoActivity: vi.fn(),
  exportActivityCsv: vi.fn(),
}));
vi.mock('@/lib/actions/chat-activity', () => actions);
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ActivityLogView } = await import('./activity-log-view');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of [...Object.values(actions), ...Object.values(toast)]) fn.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'a1',
  at: '2026-10-29T10:41:00Z',
  userId: 'u1',
  person: 'Alex Kim',
  isYou: false,
  surface: 'chat',
  kind: 'change',
  toolKey: 'saveDraft',
  area: 'content',
  class: 'write',
  mode: 'full_auto',
  approvalKind: 'auto',
  autoVia: 'full_auto',
  denialCode: null,
  summaryKey: 'saveDraft',
  summaryParams: { title: 'Pricing FAQ' },
  status: 'done',
  canUndo: true,
  undoneAt: null,
  ...over,
});
const page = (over = {}) => ({
  ok: true,
  isAdmin: false,
  rows: [row()],
  hasMore: false,
  people: [],
  ...over,
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ActivityLogView areas={['content', 'prompts']} />
      </NextIntlClientProvider>,
    );
  });
}
const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);

describe('ActivityLogView', () => {
  it('says what happened in words, how it ran, and offers Undo', async () => {
    actions.listActivity.mockResolvedValue(
      page({
        rows: [
          row(),
          row({
            id: 'a2',
            kind: 'access.denied',
            summaryKey: 'accessDenied',
            summaryParams: { tool: 'Dismiss prompt suggestions' },
            denialCode: 'forbidden_role',
            approvalKind: null,
            canUndo: false,
          }),
        ],
      }),
    );
    await render();
    expect(text()).toContain('Saved the draft “Pricing FAQ”');
    expect(text()).toContain('Auto · Full auto');
    expect(text()).toContain('Not allowed: Dismiss prompt suggestions');
    expect(text()).toContain("Role doesn't allow it");
    expect(text()).not.toContain('create_draft');
    expect(button('Export CSV')).toBeUndefined();
    actions.undoActivity.mockResolvedValue({
      ok: true,
      code: 'ok',
      message: 'Undone.',
      href: null,
    });
    await act(async () => button('Undo')!.click());
    expect(actions.undoActivity).toHaveBeenCalledWith('a1');
    expect(toast.success).toHaveBeenCalledWith('Undone.');
    expect(actions.listActivity).toHaveBeenCalledTimes(2);
  });

  it('links a change that changed since, to undo by hand', async () => {
    actions.listActivity.mockResolvedValueOnce(page());
    actions.undoActivity.mockResolvedValue({
      ok: true,
      code: 'conflict',
      message: 'This changed since. Open it to undo by hand.',
      href: '/dashboard/content/d1',
    });
    actions.listActivity.mockResolvedValue(
      page({ rows: [row({ status: 'undo_conflict', canUndo: false })] }),
    );
    await render();
    await act(async () => button('Undo')!.click());
    expect(toast.info).toHaveBeenCalledWith('This changed since. Open it to undo by hand.');
    expect(container.querySelector('a[href="/dashboard/content/d1"]')?.textContent).toBe('Open it');
    expect(text()).toContain('Changed since');
  });

  it('reads again on a filter, and gives an Admin the person filter and CSV', async () => {
    actions.listActivity.mockResolvedValue(
      page({ isAdmin: true, people: [{ id: 'u2', name: 'Taylor Brooks' }] }),
    );
    await render();
    expect(text()).toContain('Taylor Brooks');
    const kind = [...container.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'denied'),
    )!;
    await act(async () => {
      kind.value = 'denied';
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(actions.listActivity).toHaveBeenLastCalledWith({ kind: 'denied' });
    actions.exportActivityCsv.mockResolvedValue({ ok: false, failure: 'failed' });
    await act(async () => button('Export CSV')!.click());
    expect(actions.exportActivityCsv).toHaveBeenCalledWith({ kind: 'denied', before: undefined });
    expect(toast.error).toHaveBeenCalledWith("Couldn't export it. Try again.");
  });

  it('pages on with Load more, and says so in plain words when it can’t be read', async () => {
    actions.listActivity.mockResolvedValueOnce(page({ hasMore: true }));
    actions.listActivity.mockResolvedValueOnce(
      page({ rows: [row({ id: 'a9', summaryParams: { title: 'Older' } })] }),
    );
    await render();
    await act(async () => button('Load more')!.click());
    expect(actions.listActivity).toHaveBeenLastCalledWith({ before: '2026-10-29T10:41:00Z' });
    expect(text()).toContain('Saved the draft “Older”');

    act(() => root.unmount());
    root = createRoot(container);
    actions.listActivity.mockResolvedValue({ ok: false, failure: 'failed' });
    await render();
    expect(text()).toContain("Couldn't load the Activity log.");
    expect(button('Retry')).toBeDefined();
  });
});
