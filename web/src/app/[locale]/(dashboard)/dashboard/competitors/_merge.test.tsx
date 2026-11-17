import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';

/**
 * Merging duplicate competitors (00543) on the Competitors page: Merge for
 * admins and managers, the confirmation that says numbers from before the
 * merge aren't combined, the kept card's other names, the Merged
 * competitors list with Unmerge, the "may be the same company" hint, and a
 * merged competitor never added again.
 */

const competitorActions = vi.hoisted(() => ({
  getCompetitors: vi.fn(),
  getMergedCompetitors: vi.fn(),
  addCompetitor: vi.fn(),
  deleteCompetitor: vi.fn(),
  setCompetitorTypes: vi.fn(),
  mergeCompetitors: vi.fn(),
  unmergeCompetitor: vi.fn(),
  getCompetitorTimeline: vi.fn(async () => ({ weeks: [], events: [] })),
}));
vi.mock('@/lib/actions/competitor', () => competitorActions);
vi.mock('@/lib/actions/tracking', () => ({
  getCompetitorComparison: vi.fn(async () => ({ brands: [] })),
  getHeadToHeadComparison: vi.fn(async () => ({ groups: [] })),
  getHeadToHeadRuns: vi.fn(),
}));
vi.mock('@/lib/ai-brand-setup', () => ({ suggestCompetitors: vi.fn() }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({ canUse: () => true, isCloud: true }),
}));
vi.mock('@/components/ui/select', () => ({
  Select: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));
const brand = {
  id: 'b1',
  name: 'Acme',
  slug: 'acme',
  domains: [{ domain: 'acme.com', isPrimary: true }],
};
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (state: unknown) => unknown) => select({ getActiveBrand: () => brand }),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/filters/date-range-filter', () => ({ DateRangeFilter: () => null }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { default: CompetitorsPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

const RIVAL = { id: 'c1', brandId: 'b1', name: 'Rival', domain: 'rival.com', type: null };
const TOURS = {
  id: 'c2',
  brandId: 'b1',
  name: 'Rival Tours',
  domain: 'rivaltours.com',
  type: null,
};
const SKY = { id: 'c3', brandId: 'b1', name: 'Sky Air', domain: 'sky.example', type: null };
const MERGED = {
  id: 'm1',
  name: 'Island Hopper',
  domain: 'islandhopper.example',
  type: null,
  mergedIntoId: 'c3',
  mergedIntoName: 'Sky Air',
  mergedAt: '2026-11-17T10:00:00Z',
  mergedBy: 'Ada',
};

async function render(isLocked = false, role: TeamRole = 'manager') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <CompetitorsPage />
          </UpgradeDialogContext.Provider>
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const buttons = (root: ParentNode = document) => [
  ...root.querySelectorAll<HTMLButtonElement>('button'),
];
const button = (name: string, root: ParentNode = document) =>
  buttons(root).find((b) => b.textContent?.trim() === name);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const click = async (el: HTMLElement | undefined | null) => {
  expect(el).toBeTruthy();
  await act(async () => el!.click());
};

beforeEach(() => {
  vi.clearAllMocks();
  competitorActions.getCompetitors.mockResolvedValue([RIVAL, SKY]);
  competitorActions.getMergedCompetitors.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Merge', () => {
  it('is there for a manager with two or more competitors, not for an analyst', async () => {
    await render(false, 'manager');
    expect(button('Merge', container)).toBeTruthy();
    act(() => root.unmount());
    root = createRoot(container);
    await render(false, 'analyst');
    expect(button('Merge', container)).toBeUndefined();
  });

  it('opens the upgrade dialog on a read-only workspace', async () => {
    await render(true);
    await click(button('Merge', container));
    expect(openUpgrade).toHaveBeenCalledWith('Merging competitors needs a plan');
    expect(dialog()).toBeNull();
  });

  it('merges the ones picked into the one kept, after saying what happens', async () => {
    competitorActions.mergeCompetitors.mockResolvedValue({
      ok: true,
      kept: { id: 'c3', name: 'Sky Air' },
      merged: [{ id: 'c1', name: 'Rival' }],
      already: [],
    });
    await render();
    await click(button('Merge', container));
    const box = dialog()!;
    expect(box.textContent).toContain('Pick the competitors that are the same company');
    const merge = button('Merge 1 competitor', box)!;
    expect(merge.disabled).toBe(true);

    const [rivalBox, skyBox] = [
      ...box.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]'),
    ];
    await click(rivalBox);
    await click(skyBox);
    // The first one picked is kept until another is chosen.
    const keep = [...box.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(keep).toHaveLength(2);
    await click(keep[1]);
    expect(box.textContent).toContain('Rival will be merged into Sky Air.');
    expect(box.textContent).toContain('From now on, answers naming any of them count for Sky Air.');
    expect(box.textContent).toContain("Numbers from before the merge aren't combined");

    competitorActions.getCompetitors.mockResolvedValue([SKY]);
    await click(button('Merge 1 competitor', box));
    expect(competitorActions.mergeCompetitors).toHaveBeenCalledWith('b1', 'c3', ['c1']);
    expect(toast.success).toHaveBeenCalledWith('Merged into Sky Air.');
    expect(dialog()).toBeNull();
    // The list is read again: Rival is gone from it.
    expect(competitorActions.getCompetitors).toHaveBeenCalledTimes(2);
  });

  it('says so when one was already merged, and shows the refusal it gets', async () => {
    competitorActions.mergeCompetitors.mockResolvedValueOnce({
      ok: true,
      kept: { id: 'c3', name: 'Sky Air' },
      merged: [],
      already: [{ id: 'c1', name: 'Rival', mergedIntoId: 'c3' }],
    });
    await render();
    await click(button('Merge', container));
    const pick = () => [
      ...dialog()!.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]'),
    ];
    await click(pick()[0]);
    await click(pick()[1]);
    await click(button('Merge 1 competitor', dialog()!));
    expect(toast.info).toHaveBeenCalledWith('Rival was already merged. Nothing changed for it.');
    expect(toast.success).not.toHaveBeenCalled();

    competitorActions.mergeCompetitors.mockResolvedValueOnce({
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can merge competitors.',
    });
    await click(button('Merge', container));
    await click(pick()[0]);
    await click(pick()[1]);
    await click(button('Merge 1 competitor', dialog()!));
    expect(toast.error).toHaveBeenCalledWith('Only an admin or a manager can merge competitors.');
    expect(dialog()).not.toBeNull();
  });
});

