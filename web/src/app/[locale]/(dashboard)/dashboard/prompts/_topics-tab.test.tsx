import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

/**
 * The Topics tab's buttons sit where the Prompts tab's do: beside the tabs,
 * in the same order and size — Add Topic, Export CSV, Manage topics.
 */

let canManage = true;
// The workspace's plan: active unless a test says it's read-only.
let isLocked = false;
const openUpgrade = vi.fn();
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => ({ canManage }) }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (state: unknown) => unknown) =>
    select({ activeBrandId: 'b1', brands: [{ id: 'b1', slug: 'acme' }] }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));
vi.mock('@/lib/actions/topic', () => ({
  getTopicsOverview: vi.fn(async () => ({ topics: [], unassignedPromptCount: 0 })),
  createTopic: vi.fn(),
}));
vi.mock('./_topic-suggestions-card', () => ({ TopicSuggestionsCard: () => null }));

const { TopicsTab } = await import('./_topics-tab');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let slot: HTMLDivElement;
let root: Root;

beforeEach(() => {
  canManage = true;
  isLocked = false;
  openUpgrade.mockClear();
  container = document.createElement('div');
  slot = document.createElement('div');
  document.body.append(slot, container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  slot.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <TopicsTab
            actionsSlot={slot}
            range={{ from: '2026-10-11T00:00:00.000Z', days: 7 }}
            rangePreset="7d"
            customFrom=""
            customTo=""
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const labels = (el: Element) =>
  [...el.querySelectorAll('a, button')].map((b) => b.textContent?.trim());

describe('TopicsTab buttons', () => {
  it('go beside the tabs as Add Topic, Export CSV, Manage topics', async () => {
    await render();
    expect(labels(slot)).toEqual(['Add Topic', 'Export CSV', 'Manage topics']);
    expect(slot.querySelector('a')!.getAttribute('href')).toBe('/dashboard/brands/b1/topics');
    // Not a second copy in the tab's own content.
    expect(labels(container)).not.toContain('Manage topics');
  });

  it("leave Add Topic out for members who can't manage", async () => {
    canManage = false;
    await render();
    expect(labels(slot)).toEqual(['Export CSV', 'Manage topics']);
  });
});

describe('Add Topic on a read-only workspace (plan not active)', () => {
  const addTopic = () =>
    [...slot.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Add Topic',
    )!;
  const dialog = () => document.querySelector('[role="dialog"]');

  it('opens the upgrade dialog instead of the Add Topic form', async () => {
    isLocked = true;
    await render();
    await act(async () => addTopic().click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Adding topics needs a plan');
    expect(dialog()).toBeNull();
  });

  it('opens the Add Topic form on an active plan', async () => {
    await render();
    await act(async () => addTopic().click());
    expect(openUpgrade).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Add Topic');
  });
});
