import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

const { toast, regenerate, getRemoved } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  regenerate: vi.fn(),
  getRemoved: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/actions/action-task-writer', () => ({ regenerateActionTasks: regenerate }));
vi.mock('@/lib/actions/action-removed', () => ({ getRemovedTargets: getRemoved }));
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ role: 'admin', canManage: true, canAdmin: true }),
}));

const { RemovedNote } = await import('./removed-note');

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const action = (removed: number, created = 6) => ({
  id: 'a1',
  kind: 'citation_loss',
  status: 'new',
  payload: {
    targetEntity: 'prompts',
    targetCount: created - removed,
    createdTargetCount: created,
    removedCount: removed,
    removedLabels: ['best crm', 'crm for agents'].slice(0, removed),
  },
});

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked: false, reason: 'ended', adminName: null, openUpgrade: vi.fn() }}
        >
          {node}
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (name: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_ACTION_TASKS_AI', 'true');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  regenerate.mockReset();
  getRemoved.mockReset();
  toast.success.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe('RemovedNote (AC-13)', () => {
  it('opens the removed prompts, each with why, without opening the row', async () => {
    getRemoved.mockResolvedValueOnce([
      { label: 'best crm', reason: 'deleted' },
      { label: 'crm for agents', reason: 'paused' },
    ]);
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <RemovedNote action={action(2)} />
      </div>,
    );
    await act(async () => button('removed since').click());
    expect(getRemoved).toHaveBeenCalledWith('a1');
    expect(onRow).not.toHaveBeenCalled();
    const text = document.body.textContent;
    expect(text).toContain('No longer tracked since this action was created');
    expect(text).toContain('best crmDeleted');
    expect(text).toContain('crm for agentsPaused');
    // Two of six gone: no re-plan.
    expect(text).not.toContain('Re-plan with the remaining prompts');
  });

  it('keeps the names it has when the reasons can’t be read', async () => {
    getRemoved.mockResolvedValueOnce(null);
    render(<RemovedNote action={action(2)} />);
    await act(async () => button('removed since').click());
    expect(document.body.textContent).toContain('best crm');
    expect(document.body.textContent).not.toContain('Deleted');
  });

  it('re-plans on the prompts left once more than half are gone', async () => {
    getRemoved.mockResolvedValueOnce([]);
    regenerate.mockResolvedValueOnce({ written: 3, kept: 0, reviews: 0 });
    const onReplanned = vi.fn();
    render(<RemovedNote action={action(4)} onReplanned={onReplanned} />);
    await act(async () => button('removed since').click());
    expect(document.body.textContent).toContain('the 2 prompts left');
    act(() => button('Re-plan with the remaining prompts').click());
    expect(regenerate).not.toHaveBeenCalled();
    await act(async () => button('Regenerate').click());
    expect(regenerate).toHaveBeenCalledWith('a1');
    expect(toast.success).toHaveBeenCalledWith('3 tasks written');
    expect(onReplanned).toHaveBeenCalled();
  });
});
