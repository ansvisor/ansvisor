import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { TopicCategories as Data } from '@/lib/catalog-client';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

const listTopicCategories = vi.fn();
const setTopicCategory = vi.fn();
vi.mock('@/lib/catalog-client', () => ({
  listTopicCategories: (...args: unknown[]) => listTopicCategories(...args),
  setTopicCategory: (...args: unknown[]) => setTopicCategory(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/stores/use-brand-store', () => ({ useBrandStore: () => ({ activeBrandId: 'b1' }) }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { TopicCategories } = await import('./topic-categories');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Topics and categories (AC plan P-7, 00494). */

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

const DATA: Data = {
  topics: [
    {
      id: 't-cold',
      name: 'Cold brew',
      categories: [
        { id: 'c-cold', name: 'Coffee > Cold Brew', source: 'auto' },
        { id: 'c-gifts', name: 'Gifts', source: 'manual' },
      ],
    },
    { id: 't-gear', name: 'Equipment', categories: [] },
  ],
  categories: [
    { id: 'c-cold', name: 'Coffee > Cold Brew' },
    { id: 'c-gifts', name: 'Gifts' },
    { id: 'c-grinders', name: 'Equipment > Grinders' },
  ],
};

async function render(isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <TopicCategories />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  role.canManage = true;
  listTopicCategories.mockReset().mockResolvedValue({ ok: true, value: DATA });
  setTopicCategory.mockReset().mockResolvedValue({ ok: true, value: true });
  toast.error.mockReset();
  toast.success.mockReset();
  openUpgrade.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('TopicCategories', () => {
  it('lists each topic with its categories, matched or set by hand', async () => {
    await render();
    expect(listTopicCategories).toHaveBeenCalledWith('b1');
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Coffee > Cold Brew');
    expect(rows[0].textContent).toContain('matched');
    expect(rows[0].textContent).toContain('set by hand');
    expect(rows[1].textContent).toContain('No category yet');
  });

  it('takes a category away for an admin or a manager, and reads them again', async () => {
    await render();
    const remove = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === 'Take Coffee > Cold Brew away',
    );
    expect(remove).toBeDefined();
    await act(async () => remove!.click());
    expect(setTopicCategory).toHaveBeenCalledWith('b1', 't-cold', 'c-cold', false);
    expect(toast.success).toHaveBeenCalledWith('Topic categories saved');
    expect(listTopicCategories).toHaveBeenCalledTimes(2);
  });

  it('shows a member the list with nothing to change', async () => {
    role.canManage = false;
    await render();
    expect(container.querySelector('button[aria-label^="Take"]')).toBeNull();
    expect(container.textContent).not.toContain('Add a category');
  });

  it('opens the upgrade dialog on a read-only workspace', async () => {
    await render(true);
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="Take"]')!;
    await act(async () => remove.click());
    expect(setTopicCategory).not.toHaveBeenCalled();
    expect(openUpgrade).toHaveBeenCalled();
  });

  it('shows nothing without topics or categories, and says when they can’t be read', async () => {
    listTopicCategories.mockResolvedValue({ ok: true, value: { topics: [], categories: [] } });
    await render();
    expect(container.textContent).toBe('');
    listTopicCategories.mockResolvedValue({ ok: false, code: 'failed' });
    root.unmount();
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain("Couldn't read the topics' categories");
  });
});
