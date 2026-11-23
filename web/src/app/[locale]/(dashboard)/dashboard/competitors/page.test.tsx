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

const { chatPage, chatPanel } = vi.hoisted(() => ({
  chatPage: vi.fn(),
  chatPanel: vi.fn((): { available: boolean; fill: (text: string) => void } | null => null),
}));
vi.mock('@/components/chat/panel/chat-panel-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatPageContext: chatPage,
  useChatPanel: chatPanel,
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

describe('the prompt set under each card’s score (UX audit CP-03)', () => {
  it('names the prompts the count is out of, and the picker’s range', async () => {
    const tracking = await import('@/lib/actions/tracking');
    const entry = (name: string, isOwnBrand: boolean, competitorId?: string) => ({
      name,
      isOwnBrand,
      competitorId,
      avgVisibilityScore: 0,
      visibilityRate: 0,
      visiblePrompts: 12,
      promptCount: 227,
      change: null,
      score: 37.4,
      scoreChange: null,
      mentionAnswers: 40,
      citationAnswers: 5,
      positionFactor: 0.5,
      totalMentions: 60,
      totalCitations: 5,
      resultCount: 300,
    });
    vi.mocked(tracking.getCompetitorComparison).mockResolvedValue({
      brands: [entry('Acme', true), entry('Rival', false, 'c1')],
      providerRows: [],
    });
    await render(false);
    const count = [...container.querySelectorAll<HTMLElement>('[title]')].find(
      (el) => el.textContent === '12/227 prompts',
    );
    expect(count?.title).toBe('227 prompts with answers in the last 30 days');
  });
});

describe('the grid by Visibility score, You in its place (UX audit CP-06)', () => {
  it('ranks the cards highest first with You among them, and leaves a low sample unranked', async () => {
    const tracking = await import('@/lib/actions/tracking');
    competitorActions.getCompetitors.mockResolvedValue([
      { id: 'c1', brandId: 'b1', name: 'Rival', domain: 'rival.com', type: null },
      { id: 'c2', brandId: 'b1', name: 'Bigger', domain: 'big.example', type: null },
      { id: 'c3', brandId: 'b1', name: 'Tiny', domain: 'tiny.example', type: null },
    ]);
    const entry = (name: string, isOwnBrand: boolean, score: number, visiblePrompts = 20) => ({
      name,
      isOwnBrand,
      avgVisibilityScore: 0,
      visibilityRate: 0,
      visiblePrompts,
      promptCount: 100,
      change: null,
      score,
      scoreChange: null,
      mentionAnswers: 10,
      citationAnswers: 1,
      positionFactor: 0.5,
      totalMentions: 10,
      totalCitations: 1,
      resultCount: 100,
    });
    vi.mocked(tracking.getCompetitorComparison).mockResolvedValue({
      brands: [
        entry('Acme', true, 40),
        entry('Rival', false, 30),
        entry('Bigger', false, 55),
        entry('Tiny', false, 80, 2),
      ],
      providerRows: [],
    });
    await render(false);
    const grid = container.querySelector('[data-slot="you-card"]')!.parentElement!;
    const rows = [...grid.children].map((card) => [
      card.querySelector('[data-slot="grid-rank"]')?.textContent,
      card.querySelector('span.text-sm.font-medium')?.textContent,
      !!card.querySelector('[data-slot="low-sample"]'),
    ]);
    expect(rows).toEqual([
      ['#1', 'Bigger', false],
      ['#2', 'Acme', false],
      ['#3', 'Rival', false],
      ['', 'Tiny', true],
    ]);
    expect(grid.querySelector('[data-slot="you-card"]')!.textContent).toContain('You');
  });
});

describe('the head-to-head over the picker’s days (UX audit CP-02, CP-08)', () => {
  beforeEach(() => {
    // The competitor's timeline chart sizes itself; jsdom has no ResizeObserver.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  const h2hCall = async () => {
    const tracking = await import('@/lib/actions/tracking');
    return vi.mocked(tracking.getHeadToHeadComparison).mock.lastCall;
  };

  it('reads the open competitor over the same days as the cards', async () => {
    window.history.replaceState(null, '', '/?competitor=c1&preset=7d');
    await render(false);
    const call = (await h2hCall())!;
    expect(call.slice(0, 2)).toEqual(['b1', 'c1']);
    // Seven UTC days, today included, as the cards' window.
    const { dayFrom, dayTo } = call[2]!;
    expect((Date.parse(dayTo!) - Date.parse(dayFrom!)) / 86_400_000).toBe(6);
  });

  it('reads all time with All', async () => {
    window.history.replaceState(null, '', '/?competitor=c1&preset=all');
    await render(false);
    expect(await h2hCall()).toEqual(['b1', 'c1', {}]);
  });
});

describe('the Prompt-by-Prompt list (UX audit CP-11, CP-12)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  const noParts = {
    answers: 0,
    mentionAnswers: 0,
    citationAnswers: 0,
    invPosition: 0,
    positionCount: 0,
  };
  const group = (promptId: string, promptText: string) => ({
    promptId,
    promptText,
    platform: 'ChatGPT',
    rawPlatform: 'chatgpt',
    modelUsed: '',
    rawModelUsed: null,
    runs: 12,
    brandScore: 20,
    competitorScore: 60,
    diff: -40,
    latestAt: '2026-11-19T10:00:00Z',
    parts: { brand: noParts, competitor: noParts },
  });

  it('puts the date range under the header, and searches the prompts, naming case repeats', async () => {
    const tracking = await import('@/lib/actions/tracking');
    vi.mocked(tracking.getHeadToHeadComparison).mockResolvedValue({
      groups: [
        group('p1', 'Best CRM for startups'),
        group('p2', 'best crm for startups'),
        group('p3', 'CRM pricing'),
      ],
      platformRows: [],
      brandAvg: 0,
      competitorAvg: 0,
      gaps: [],
      strengths: [],
    } as never);
    window.history.replaceState(null, '', '/?competitor=c1');
    await render(false);
    // The range has its own row, not the header's (CP-11).
    expect(container.querySelector('[data-slot="competitors-filters"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="prompt-list-count"]')!.textContent).toBe(
      '3 of 3 prompts',
    );
    expect(container.querySelector('[data-slot="prompt-case-repeats"]')!.textContent).toContain(
      '1 prompt repeats another but for letter case',
    );
    const search = container.querySelector<HTMLInputElement>(
      '[data-action="competitors.searchPrompts"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        'pricing',
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[data-slot="prompt-list-count"]')!.textContent).toBe(
      '1 of 1 prompt',
    );
  });
});