describe('Merged competitors', () => {
  beforeEach(() => {
    competitorActions.getMergedCompetitors.mockResolvedValue([MERGED]);
  });

  it('shows the kept card’s other names', async () => {
    await render();
    expect(container.textContent).toContain('Also: Island Hopper (islandhopper.example)');
    // Never a card of its own.
    const names = [...container.querySelectorAll('.group span.text-sm.font-medium')].map(
      (el) => el.textContent,
    );
    expect(names).toEqual(['Rival', 'Sky Air']);
  });

  it('lists what was merged into what, when and by whom, and unmerges', async () => {
    competitorActions.unmergeCompetitor.mockResolvedValue({
      ok: true,
      unmerged: true,
      competitor: { id: 'm1', name: 'Island Hopper' },
      mergedInto: { id: 'c3', name: 'Sky Air' },
    });
    await render();
    const toggle = buttons(container).find((b) => b.textContent?.includes('Merged competitors'))!;
    expect(toggle.textContent).toContain('(1)');
    await click(toggle);
    expect(container.textContent).toContain('Island Hopper');
    expect(container.textContent).toContain('into Sky Air');
    expect(container.textContent).toContain('Merged Nov 17, 2026 by Ada');
    expect(container.textContent).toContain("Numbers from before the merge aren't combined.");

    await click(
      container.querySelector<HTMLButtonElement>('button[aria-label="Unmerge Island Hopper"]'),
    );
    const box = dialog()!;
    expect(box.textContent).toContain('Unmerge Island Hopper?');
    expect(box.textContent).toContain(
      'Answers counted for Sky Air while they were merged stay with Sky Air.',
    );
    competitorActions.getMergedCompetitors.mockResolvedValue([]);
    await click(button('Unmerge', box));
    expect(competitorActions.unmergeCompetitor).toHaveBeenCalledWith('b1', 'm1');
    expect(toast.success).toHaveBeenCalledWith('Island Hopper is its own competitor again.');
  });

  it('gives an analyst the list without Unmerge', async () => {
    await render(false, 'analyst');
    await click(buttons(container).find((b) => b.textContent?.includes('Merged competitors')));
    expect(container.textContent).toContain('into Sky Air');
    expect(container.querySelector('button[aria-label="Unmerge Island Hopper"]')).toBeNull();
  });

  it('never adds a merged one again: it says where it counts', async () => {
    await render();
    await click(button('Add Competitor', container));
    const box = dialog()!;
    const [name, domain] = [...box.querySelectorAll<HTMLInputElement>('input')];
    await act(async () => {
      for (const [input, value] of [
        [name, 'Hopper'],
        [domain, 'www.islandhopper.example'],
      ] as const) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await act(async () => box.querySelector('form')!.requestSubmit());
    expect(competitorActions.addCompetitor).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      'Island Hopper is merged into Sky Air: answers naming it already count for Sky Air. To track it on its own, unmerge it under Merged competitors.',
    );
  });
});

describe('These may be the same company', () => {
  it('suggests a pair to a manager, and opens Merge with both picked', async () => {
    competitorActions.getCompetitors.mockResolvedValue([RIVAL, TOURS, SKY]);
    await render();
    expect(container.textContent).toContain(
      'These may be the same company: Rival and Rival Tours.',
    );
    await click(button('Merge…', container));
    const picked = [...dialog()!.querySelectorAll('button[role="checkbox"]')].map((el) =>
      el.getAttribute('aria-checked'),
    );
    expect(picked).toEqual(['true', 'true', 'false']);
    expect(dialog()!.textContent).toContain('Rival Tours will be merged into Rival.');
  });

  it('puts it off with Not now, and shows an analyst none', async () => {
    competitorActions.getCompetitors.mockResolvedValue([RIVAL, TOURS]);
    await render();
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Not now"]'));
    expect(container.textContent).not.toContain('These may be the same company');
    act(() => root.unmount());
    root = createRoot(container);
    await render(false, 'analyst');
    expect(container.textContent).not.toContain('These may be the same company');
  });
});
