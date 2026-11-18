import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';

/**
 * Competitors on a read-only workspace (plan not active): Add, Suggest (it
 * asks the AI as its dialog opens) and Delete open the upgrade dialog instead.
 */

const competitorActions = vi.hoisted(() => ({
  getCompetitors: vi.fn(),
  addCompetitor: vi.fn(),
  deleteCompetitor: vi.fn(),
  setCompetitorTypes: vi.fn(),
  getMergedCompetitors: vi.fn(async () => []),
  getCompetitorTimeline: vi.fn(async () => ({ weeks: [], events: [] })),
}));
vi.mock('@/lib/actions/competitor', () => competitorActions);
vi.mock('@/lib/actions/tracking', () => ({
  getCompetitorComparison: vi.fn(async () => ({ brands: [] })),
  getHeadToHeadComparison: vi.fn(),
  getHeadToHeadRuns: vi.fn(),
}));
const suggestCompetitors = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai-brand-setup', () => ({ suggestCompetitors }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({ canUse: () => true, isCloud: true }),
}));
// The type pickers and the type filter as native selects over their items.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    items,
    value,
    onValueChange,
  }: {
    items: { value: string; label: string }[];
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { chatPage } = vi.hoisted(() => ({ chatPage: vi.fn() }));
vi.mock('@/components/chat/panel/chat-panel-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatPageContext: chatPage,
}));
const { default: CompetitorsPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked: boolean, role: TeamRole = 'manager') {
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

// The header's buttons: the empty state below repeats Add and Suggest.
const headerButton = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
const dialog = () => document.querySelector('[role="dialog"]');

beforeEach(() => {
  vi.clearAllMocks();
  competitorActions.getCompetitors.mockResolvedValue([
    { id: 'c1', brandId: 'b1', name: 'Rival', domain: 'rival.com', createdAt: '2026-10-01' },
  ]);
  suggestCompetitors.mockResolvedValue({ competitors: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Competitors on a read-only workspace', () => {
  it('asks the AI for nothing: Suggest opens the upgrade dialog, not its own', async () => {
    await render(true);
    await act(async () => headerButton('Suggest competitors').click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Suggesting competitors needs a plan');
    expect(suggestCompetitors).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('adds and deletes nothing', async () => {
    await render(true);
    await act(async () => headerButton('Add Competitor').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Adding competitors needs a plan');
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')!;
    await act(async () => remove.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Deleting competitors needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(competitorActions.deleteCompetitor).not.toHaveBeenCalled();
  });

  it('opens Suggest, which asks the AI, on an active plan', async () => {
    await render(false);
    await act(async () => headerButton('Suggest competitors').click());
    expect(openUpgrade).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(suggestCompetitors).toHaveBeenCalledTimes(1);
  });
});

// Competitor types (00542): a label on each card, a filter and groups once
// any competitor has one, and Set type for admins and managers.
describe('Competitor types', () => {
  const typed = [
    { id: 'c1', brandId: 'b1', name: 'Rival', domain: 'rival.com', type: 'direct' },
    { id: 'c2', brandId: 'b1', name: 'Sky Air', domain: 'sky.example', type: 'Airline' },
    { id: 'c3', brandId: 'b1', name: 'Plain Co', domain: '', type: null },
  ];
  const cardNames = () =>
    [...container.querySelectorAll('.group span.text-sm.font-medium')].map((el) => el.textContent);
  /** The select whose options include this label (the filter, or a type picker). */
  const selectWith = (label: string, root: ParentNode = container) =>
    [...root.querySelectorAll('select')].find((el) =>
      [...el.options].some((o) => o.textContent === label),
    )!;
  const choose = async (select: HTMLSelectElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        select,
        value,
      );
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('labels each card with its type, and filters and groups the list by type', async () => {
    competitorActions.getCompetitors.mockResolvedValue(typed);
    await render(false);
    expect(container.textContent).toContain('Direct competitor');
    expect(container.textContent).toContain('Airline');
    expect(cardNames()).toEqual(['Rival', 'Sky Air', 'Plain Co']);

    const filter = selectWith('All types');
    // Only the types the brand's competitors have, and No type for the rest.
    expect([...filter.options].map((o) => o.textContent)).toEqual([
      'All types',
      'Direct competitor',
      'Airline',
      'No type',
    ]);
    await choose(filter, 'Airline');
    expect(cardNames()).toEqual(['Sky Air']);
    await choose(filter, 'none');
    expect(cardNames()).toEqual(['Plain Co']);
    await choose(filter, ' all');
    expect(cardNames()).toEqual(['Rival', 'Sky Air', 'Plain Co']);

    await act(async () => headerButton('Group by type').click());
    expect(headerButton('Group by type').getAttribute('aria-pressed')).toBe('true');
    const groups = [...container.querySelectorAll('section[aria-label]')].map((el) => [
      el.getAttribute('aria-label'),
      [...el.querySelectorAll('.group span.text-sm.font-medium')].map((c) => c.textContent),
    ]);
    expect(groups).toEqual([
      ['Direct competitor', ['Rival']],
      ['Airline', ['Sky Air']],
      ['No type', ['Plain Co']],
    ]);
  });

  it('shows the list as before to a brand that never set a type', async () => {
    await render(false);
    expect(container.querySelector('select')).toBeNull();
    expect(headerButton('Group by type')).toBeUndefined();
    expect(cardNames()).toEqual(['Rival']);
  });

  it("sets a competitor's type from its card, and shows it", async () => {
    competitorActions.getCompetitors.mockResolvedValue(typed);
    competitorActions.setCompetitorTypes.mockResolvedValue([{ ...typed[2], type: 'Airline' }]);
    await render(false);
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Set type for Plain Co"]',
    )!;
    await act(async () => button.click());
    expect(dialog()?.textContent).toContain('Type of Plain Co');
    // The brand's own label is offered beside the generic types.
    const picker = selectWith('New type…', dialog()!);
    expect([...picker.options].map((o) => o.textContent)).toEqual([
      'No type',
      'Direct competitor',
      'Marketplace / aggregator',
      'Publisher / review site',
      'Other',
      'Airline',
      'New type…',
    ]);
    await choose(picker, 'Airline');
    const save = [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    await act(async () => save.click());
    expect(competitorActions.setCompetitorTypes).toHaveBeenCalledWith('b1', ['c3'], 'Airline');
    expect(dialog()).toBeNull();
    await choose(selectWith('All types'), 'Airline');
    expect(cardNames()).toEqual(['Sky Air', 'Plain Co']);
  });

  it('adds a competitor with a new type typed in', async () => {
    competitorActions.addCompetitor.mockResolvedValue({ id: 'c9' });
    await render(false);
    await act(async () => headerButton('Add Competitor').click());
    await type(dialog()!.querySelector<HTMLInputElement>('#comp-name')!, 'Blue Ferry');
    await choose(selectWith('New type…', dialog()!), ' new');
    const typed = dialog()!.querySelector<HTMLInputElement>('input[placeholder="e.g. Reseller"]')!;
    await type(typed, 'Ferry line');
    const add = [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Add')!;
    await act(async () => add.click());
    expect(competitorActions.addCompetitor).toHaveBeenCalledWith('b1', {
      name: 'Blue Ferry',
      domain: '',
      type: 'Ferry line',
    });
  });

  it('opens the upgrade dialog for Set type on a read-only workspace', async () => {
    await render(true);
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Set type for Rival"]',
    )!;
    await act(async () => button.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Setting competitor types needs a plan');
    expect(dialog()).toBeNull();
    expect(competitorActions.setCompetitorTypes).not.toHaveBeenCalled();
  });

  it.each(['analyst', 'agency_partner'] as const)('gives an %s no Set type', async (role) => {
    competitorActions.getCompetitors.mockResolvedValue(typed);
    await render(false, role);
    expect(container.textContent).toContain('Airline');
    expect(container.querySelector('button[aria-label^="Set type for"]')).toBeNull();
  });
});

describe('Competitors for a member who is not an admin or a manager', () => {
  it.each(['analyst', 'agency_partner'] as const)(
    'shows an %s the competitors without Add, Suggest or Delete',
    async (role) => {
      await render(false, role);
      expect(container.textContent).toContain('Rival');
      expect(headerButton('Add Competitor')).toBeUndefined();
      expect(headerButton('Suggest competitors')).toBeUndefined();
      expect(container.querySelector('button[aria-label="Delete"]')).toBeNull();
    },
  );
});

describe("what Chat's side panel sees (the owner's plan, step 9)", () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('sends its period, the competitors by id with their domains, and the one open', async () => {
    window.history.replaceState(null, '', '/?competitor=c1&preset=7d');
    await render(false);
    expect(chatPage.mock.lastCall![0]).toEqual({
      pageName: 'Competitors',
      dateRange: { from: '7d', to: null, label: 'Last 7 days' },
      view: {
        rows: [{ ref: 'c1', label: 'Rival (rival.com)' }],
        total: 1,
        // Its id is the URL's (?competitor=); its name comes with it.
        open: { ref: 'c1', label: 'Rival' },
      },
    });
  });

  it('sends no rows while it reads, and nothing open until one is picked', async () => {
    competitorActions.getCompetitors.mockReturnValue(new Promise(() => {}));
    await render(false);
    expect(chatPage.mock.lastCall![0].view).toEqual({});
  });
});