describe('the competitor card (UX audit CP-10)', () => {
  it('shows Selected as its border only, and its buttons over its corner', async () => {
    // The competitor's timeline chart sizes itself; jsdom has no ResizeObserver.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    window.history.replaceState(null, '', '/?competitor=c1');
    await render(false);
    const card = container.querySelector('.group')!;
    // "Selected" is for screen readers only: the name keeps its width.
    expect(card.querySelector('.sr-only')?.textContent).toBe('Selected');
    expect(card.className).toContain('border-primary');
    // The buttons sit over the card's corner, not beside the name.
    const actions = card.querySelector('[data-slot="card-actions"]')!;
    expect(actions.className).toContain('absolute');
    expect(actions.querySelector('button[aria-label="Set type for Rival"]')).not.toBeNull();
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  });
});

describe('a gap’s next steps (UX audit CP-09)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    chatPanel.mockReset().mockReturnValue(null);
    window.history.replaceState(null, '', '/');
  });

  const noParts = {
    answers: 0,
    mentionAnswers: 0,
    citationAnswers: 0,
    invPosition: 0,
    positionCount: 0,
  };
  const gap = (platform: string) => ({
    promptId: 'p1',
    promptText: 'Best CRM for startups',
    platform,
    rawPlatform: platform.toLowerCase(),
    modelUsed: '',
    rawModelUsed: null,
    runs: 12,
    brandScore: 20,
    competitorScore: 60,
    diff: -40,
    latestAt: '2026-11-19T10:00:00Z',
    parts: { brand: noParts, competitor: noParts },
  });

  async function openGaps() {
    const tracking = await import('@/lib/actions/tracking');
    vi.mocked(tracking.getHeadToHeadComparison).mockResolvedValue({
      groups: [gap('ChatGPT'), gap('Gemini')],
      platformRows: [],
      brandAvg: 0,
      competitorAvg: 0,
      gaps: [gap('ChatGPT'), gap('Gemini')],
      strengths: [],
    } as never);
    window.history.replaceState(null, '', '/?competitor=c1');
    await render(false);
  }

  it('offers Create action and Ask Chat on each gap, which write the gap in Chat’s box', async () => {
    const fill = vi.fn();
    chatPanel.mockReturnValue({ available: true, fill });
    await openGaps();
    const create = container.querySelector<HTMLButtonElement>(
      '[data-action="competitors.gapCreateAction"]',
    )!;
    expect(create.textContent).toBe('Create action');
    await act(async () => create.click());
    expect(fill).toHaveBeenLastCalledWith(
      expect.stringContaining('Send this gap to the Action Center'),
    );
    expect(fill.mock.lastCall![0]).toContain('“Best CRM for startups”');
    expect(fill.mock.lastCall![0]).toContain('platforms: ChatGPT, Gemini');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-action="competitors.gapAskChat"]')!.click(),
    );
    expect(fill.mock.lastCall![0]).toMatch(/^Why does Rival score \d+ and we score \d+/);
  });

  it('shows neither where Chat’s panel isn’t', async () => {
    await openGaps();
    expect(container.textContent).toContain('Best CRM for startups');
    expect(container.querySelector('[data-action="competitors.gapCreateAction"]')).toBeNull();
  });
});
