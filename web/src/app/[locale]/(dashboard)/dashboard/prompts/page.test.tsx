import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import type { Prompt } from '@/types';
import type { FirstRun } from '@/hooks/use-first-run';

/**
 * Tracked Prompts on a read-only workspace (plan not active): Add prompt,
 * the row menu, the bulk bar and Analyze open the upgrade dialog, labelled
 * with what was clicked, and write nothing; on an active plan they work as
 * before. The volumes the server refuses it don't read as an outage. The
 * Location filter stays off Query Fan-out, which doesn't use it, and Chat's
 * side panel hears of a location only on the tab that reads one. The header
 * (the owner's simpler one, 2026-11-17): Add prompt and a "…" menu, the
 * Tracked | Suggestions switch beside the date range, Location in the
 * table's filter row and a quiet line for the prompts missing volume and
 * competition, a little apart from the filters.
 */

const actions = vi.hoisted(() => ({
  getPromptsPageData: vi.fn(),
  setPromptActive: vi.fn(),
  setPromptsActive: vi.fn(),
  deletePrompt: vi.fn(),
  deletePrompts: vi.fn(),
  importPrompts: vi.fn(),
  updatePrompt: vi.fn(),
  getLocationQuota: vi.fn(),
  getPromptLocationMatrix: vi.fn(),
  bulkUpdatePromptLocations: vi.fn(),
  bulkUpdatePromptTags: vi.fn(),
}));
vi.mock('@/lib/actions/prompt', () => actions);
// The table's reads go through /api/prompts/read (lib/prompts-reads.ts): the
// rows as getPromptsPageData gives them, and the volumes beside them, here
// what that mock's answer holds (`volumesDegraded`: the volumes read fails).
type PageDataMock = {
  volumes?: unknown[];
  quota?: unknown;
  volumesDegraded?: boolean;
  volumeStatus?: unknown;
};
const pageReads = vi.hoisted(() => ({
  readPromptsPageData: vi.fn(),
  readPromptVolumes: vi.fn(),
}));
// The module's own constants (VOLUME_READ_RETRIES) stay as they are.
vi.mock('@/lib/prompts-reads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/prompts-reads')>()),
  ...pageReads,
}));
const volumesFromPageData = async () => {
  const page = (await actions.getPromptsPageData.getMockImplementation()?.('b1')) as
    | PageDataMock
    | undefined;
  if (page?.volumesDegraded) throw new Error('Failed to load volumes');
  return {
    volumes: page?.volumes ?? [],
    quota: page?.quota ?? null,
    status: page?.volumeStatus ?? null,
  };
};
vi.mock('@/lib/actions/tracking-countries', () => ({ getTrackingCountries: async () => [] }));
const volumes = vi.hoisted(() => ({
  startPromptVolumeAnalysis: vi.fn(),
  getVolumeAnalysisStatus: vi.fn(async () => null),
  refreshVolumes: vi.fn(),
}));
vi.mock('@/lib/actions/volumes', () => volumes);
// The brand's locations, as the Location filter reads them (through
// /api/visibility/read, as Visibility does): none unless a test says so.
const filterOptions = vi.hoisted(() => ({ regions: [] as string[] }));
const visibilityReads = vi.hoisted(() => ({
  getBrandFilterOptions: vi.fn(async () => ({ regions: filterOptions.regions })),
}));
vi.mock('@/lib/visibility-reads', () => visibilityReads);
// The brand's topics, as the Add Prompt dialog reads them: one unless a test says none.
const topicActions = vi.hoisted(() => ({ getTopics: vi.fn() }));
vi.mock('@/lib/actions/topic', () => topicActions);
const COFFEE_TOPIC = {
  id: 't1',
  brandId: 'b1',
  name: 'Coffee',
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
};
const contentUsage = vi.hoisted(() => ({ value: null as object | null }));
const getOpenSuggestionForPrompt = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => null),
);
vi.mock('@/lib/actions/content', () => ({
  getContentUsage: vi.fn(async () => contentUsage.value),
  getGenerationJobStatus: vi.fn(),
  getOpenSuggestionForPrompt,
  suggestContentForPrompt: vi.fn(),
}));
vi.mock('@/lib/actions/content-drafts', () => ({ getDraftForPrompt: vi.fn(async () => null) }));
vi.mock('@/lib/actions/prompt-workflow', () => ({ setPromptWorkStatus: vi.fn() }));
// Start (New content) and the Positions panel have tests of their own.
vi.mock('@/components/content/new-content-dialog', () => ({ NewContentDialog: () => null }));
// The panel's props, as the page opens it.
const sheet = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('@/components/prompts/prompt-positions-sheet', () => ({
  PromptPositionsSheet: (props: Record<string, unknown>) => {
    sheet.props = props;
    return null;
  },
}));
// Improve actions still tracked, by prompt id (PROMPT-008): none unless a test says so.
const improving = vi.hoisted(() => ({ getImprovingPrompts: vi.fn() }));
vi.mock('@/lib/actions/prompt-positions', () => improving);
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => ({ canManage: role.canManage }) }));
// The swap dialog's reads (Simplify PR 16).
const swap = vi.hoisted(() => ({ getSwapOptions: vi.fn(), swapPrompts: vi.fn() }));
vi.mock('@/lib/actions/prompt-swap', () => swap);
// The brand's first run: null unless a test says it goes on.
const firstRun = vi.hoisted(() => ({ run: null as FirstRun | null }));
vi.mock('@/hooks/use-first-run', () => ({ useFirstRun: () => firstRun.run }));
// The Topics tab has tests of its own; here, what the page asks of it.
const topicsTab = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock('./_topics-tab', () => ({
  TopicsTab: (props: Record<string, unknown>) => {
    topicsTab.props.push(props);
    return <div data-testid="topics-tab" />;
  },
}));
vi.mock('./_fanout-tab', () => ({ QueryFanoutTab: () => <div data-testid="fanout-tab" /> }));
vi.mock('./_suggestions-tab', () => ({
  SuggestionsTab: () => <div data-testid="suggestions-tab" />,
}));
// A download's name, without reading the workspace's white-label kit.
vi.mock('@/lib/white-label/export-name', () => ({
  exportFileName: vi.fn(async (rest: string) => `Ansvisor_${rest}`),
}));

// The workspace's brands: b1 unless a test switches brands mid-render.
const brandState = vi.hoisted(() => ({
  current: {
    activeBrandId: 'b1',
    brands: [{ id: 'b1', slug: 'acme', name: 'Acme' }],
  } as { activeBrandId: string; brands: { id: string; slug: string; name: string }[] },
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (state: unknown) => unknown) => select(brandState.current),
}));
// The page's query string: empty unless a test says otherwise.
const query = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query.search) }));
// The route names the tab: Tracked unless a test opens Insights.
const nav = vi.hoisted(() => ({ pathname: '/dashboard/prompts/tracked', push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
);
vi.mock('sonner', () => ({ toast }));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => analytics);
// Track now's API call. Which prompts have no answers comes with the table's read.
const trackNowApi = vi.hoisted(() => ({ trackPromptsNow: vi.fn() }));
vi.mock('@/lib/track-now', () => trackNowApi);
const jobStore = vi.hoisted(() => ({ saveTrackingJob: vi.fn(), loadTrackingJob: () => null }));
vi.mock('@/lib/tracking-job-store', () => jobStore);

const { default: PromptsPage } = await import('./page');
const { ChatPageSetterContext } = await import('@/components/chat/panel/chat-panel-context');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const prompt: Prompt = {
  id: 'p1',
  promptSetId: 'set-1',
  text: 'Best coffee subscription?',
  platforms: ['chatgpt'],
  regions: ['US'],
  models: [],
  isActive: true,
  workStatus: null,
  targetUrlCount: 0,
  citedUrlCount: 0,
  tags: [],
  createdAt: '2026-09-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked: boolean, setChatPage: ((page: unknown) => void) | null = null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatPageSetterContext.Provider value={setChatPage}>
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <PromptsPage />
          </UpgradeDialogContext.Provider>
        </ChatPageSetterContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  );
const dialog = () => document.querySelector('[role="dialog"]');
// The quiet line above the table for the prompts missing volume and competition, and its Analyze.
const notAnalyzed = () => container.querySelector<HTMLElement>('[data-not-analyzed]');
const analyzeButton = () => notAnalyzed()?.querySelector<HTMLButtonElement>('button') ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/dashboard/prompts/tracked';
  query.search = '';
  role.canManage = true;
  brandState.current = {
    activeBrandId: 'b1',
    brands: [{ id: 'b1', slug: 'acme', name: 'Acme' }],
  };
  actions.bulkUpdatePromptTags.mockResolvedValue({ updated: 1, unchanged: 0, blocked: 0 });
  swap.getSwapOptions.mockResolvedValue({ error: 'not read in these tests' });
  filterOptions.regions = [];
  firstRun.run = null;
  contentUsage.value = null;
  getOpenSuggestionForPrompt.mockResolvedValue(null);
  improving.getImprovingPrompts.mockResolvedValue({});
  sheet.props = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  );
  actions.getPromptsPageData.mockResolvedValue({
    volumes: [],
    quota: null,
    promptSets: [{ prompts: [prompt] }],
    visibility: {},
    positions: {},
  });
  actions.setPromptsActive.mockResolvedValue({ updated: 1 });
  // Reset, not cleared: a test's one-off answers never reach the next one.
  pageReads.readPromptsPageData
    .mockReset()
    .mockImplementation((...args: unknown[]) => actions.getPromptsPageData(...args));
  pageReads.readPromptVolumes.mockReset().mockImplementation(volumesFromPageData);
  visibilityReads.getBrandFilterOptions
    .mockReset()
    .mockImplementation(async () => ({ regions: filterOptions.regions }));
  topicActions.getTopics.mockResolvedValue([COFFEE_TOPIC]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Tracked Prompts during the brand's first run", () => {
  it('says the first answers are arriving above the table, and nothing once it is done', async () => {
    firstRun.run = {
      brandId: 'b1',
      queued: false,
      progress: { current: 18, total: 40 },
      left: { minutes: 6 },
    };
    await render(false);
    expect(container.textContent).toContain(
      'Your first answers are arriving (18 of 40) · ~6 min. This fills in when tracking finishes.',
    );

    firstRun.run = null;
    await render(false);
    expect(container.textContent).not.toContain('Your first answers are arriving');
  });
});

describe('Tracked Prompts on a read-only workspace', () => {
  it('opens the upgrade dialog from Add prompt, not the Add Prompt dialog', async () => {
    await render(true);
    await act(async () => button('Add prompt')!.click());
    expect(openUpgrade).toHaveBeenCalledWith('Adding prompts needs a plan');
    expect(dialog()).toBeNull();
  });

  it('opens Add Prompt on an active plan', async () => {
    await render(false);
    await act(async () => button('Add prompt')!.click());
    expect(openUpgrade).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it('pauses nothing from the row menu or the bulk bar', async () => {
    await render(true);
    const trigger = container.querySelector<HTMLElement>(
      `[aria-label="Actions for ${prompt.text}"]`,
    )!;
    await act(async () => trigger.click());
    const pause = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === 'Pause tracking',
    )!;
    await act(async () => pause.click());
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenLastCalledWith('Pausing prompts needs a plan');
    expect(actions.setPromptActive).not.toHaveBeenCalled();

    const box = container.querySelector<HTMLElement>(`[aria-label="Select ${prompt.text}"]`)!;
    await act(async () => box.click());
    await act(async () => button('Pause')!.click());
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(openUpgrade).toHaveBeenLastCalledWith('Pausing prompts needs a plan');
    expect(actions.setPromptsActive).not.toHaveBeenCalled();
  });

  it('pauses from the bulk bar on an active plan', async () => {
    await render(false);
    const box = container.querySelector<HTMLElement>(`[aria-label="Select ${prompt.text}"]`)!;
    await act(async () => box.click());
    await act(async () => button('Pause')!.click());
    expect(actions.setPromptsActive).toHaveBeenCalledWith(['p1'], false);
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});

describe("the Work cell's Improve link (PROMPT-008)", () => {
  const other: Prompt = { ...prompt, id: 'p2', text: 'Cheapest coffee beans?' };
  const AC12 = { actionId: 'a12', actionNo: 1497, brandNo: 12, avgBefore: null, avgAfter: null };
  const links = () =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent === 'AC-12 · Improving',
    );

  const withImproving = (improvingByPrompt: Record<string, typeof AC12>) =>
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [prompt, other] }],
      visibility: {},
      positions: {},
      improving: improvingByPrompt,
    });

  beforeEach(() => {
    withImproving({ p1: AC12 });
  });

  it('shows it under the Work chip only on rows whose Improve action is still tracked', async () => {
    await render(false);
    // It comes with the table's read: no read of its own, a page or a row at a time.
    expect(improving.getImprovingPrompts).not.toHaveBeenCalled();
    expect(actions.getPromptsPageData).toHaveBeenCalledTimes(1);
    expect(links()).toHaveLength(1);
    const cell = links()[0].closest('td')!;
    expect(cell.closest('tr')!.textContent).toContain(prompt.text);
    expect(cell.querySelector('[aria-label="Set work status"]')).not.toBeNull();
    expect(links()[0].title).toBe('Open the Improve tab · AC-12 is still being tracked');
  });

  it("opens the prompt's panel on its Improve tab", async () => {
    await render(false);
    expect(sheet.props?.prompt).toBeNull();
    await act(async () => links()[0].click());
    expect(sheet.props).toMatchObject({
      prompt: { id: 'p1', text: prompt.text },
      initialTab: 'improve',
    });
  });

  it('leaves the Work cell as it was on rows without one', async () => {
    withImproving({});
    await render(false);
    expect(links()).toHaveLength(0);
    expect(container.textContent).not.toContain('Improving');
  });
});

describe('prompts waiting for a spot', () => {
  // Saved past the plan's limit (PR 15): inactive, waiting since yesterday.
  const waiting: Prompt = {
    ...prompt,
    id: 'p2',
    text: 'Best cold brew concentrate?',
    isActive: false,
    waitingSince: '2026-11-10T09:00:00.000Z',
  };
  const older: Prompt = {
    ...waiting,
    id: 'p3',
    text: 'Cold brew ratio?',
    waitingSince: '2026-11-09T09:00:00.000Z',
  };
  const withWaiting = (...list: Prompt[]) =>
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [prompt, ...list] }],
      visibility: {},
      positions: {},
    });
  const banner = () => container.querySelector<HTMLElement>('[data-waiting-banner]');

  it('says how many wait in a yellow banner, and shows them with their own pill and filter', async () => {
    withWaiting(waiting, older);
    await render(false);
    expect(banner()?.textContent).toContain('2 prompts waiting for a spot');
    // Tracked opens without them.
    expect(container.textContent).not.toContain('Best cold brew concentrate?');
    await act(async () => button('Show them')!.click());
    expect(container.textContent).toContain('Prompts waiting for a spot (2)');
    expect(container.textContent).toContain('Best cold brew concentrate?');
    const pills = [...container.querySelectorAll('[title]')].filter(
      (el) => el.textContent === 'Waiting for a spot',
    );
    expect(pills).toHaveLength(2);
    expect(container.textContent).not.toContain('Best coffee subscription?');
  });

  it('opens the swap dialog for the prompt waiting longest from Free up a spot', async () => {
    withWaiting(waiting, older);
    await render(false);
    await act(async () => button('Free up a spot')!.click());
    expect(swap.getSwapOptions).toHaveBeenCalledWith('p3');
    expect(dialog()).not.toBeNull();
  });

  it('opens the swap dialog when tracking one from its row finds no room', async () => {
    withWaiting(waiting);
    actions.setPromptActive.mockResolvedValue({ error: 'Your plan…', code: 'plan_limit' });
    await render(false);
    await act(async () => button('Show them')!.click());
    const trigger = container.querySelector<HTMLElement>(
      `[aria-label="Actions for ${waiting.text}"]`,
    )!;
    await act(async () => trigger.click());
    const track = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === 'Track it',
    )!;
    await act(async () => track.click());
    expect(actions.setPromptActive).toHaveBeenCalledWith('p2', true);
    expect(swap.getSwapOptions).toHaveBeenCalledWith('p2');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("opens on the waiting prompts and the dialog from Today's link", async () => {
    withWaiting(waiting, older);
    query.search = 'status=waiting&swap=1';
    await render(false);
    expect(container.textContent).toContain('Prompts waiting for a spot (2)');
    expect(swap.getSwapOptions).toHaveBeenCalledWith('p3');
  });

  it('shows a member the banner and the pill, with no action, and nothing once the plan ended', async () => {
    withWaiting(waiting);
    role.canManage = false;
    query.search = 'status=waiting&swap=1';
    await render(false);
    expect(banner()?.textContent).toContain('1 prompt waiting for a spot');
    expect(button('Show them')).toBeDefined();
    expect(button('Free up a spot')).toBeUndefined();
    expect(container.textContent).toContain('Waiting for a spot');
    expect(swap.getSwapOptions).not.toHaveBeenCalled();

    role.canManage = true;
    await render(true);
    expect(banner()).not.toBeNull();
    expect(button('Free up a spot')).toBeUndefined();
  });
});

describe('the Location filter', () => {
  const locationFilter = () => document.querySelector<HTMLElement>('[aria-label="Location"]');

  it('shows on Tracked Prompts for a brand tracked in more than one location', async () => {
    filterOptions.regions = ['US', 'GB'];
    await render(false);
    expect(locationFilter()).not.toBeNull();
  });

  it('is left off for a brand tracked in one location', async () => {
    filterOptions.regions = ['US'];
    await render(false);
    expect(locationFilter()).toBeNull();
  });

  it("is left off Query Fan-out, which doesn't use it", async () => {
    filterOptions.regions = ['US', 'GB'];
    nav.pathname = '/dashboard/prompts/fan-outs';
    await render(false);
    expect(container.querySelector('[data-testid="fanout-tab"]')).not.toBeNull();
    expect(locationFilter()).toBeNull();
  });
});

describe('the Tags filter (#2378)', () => {
  const tagged = (id: string, text: string, tags: string[]): Prompt => ({
    ...prompt,
    id,
    text,
    tags,
  });
  const both = tagged('p1', 'Best coffee subscription?', ['coffee', 'priority']);
  const coffeeOnly = tagged('p2', 'Top espresso machines?', ['coffee']);
  const neither = tagged('p3', 'Decaf options?', ['decaf']);

  const renderTagged = async () => {
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [both, coffeeOnly, neither] }],
      visibility: {},
      positions: {},
    });
    await render(false);
  };
  const openTagFilter = async () => {
    const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === 'Tags',
    )!;
    await act(async () => trigger.click());
  };
  const toggleTag = async (tag: string) => {
    const box = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(
      (el) => el.getAttribute('aria-label') === tag,
    )!;
    await act(async () => box.click());
  };
  const matchSelect = () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === 'Match',
    );
  const typeSearch = async (text: string) => {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search prompts…"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('shows every prompt while no tag is picked', async () => {
    await renderTagged();
    expect(container.textContent).toContain(both.text);
    expect(container.textContent).toContain(coffeeOnly.text);
    expect(container.textContent).toContain(neither.text);
    expect(button('All tags')).toBeDefined();
  });

  it('keeps the prompts carrying one picked tag, and offers no match mode yet', async () => {
    await renderTagged();
    await openTagFilter();
    await toggleTag('coffee');
    expect(container.textContent).toContain(both.text);
    expect(container.textContent).toContain(coffeeOnly.text);
    expect(container.textContent).not.toContain(neither.text);
    expect(button('1 tag')).toBeDefined();
    expect(matchSelect()).toBeUndefined();
  });

  it('matches every picked tag by default', async () => {
    await renderTagged();
    await openTagFilter();
    await toggleTag('coffee');
    await toggleTag('priority');
    expect(container.textContent).toContain(both.text);
    expect(container.textContent).not.toContain(coffeeOnly.text);
    expect(container.textContent).not.toContain(neither.text);
    expect(matchSelect()?.textContent).toContain('Match all');
  });

  it('matches any picked tag when asked', async () => {
    await renderTagged();
    await openTagFilter();
    await toggleTag('coffee');
    await toggleTag('priority');
    await act(async () => matchSelect()!.click());
    const any = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (el) => el.textContent === 'Match any',
    )!;
    await act(async () => {
      any.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await act(async () => any.click());
    expect(container.textContent).toContain(both.text);
    expect(container.textContent).toContain(coffeeOnly.text);
    expect(container.textContent).not.toContain(neither.text);
  });

  it('combines with the search box', async () => {
    await renderTagged();
    await openTagFilter();
    await toggleTag('coffee');
    await typeSearch('espresso');
    expect(container.textContent).not.toContain(both.text);
    expect(container.textContent).toContain(coffeeOnly.text);
    expect(container.textContent).not.toContain(neither.text);
  });

  const selectRow = async (text: string) => {
    const box = container.querySelector<HTMLElement>(`[aria-label="Select ${text}"]`)!;
    await act(async () => box.click());
  };
  const openBulkTags = async (item: 'Add tags' | 'Remove tags') => {
    await act(async () => button('Tags')!.click());
    const menuItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === item,
    )!;
    await act(async () => menuItem.click());
  };
  const saveDialog = async (label: string) => {
    const save = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    )!;
    await act(async () => save.click());
    await act(async () => {});
  };

  it('lets go of a filtered tag a bulk removal takes off its last prompt', async () => {
    await renderTagged();
    await openTagFilter();
    await toggleTag('priority');
    // Only p1 carries priority: the table shows just it.
    expect(container.textContent).toContain(both.text);
    expect(container.textContent).not.toContain(coffeeOnly.text);

    // The maintainer's scenario: filter by a tag, then bulk-remove it.
    await selectRow(both.text);
    await openBulkTags('Remove tags');
    // The reload the save triggers brings the roster back without the tag.
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [{ ...both, tags: ['coffee'] }, coffeeOnly, neither] }],
      visibility: {},
      positions: {},
    });
    const badge = [...dialog()!.querySelectorAll<HTMLElement>('button')].find((b) =>
      b.textContent?.includes('priority'),
    )!;
    await act(async () => badge.click());
    await saveDialog('Remove from 1 prompt');

    // The filter lets the removed tag go: every prompt is back, not a table
    // stuck empty on a tag the popover no longer lists.
    expect(actions.bulkUpdatePromptTags).toHaveBeenCalledWith(['p1'], 'remove', ['priority']);
    expect(container.textContent).toContain(both.text);
    expect(container.textContent).toContain(coffeeOnly.text);
    expect(container.textContent).toContain(neither.text);
    expect(button('All tags')).toBeDefined();
  });

  it('keeps the picked tags that still exist when only one is removed', async () => {
    await renderTagged();
    await openTagFilter();
    await toggleTag('coffee');
    await toggleTag('priority');
    expect(container.textContent).toContain(both.text);
    expect(container.textContent).not.toContain(coffeeOnly.text);

    await selectRow(both.text);
    await openBulkTags('Remove tags');
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [{ ...both, tags: ['coffee'] }, coffeeOnly, neither] }],
      visibility: {},
      positions: {},
    });
    const badge = [...dialog()!.querySelectorAll<HTMLElement>('button')].find((b) =>
      b.textContent?.includes('priority'),
    )!;
    await act(async () => badge.click());
    await saveDialog('Remove from 1 prompt');

    // coffee still filters; only the gone tag left the filter.
    expect(button('1 tag')).toBeDefined();
    expect(container.textContent).toContain(both.text);
    expect(container.textContent).toContain(coffeeOnly.text);
    expect(container.textContent).not.toContain(neither.text);
  });

  it('hides the filter once no tags remain, with the table back in full', async () => {
    const only = tagged('p1', 'Best coffee subscription?', ['coffee']);
    const plain = tagged('p2', 'Decaf options?', []);
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [only, plain] }],
      visibility: {},
      positions: {},
    });
    await render(false);
    await openTagFilter();
    await toggleTag('coffee');
    expect(container.textContent).toContain(only.text);
    expect(container.textContent).not.toContain(plain.text);

    await selectRow(only.text);
    await openBulkTags('Remove tags');
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [{ ...only, tags: [] }, plain] }],
      visibility: {},
      positions: {},
    });
    const badge = [...dialog()!.querySelectorAll<HTMLElement>('button')].find((b) =>
      b.textContent?.includes('coffee'),
    )!;
    await act(async () => badge.click());
    await saveDialog('Remove from 1 prompt');

    // No tags left anywhere: the filter control goes, and the table is not
    // stuck empty behind an invisible filter.
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.getAttribute('aria-label') === 'Tags',
      ),
    ).toBeUndefined();
    expect(container.textContent).toContain(only.text);
    expect(container.textContent).toContain(plain.text);
  });

  it('resets the picked tags on a brand switch', async () => {
    await renderTagged();
    await openTagFilter();
    await toggleTag('coffee');
    expect(container.textContent).not.toContain(neither.text);

    await act(async () => {
      brandState.current = {
        activeBrandId: 'b2',
        brands: [{ id: 'b2', slug: 'beta', name: 'Beta' }],
      };
    });
    await render(false);

    // The old brand's tags don't filter the new brand's roster.
    expect(button('All tags')).toBeDefined();
    expect(container.textContent).toContain(both.text);
    expect(container.textContent).toContain(coffeeOnly.text);
    expect(container.textContent).toContain(neither.text);
  });

  it('says so in the dialog when saving the tags throws', async () => {
    await renderTagged();
    await selectRow(both.text);
    await openBulkTags('Add tags');
    const input = dialog()!.querySelector<HTMLInputElement>('#bulk-prompt-tags')!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setter.call(input, 'q4-push');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    actions.bulkUpdatePromptTags.mockRejectedValue(new Error('fetch failed'));
    await saveDialog('Add to 1 prompt');

    // The rejection surfaces in the dialog, which stays open and usable.
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain("Couldn't save the tags. Try again.");
    expect(toast.success).not.toHaveBeenCalled();
    const save = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Add to 1 prompt',
    )!;
    expect(save.disabled).toBe(false);
  });
});

describe("what Chat's side panel sees", () => {
  // A link that carries a location from Tracked Prompts to every tab.
  const filtersOn = async (pathname: string) => {
    filterOptions.regions = ['US', 'GB'];
    query.search = 'region=GB';
    nav.pathname = pathname;
    const setChatPage = vi.fn();
    await render(false, setChatPage);
    return setChatPage.mock.lastCall![0].filters;
  };

  it('names the location on Tracked Prompts, whose table it filters', async () => {
    expect(await filtersOn('/dashboard/prompts/tracked')).toEqual([
      { key: 'region', label: expect.stringContaining('United Kingdom'), value: 'GB' },
    ]);
  });

  it.each([
    ['Query Fan-out', '/dashboard/prompts/fan-outs'],
    ['Topics', '/dashboard/prompts/topics'],
    ['Insights', '/dashboard/prompts/insights'],
  ])("leaves the location out on %s, which doesn't read it", async (_tab, pathname) => {
    expect(await filtersOn(pathname)).toEqual([]);
  });

  // The owner's plan (2026-11-16, item 8): the open tab, the table's sort and search, its rows.
  it("tells the open tab, and on Tracked the table's sort, search and the prompts on screen", async () => {
    const decaf: Prompt = { ...prompt, id: 'p2', text: 'Best decaf coffee?' };
    const tea: Prompt = { ...prompt, id: 'p3', text: 'Green tea brands?' };
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [prompt, decaf, tea] }],
      visibility: {},
      positions: {},
    });
    query.search = 'sort=added&dir=asc';
    const setChatPage = vi.fn();
    await render(false, setChatPage);
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search prompts…"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setter.call(input, ' coffee ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(setChatPage.mock.lastCall![0].view).toEqual({
      tab: 'tracked',
      sort: { key: 'added', dir: 'asc' },
      search: 'coffee',
      rows: [
        { ref: 'p1', label: prompt.text },
        { ref: 'p2', label: decaf.text },
      ],
      total: 2,
    });
    // Another tab: its name only.
    nav.pathname = '/dashboard/prompts/topics';
    query.search = '';
    act(() => root.unmount());
    root = createRoot(container);
    await render(false, setChatPage);
    expect(setChatPage.mock.lastCall![0].view).toEqual({ tab: 'topics' });
  });

  it('sends no sort until a header is picked: the default is the order line’s', async () => {
    const setChatPage = vi.fn();
    await render(false, setChatPage);
    expect(setChatPage.mock.lastCall![0].view).toEqual({
      tab: 'tracked',
      rows: [{ ref: 'p1', label: prompt.text }],
      total: 1,
    });
  });
});

describe('Add Prompt on a brand without topics', () => {
  // A button, not a link: the page reads its tab from the route only when it opens.
  const addTopic = () =>
    [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Add a topic');
  const typePrompt = async (text: string) => {
    const input = dialog()!.querySelector<HTMLInputElement>('input')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('asks for a topic first instead of the form, with a way to the Topics tab', async () => {
    topicActions.getTopics.mockResolvedValue([]);
    await render(false);
    await act(async () => button('Add prompt')!.click());
    expect(dialog()?.textContent).toContain('Add a topic first');
    expect(addTopic()).toBeDefined();
    expect(button('Save & close')).toBeUndefined();
    expect(actions.importPrompts).not.toHaveBeenCalled();
  });

  it('switches to the Topics tab in place with Add Topic asked for, closing the dialog', async () => {
    topicActions.getTopics.mockResolvedValue([]);
    topicsTab.props = [];
    await render(false);
    await act(async () => button('Add prompt')!.click());
    await act(async () => addTopic()!.click());
    await act(async () => {});
    expect(dialog()).toBeNull();
    expect(window.location.pathname).toBe('/dashboard/prompts/topics');
    expect(document.querySelector('[data-testid="topics-tab"]')).not.toBeNull();
    expect(topicsTab.props.at(-1)).toMatchObject({ openAddTopic: true });

    // Once the tab has opened it, the request is handed back.
    await act(async () => (topicsTab.props.at(-1)!.onAddTopicOpened as () => void)());
    expect(topicsTab.props.at(-1)).toMatchObject({ openAddTopic: false });
  });

  it('shows the form as before when the brand has a topic', async () => {
    await render(false);
    await act(async () => button('Add prompt')!.click());
    expect(dialog()?.textContent).not.toContain('Add a topic first');
    expect(button('Save & close')).toBeDefined();
  });

  it('reads the topics again on every open, so one added since counts', async () => {
    topicActions.getTopics.mockResolvedValueOnce([]);
    await render(false);
    await act(async () => button('Add prompt')!.click());
    expect(dialog()?.textContent).toContain('Add a topic first');
    await act(async () => button('Cancel')!.click());
    await act(async () => button('Add prompt')!.click());
    expect(dialog()?.textContent).not.toContain('Add a topic first');
    expect(topicActions.getTopics).toHaveBeenCalledTimes(2);
  });

  it('asks for a topic first when saving finds the brand has none left', async () => {
    actions.importPrompts.mockResolvedValue({
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    await render(false);
    await act(async () => button('Add prompt')!.click());
    await typePrompt('Best espresso beans?');
    await act(async () => button('Save & close')!.click());
    expect(actions.importPrompts).toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Add a topic first');
    expect(addTopic()).toBeDefined();
  });
});

describe("Add Prompt's prompt_add flow", () => {
  const flows = () =>
    analytics.track.mock.calls.filter(([event]) => String(event).startsWith('flow_'));
  const typePrompt = async (text: string) => {
    const input = dialog()!.querySelector<HTMLInputElement>('input')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  async function save(text = 'Best espresso beans?') {
    await render(false);
    await act(async () => button('Add prompt')!.click());
    await typePrompt(text);
    await act(async () => button('Save & close')!.click());
  }

  it('starts as the dialog opens and completes once prompts are added, never sending them', async () => {
    actions.importPrompts.mockResolvedValue({
      importedIdx: [0],
      promptIds: ['p2'],
      analysisStarted: true,
    });
    await save();
    expect(flows()).toEqual([
      ['flow_started', { flow: 'prompt_add' }],
      ['flow_completed', { flow: 'prompt_add' }],
    ]);
    expect(JSON.stringify(analytics.track.mock.calls)).not.toContain('espresso');
  });

  it('fails with the server’s code, and with none when the save broke', async () => {
    actions.importPrompts.mockResolvedValueOnce({ error: 'Add a topic first.', code: 'no_topics' });
    await save();
    act(() => root.unmount());
    root = createRoot(container);
    actions.importPrompts.mockRejectedValueOnce(new Error('Failed to fetch'));
    await save();
    expect(flows()).toEqual([
      ['flow_started', { flow: 'prompt_add' }],
      ['flow_failed', { flow: 'prompt_add', error_code: 'no_topics' }],
      ['flow_started', { flow: 'prompt_add' }],
      ['flow_failed', { flow: 'prompt_add', error_code: null }],
    ]);
  });

  it('fails as nothing added when the limit or duplicates take every prompt', async () => {
    actions.importPrompts.mockResolvedValue({
      importedIdx: [],
      promptIds: [],
      analysisStarted: false,
    });
    await save();
    expect(flows()).toEqual([
      ['flow_started', { flow: 'prompt_add' }],
      ['flow_failed', { flow: 'prompt_add', error_code: 'none_added' }],
    ]);
  });
});

describe('locations on a read-only workspace (PROMPT-015)', () => {
  // Tracked in the US and Germany; the second prompt only in the US, so its
  // Germany cell offers + Track.
  const twoPlaces: Prompt = { ...prompt, regions: ['US', 'DE'] };
  const usOnly: Prompt = { ...prompt, id: 'p2', text: 'Coffee beans every week?', regions: ['US'] };

  beforeEach(() => {
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [twoPlaces, usOnly] }],
      visibility: {},
      positions: {},
    });
    actions.getLocationQuota.mockResolvedValue({
      maxPrompts: 200,
      used: 3,
      planId: 'growth',
      planName: 'Growth',
    });
    actions.getPromptLocationMatrix.mockResolvedValue({});
  });
  // The view is kept in the URL (?layout=locations): the next tests start on the table.
  afterEach(() => window.history.replaceState(null, '', window.location.pathname));

  const openMenu = async (trigger: HTMLElement) => {
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };
  const showLocations = async () => {
    await act(async () => button('Locations')!.click());
    await act(async () => {});
  };

  it('opens the upgrade dialog, not the locations one, from every way in', async () => {
    await render(true);

    // The bulk bar's Locations menu, on the selection.
    const box = container.querySelector<HTMLElement>(`[aria-label="Select ${prompt.text}"]`)!;
    await act(async () => box.click());
    const bulk = [...container.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find(
      (b) => b.textContent === 'Locations',
    )!;
    let items = await openMenu(bulk);
    await act(async () => items.find((i) => i.textContent === 'Remove locations')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Removing locations needs a plan');
    items = await openMenu(bulk);
    await act(async () => items.find((i) => i.textContent === 'Add locations')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Changing locations needs a plan');
    await act(async () => box.click());

    await showLocations();
    // A column's menu.
    items = await openMenu(
      container.querySelector<HTMLElement>('[aria-label="Actions for Germany"]')!,
    );
    await act(async () => items.find((i) => i.textContent === 'Stop tracking in Germany')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Removing locations needs a plan');
    // A cell's ×.
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          `[aria-label="Stop tracking “${prompt.text}” in Germany"]`,
        )!
        .click(),
    );
    expect(openUpgrade).toHaveBeenLastCalledWith('Removing locations needs a plan');
    // A cell's + Track, and + Add location.
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(`[aria-label="Track “${usOnly.text}” in Germany"]`)!
        .click(),
    );
    expect(openUpgrade).toHaveBeenLastCalledWith('Changing locations needs a plan');
    await act(async () => button('+ Add location')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Changing locations needs a plan');

    expect(openUpgrade).toHaveBeenCalledTimes(6);
    expect(dialog()).toBeNull();
    expect(actions.bulkUpdatePromptLocations).not.toHaveBeenCalled();
  });

  it("opens stop tracking on a column's prompts on an active plan", async () => {
    await render(false);
    await showLocations();
    const items = await openMenu(
      container.querySelector<HTMLElement>('[aria-label="Actions for Germany"]')!,
    );
    await act(async () => items.find((i) => i.textContent === 'Stop tracking in Germany')!.click());
    expect(openUpgrade).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Stop tracking in locations');
  });
});

describe('volumes on a read-only workspace', () => {
  // The prompt has no volume yet: the not-analyzed line offers Analyze.
  const pageData = (volumesDegraded: boolean) => ({
    volumes: [],
    quota: null,
    promptSets: [{ prompts: [prompt] }],
    visibility: {},
    positions: {},
    volumesDegraded,
    visibilityDegraded: false,
  });

  it('starts no analysis: Analyze opens the upgrade dialog', async () => {
    await render(true);
    await act(async () => analyzeButton()!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Analyzing prompts needs a plan');
    expect(volumes.startPromptVolumeAnalysis).not.toHaveBeenCalled();
  });

  it('opens the upgrade dialog, not "not part of your plan", when the server says the plan ended', async () => {
    volumes.startPromptVolumeAnalysis.mockResolvedValue({
      ok: false,
      code: 'subscription_inactive',
    });
    await render(false);
    await act(async () => analyzeButton()!.click());
    expect(volumes.startPromptVolumeAnalysis).toHaveBeenCalledWith('b1', false);
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says nothing broke when the refused volumes leave their columns empty', async () => {
    actions.getPromptsPageData.mockResolvedValue(pageData(true));
    await render(true);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('still warns of a volumes outage on an active plan', async () => {
    actions.getPromptsPageData.mockResolvedValue(pageData(true));
    await render(false);
    expect(toast.warning).toHaveBeenCalledWith(
      'Volume data is temporarily unavailable — showing prompts without it.',
    );
  });
});

describe('the volume quota without an active plan', () => {
  // The server reads 0 of 0 with `noPlan` once the plan has ended.
  const noPlan = { used: 3, limit: 0, remaining: 0, noPlan: true };
  const pageData = (quota: object | null) => ({
    volumes: [],
    quota,
    promptSets: [{ prompts: [prompt] }],
    visibility: {},
    positions: {},
  });
  const reds = () => container.querySelectorAll('.text-red-500');

  it('offers Analyze on Tracked, not "limit reached", and it opens the upgrade dialog', async () => {
    actions.getPromptsPageData.mockResolvedValue(pageData(noPlan));
    await render(true);
    expect(notAnalyzed()?.textContent).toContain('Volume and competition missing for 1 prompt');
    expect(notAnalyzed()?.getAttribute('title')).toContain('Run volume analysis to fill in');
    expect(container.textContent).not.toContain('limit reached');
    const analyze = analyzeButton()!;
    expect(analyze.disabled).toBe(false);
    await act(async () => analyze.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Analyzing prompts needs a plan');
    expect(volumes.startPromptVolumeAnalysis).not.toHaveBeenCalled();
  });

  it("keeps the row menu's Suggest content clickable at a content quota of 0 of 0: it opens the upgrade dialog", async () => {
    contentUsage.value = {
      plan: 'growth',
      planName: 'Growth',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      opportunities: { used: 2, limit: 0, remaining: 0, perRequest: 0, noPlan: true },
      briefs: { used: 0, limit: 0, remaining: 0, noPlan: true },
      noPlan: true,
    };
    await render(true);
    const trigger = container.querySelector<HTMLElement>(
      `[aria-label="Actions for ${prompt.text}"]`,
    )!;
    await act(async () => trigger.click());
    const suggest = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
      el.textContent?.startsWith('Suggest content'),
    )!;
    expect(suggest.textContent).toBe('Suggest content');
    expect(suggest.hasAttribute('data-disabled')).toBe(false);
    await act(async () => suggest.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Suggesting content needs a plan');
  });

  it("opens the prompt's content suggestion from the row menu, which costs nothing", async () => {
    contentUsage.value = {
      plan: 'growth',
      planName: 'Growth',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      opportunities: { used: 2, limit: 0, remaining: 0, perRequest: 0, noPlan: true },
      briefs: { used: 0, limit: 0, remaining: 0, noPlan: true },
      noPlan: true,
    };
    getOpenSuggestionForPrompt.mockResolvedValue('opp-1');
    await render(true);
    const trigger = container.querySelector<HTMLElement>(
      `[aria-label="Actions for ${prompt.text}"]`,
    )!;
    await act(async () => trigger.click());
    expect(getOpenSuggestionForPrompt).toHaveBeenCalledWith('p1');
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const open = items.find((el) => el.textContent === 'Open content suggestion')!;
    expect(open).toBeDefined();
    expect(items.some((el) => el.textContent?.startsWith('Suggest content'))).toBe(false);
    await act(async () => open.click());
    expect(nav.push).toHaveBeenCalledWith('/dashboard/content?opportunity=opp-1');
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('says "No active plan" on Insights, not a red 0/0 or "limit reached"', async () => {
    nav.pathname = '/dashboard/prompts/insights';
    actions.getPromptsPageData.mockResolvedValue(pageData(noPlan));
    await render(true);
    expect(container.textContent).toContain('No active plan');
    expect(container.textContent).not.toContain('0/0');
    expect(container.textContent).not.toContain('Monthly analysis limit reached');
    expect(reds()).toHaveLength(0);
    const analyze = button('Analyze Volumes')!;
    expect(analyze.disabled).toBe(false);
    await act(async () => analyze.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Analyzing prompts needs a plan');
  });

  it('still says the limit is reached, in red, once an active plan is used up', async () => {
    nav.pathname = '/dashboard/prompts/insights';
    actions.getPromptsPageData.mockResolvedValue(pageData({ used: 10, limit: 10, remaining: 0 }));
    await render(false);
    expect(container.textContent).toContain('0/10 analyses left');
    expect(container.textContent).toContain('Monthly analysis limit reached');
    expect(container.textContent).not.toContain('No active plan');
    expect(reds().length).toBeGreaterThan(0);
    expect(button('Analyze Volumes')!.disabled).toBe(true);
  });
});

describe('the Prompt Volumes chart', () => {
  it('says the rate the volumes were estimated with, as the AI Adoption Rate card does', async () => {
    nav.pathname = '/dashboard/prompts/insights';
    actions.getPromptsPageData.mockResolvedValue({
      quota: { used: 1, limit: 10, remaining: 9 },
      promptSets: [{ prompts: [prompt] }],
      visibility: {},
      positions: {},
      volumes: [
        {
          id: 'v1',
          promptId: 'p1',
          promptText: prompt.text,
          promptCategory: 'Coffee',
          intent: 'commercial',
          keywords: ['coffee subscription'],
          googleVolumes: { 'coffee subscription': 1000 },
          totalGoogleVolume: 1000,
          aiVolumeMultiplier: 0.4,
          estAiVolume: 400,
          competitionIndex: null,
          competition: null,
          fetchedAt: '2026-10-20T00:00:00.000Z',
        },
      ],
    });
    await render(false);
    // The row's rate, not the default: the card and the caption say the same
    // one, and the caption claims no other share of Google searches.
    expect(container.textContent).toContain('AI Adoption Rate40%');
    expect(container.textContent).toContain('Google volume × the 40% AI adoption rate');
    expect(container.textContent).not.toMatch(/~\d+% of Google searches/);
  });
});

describe('the header', () => {
  const usageSummary = (locationsUsed: number) => ({
    plan: { key: 'starter', name: 'Starter plan', locationLimit: 50, cta: 'upgrade_growth' },
    brand: { active: 1, paused: 0, total: 1 },
    account: { activePrompts: 1, brands: 1, locationsUsed },
    updatedAt: '2026-11-17T09:00:00.000Z',
  });
  // The usage cards' read (GET /api/prompts/usage) answers with these counts.
  const usageReads = (locationsUsed = 10) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => usageSummary(locationsUsed) })),
    );
  const more = () => container.querySelector<HTMLElement>('[aria-label="More actions"]');
  const openMore = async () => {
    const trigger = more()!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };
  const item = (items: HTMLElement[], text: string) =>
    items.find((el) => el.textContent?.startsWith(text))!;
  const usagePanel = () => container.querySelector('section[aria-label="Prompt usage"]');

  it('says only "Prompts" under the title, and keeps Add prompt and "…" beside the tabs', async () => {
    await render(false);
    expect(container.querySelector('h1')?.textContent).toBe('Prompts');
    expect(container.textContent).not.toContain('Manage every tracked prompt');
    expect(button('Add prompt')).toBeDefined();
    expect(more()?.tagName).toBe('BUTTON');
    // Gone from the row: they are in "…" now, and so is the Tracked Prompts card.
    expect(button('Export CSV')).toBeUndefined();
    expect(container.querySelector('a[href="/dashboard/brands/b1/prompts"]')).toBeNull();
    expect(container.textContent).not.toContain('Every tracked prompt for this brand');
    expect(usagePanel()).toBeNull();
  });

  it('holds Export CSV, Plan & usage and Show usage in "…", and no Manage prompts', async () => {
    usageReads();
    await render(false);
    const items = await openMore();
    expect(items.map((el) => el.textContent)).toEqual(['Export CSV', 'Plan & usage', 'Show usage']);
    expect(document.querySelector('[data-action="manage-prompts"]')).toBeNull();
    expect(document.querySelector('a[href="/dashboard/brands/b1/prompts"]')).toBeNull();
    expect(item(items, 'Plan & usage').getAttribute('href')).toBe(
      '/dashboard/settings?tab=billing',
    );
  });

  it('downloads the prompts as a CSV from Export CSV', async () => {
    const urls = { create: vi.fn((blob: Blob) => (blob.type ? 'blob:prompts' : '')) };
    URL.createObjectURL = urls.create;
    URL.revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    await render(false);
    const items = await openMore();
    await act(async () => item(items, 'Export CSV').click());
    expect(urls.create).toHaveBeenCalledOnce();
    expect(urls.create.mock.calls[0][0].type).toBe('text/csv;charset=utf-8;');
    expect(downloads).toEqual([
      expect.stringMatching(/^Ansvisor_acme_prompts_\d{4}-\d{2}-\d{2}\.csv$/),
    ]);
    click.mockRestore();
  });

  it('says Export CSV has nothing to export while the brand has no prompts', async () => {
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [] }],
      visibility: {},
      positions: {},
    });
    await render(false);
    const exportItem = item(await openMore(), 'Export CSV');
    expect(exportItem.textContent).toBe('Export CSVNo prompts yet: add prompts first.');
    expect(exportItem.hasAttribute('data-disabled')).toBe(true);
  });

  it('opens the usage cards from Show usage, and folds them from Hide usage or their Hide', async () => {
    usageReads();
    await render(false);
    await act(async () => item(await openMore(), 'Show usage').click());
    expect(usagePanel()?.textContent).toContain('This brand');
    // The cards still filter the table.
    await act(async () => button('Total prompts')!.click());
    expect(container.textContent).toContain('All prompts (1)');

    await act(async () => item(await openMore(), 'Hide usage').click());
    expect(usagePanel()).toBeNull();

    await act(async () => item(await openMore(), 'Show usage').click());
    await act(async () => button('Hide')!.click());
    expect(usagePanel()).toBeNull();
  });

  it('says beside Show usage when the prompt locations are nearly used', async () => {
    usageReads(46);
    await render(false);
    expect(item(await openMore(), 'Show usage').textContent).toBe(
      'Show usage46 / 50 prompt locations',
    );
  });

  it('gives a member "…" too, without Add prompt', async () => {
    role.canManage = false;
    await render(false);
    expect(button('Add prompt')).toBeUndefined();
    // Plan & usage waits for the counts, which this test's read refuses.
    expect((await openMore()).map((el) => el.textContent)).toEqual(['Export CSV', 'Show usage']);
  });

  it('has no "…" on Query Fan-out and Insights, now Manage prompts is gone, and Topics its own buttons', async () => {
    nav.pathname = '/dashboard/prompts/fan-outs';
    await render(false);
    expect(button('Add prompt')).toBeUndefined();
    expect(more()).toBeNull();
    expect(document.querySelector('a[href="/dashboard/brands/b1/prompts"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    nav.pathname = '/dashboard/prompts/insights';
    await render(false);
    expect(more()).toBeNull();
    expect(document.querySelector('a[href="/dashboard/brands/b1/prompts"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    nav.pathname = '/dashboard/prompts/topics';
    await render(false);
    expect(more()).toBeNull();
  });
});

describe('the Tracked | Suggestions switch', () => {
  const links = () => [
    ...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Prompt list"] a'),
  ];
  const current = () => links().find((a) => a.getAttribute('aria-current') === 'page');
  afterEach(() => window.history.replaceState(null, '', '/dashboard/prompts/tracked'));

  it('links each view to its route, Tracked with its count, beside the date range', async () => {
    await render(false);
    expect(links().map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Tracked1', '/dashboard/prompts/tracked'],
      ['Suggestions', '/dashboard/prompts/suggestions'],
    ]);
    expect(current()?.textContent).toBe('Tracked1');
    // The date range in the same row, without its label.
    const row = links()[0].closest('nav')!.parentElement!;
    expect(row.querySelector('[role="group"][aria-label="Date Range"]')).not.toBeNull();
    expect([...container.querySelectorAll('label')].map((l) => l.textContent)).not.toContain(
      'Date Range',
    );
  });

  it('moves to Suggestions and back in place, on their routes', async () => {
    await render(false);
    await act(async () => links()[1].click());
    expect(window.location.pathname).toBe('/dashboard/prompts/suggestions');
    expect(current()?.textContent).toBe('Suggestions');
    expect(container.querySelector('[data-testid="suggestions-tab"]')).not.toBeNull();
    expect(container.querySelector('[data-tour="positions"]')).toBeNull();

    await act(async () => links()[0].click());
    expect(window.location.pathname).toBe('/dashboard/prompts/tracked');
    expect(current()?.textContent).toBe('Tracked1');
    expect(container.querySelector('[data-tour="positions"]')).not.toBeNull();
  });

  it('opens on Suggestions from its route', async () => {
    nav.pathname = '/dashboard/prompts/suggestions';
    await render(false);
    expect(current()?.textContent).toBe('Suggestions');
    expect(container.querySelector('[data-testid="suggestions-tab"]')).not.toBeNull();
  });

  it('is left off the other tabs, which keep the date range', async () => {
    nav.pathname = '/dashboard/prompts/topics';
    await render(false);
    expect(links()).toHaveLength(0);
    expect(container.querySelector('[role="group"][aria-label="Date Range"]')).not.toBeNull();
  });
});

describe('the prompts missing volume and competition', () => {
  const paused: Prompt = { ...prompt, id: 'p9', text: 'Paused one?', isActive: false };
  const second: Prompt = { ...prompt, id: 'p2', text: 'Best espresso beans?' };
  const analyzed = {
    id: 'v1',
    promptId: 'p1',
    promptText: prompt.text,
    promptCategory: 'Coffee',
    intent: 'commercial',
    keywords: ['coffee subscription'],
    googleVolumes: { 'coffee subscription': 1000 },
    totalGoogleVolume: 1000,
    aiVolumeMultiplier: 0.4,
    estAiVolume: 400,
    competitionIndex: null,
    competition: null,
    fetchedAt: '2026-10-20T00:00:00.000Z',
  };
  const withPrompts = (list: Prompt[], extra: object = {}) =>
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: list }],
      visibility: {},
      positions: {},
      ...extra,
    });

  it('says how many in one quiet line in the table card, under the filters, with Analyze', async () => {
    withPrompts([prompt, paused]);
    await render(false);
    const line = notAnalyzed()!;
    expect(line.textContent).toBe('Volume and competition missing for 1 prompt·Analyze');
    expect(line.closest('[data-tour="positions"]')).not.toBeNull();
    const filters = container.querySelector('[data-filter-row]')!;
    expect(filters.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The count line on its left.
    expect(line.closest('[data-notices]')?.parentElement?.textContent).toContain(
      'Tracked prompts (1)',
    );
    expect(analyzeButton()?.getAttribute('aria-label')).toBe('Analyze volume and competition');
    // Not the tracking: the prompts are analyzed, only their volume is missing.
    expect(line.textContent).not.toContain('not analyzed');
    // No banner any more.
    expect(container.textContent).not.toContain("haven't been analyzed");
  });

  it('counts in the plural', async () => {
    withPrompts([prompt, second]);
    await render(false);
    expect(notAnalyzed()?.textContent).toBe('Volume and competition missing for 2 prompts·Analyze');
    expect(analyzeButton()?.getAttribute('aria-label')).toBe('Analyze volume and competition');
  });

  it('is hidden once every active prompt has a volume', async () => {
    withPrompts([prompt, paused], { volumes: [analyzed] });
    await render(false);
    expect(notAnalyzed()).toBeNull();
  });

  it('runs the volume analysis from Analyze, as the banner did', async () => {
    volumes.startPromptVolumeAnalysis.mockResolvedValue({ ok: true, started: 0, running: false });
    await render(false);
    await act(async () => analyzeButton()!.click());
    expect(volumes.startPromptVolumeAnalysis).toHaveBeenCalledExactlyOnceWith('b1', false);
    expect(toast.success).toHaveBeenCalledWith('Every active prompt already has volume data.');
  });

  it('says it is analyzing while the run starts', async () => {
    volumes.startPromptVolumeAnalysis.mockReturnValue(new Promise(() => {}));
    await render(false);
    await act(async () => analyzeButton()!.click());
    expect(notAnalyzed()?.textContent).toBe(
      'Volume and competition missing for 1 prompt·Analyzing…',
    );
    expect(analyzeButton()).toBeNull();
  });

  it('offers no Analyze to a member, or once the month’s analyses are used up', async () => {
    role.canManage = false;
    await render(false);
    expect(notAnalyzed()?.textContent).toBe('Volume and competition missing for 1 prompt');

    act(() => root.unmount());
    root = createRoot(container);
    role.canManage = true;
    withPrompts([prompt], { quota: { used: 10, limit: 10, remaining: 0 } });
    await render(false);
    expect(notAnalyzed()?.textContent).toBe(
      'Volume and competition missing for 1 prompt·Monthly limit reached',
    );
    expect(notAnalyzed()?.getAttribute('title')).toContain('upgrade your plan');
    expect(analyzeButton()).toBeNull();
  });
});

describe('Location in the filter row', () => {
  afterEach(() => window.history.replaceState(null, '', '/dashboard/prompts/tracked'));

  it('sits beside the table filters, with no label, and reads the table for the picked one', async () => {
    filterOptions.regions = ['US', 'GB'];
    await render(false);
    const trigger = container.querySelector<HTMLElement>(
      '[data-filter-row] [aria-label="Location"]',
    )!;
    expect(trigger.textContent).toContain('All Locations');
    expect([...container.querySelectorAll('label')].map((l) => l.textContent)).not.toContain(
      'Location',
    );
    await act(async () => trigger.click());
    const gb = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) =>
      el.textContent?.includes('United Kingdom'),
    )!;
    await act(async () => {
      gb.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await act(async () => gb.click());
    await act(async () => {});
    expect(actions.getPromptsPageData).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({ region: 'GB' }),
    );
    expect(new URLSearchParams(window.location.search).get('region')).toBe('GB');
  });
});

describe('the prompt locations near the limit, in the status line', () => {
  // The usage cards' read (GET /api/prompts/usage): a Starter plan of 50 prompt locations.
  const usageReads = (locationsUsed: number, plan: object = {}) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          plan: {
            key: 'starter',
            name: 'Starter plan',
            locationLimit: 50,
            cta: 'upgrade_growth',
            ...plan,
          },
          brand: { active: 1, paused: 0, total: 1 },
          account: { activePrompts: 1, brands: 1, locationsUsed },
          updatedAt: '2026-11-17T09:00:00.000Z',
        }),
      })),
    );
  const line = () => container.querySelector<HTMLElement>('[data-locations-warning]');
  const notices = () => container.querySelector<HTMLElement>('[data-notices]');

  it('says nothing well under the limit, or with no limit', async () => {
    usageReads(10);
    await render(false);
    expect(line()).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    usageReads(400, {
      key: 'self_hosted',
      name: 'Self-Hosted plan',
      locationLimit: null,
      cta: null,
    });
    await render(false);
    expect(line()).toBeNull();
  });

  it('says it in amber from 90% of the limit, with Plan & usage, beside the not-analyzed line', async () => {
    usageReads(46);
    await render(false);
    expect(line()?.getAttribute('data-locations-warning')).toBe('warning');
    expect(line()?.className).toContain('text-amber-700');
    expect(line()?.textContent).toBe('46 / 50 prompt locations used·Plan & usage');
    const plan = line()!.querySelector('a')!;
    expect(plan.textContent).toBe('Plan & usage');
    expect(plan.getAttribute('href')).toBe('/dashboard/settings?tab=billing');
    // Both quiet lines, in the status line at the right of the count; the menu still says it.
    expect(notices()?.contains(notAnalyzed())).toBe(true);
    expect(notices()?.contains(line())).toBe(true);
    expect(line()!.closest('[data-tour="positions"]')).not.toBeNull();
  });

  it('says it in red at or past the limit, and keeps it with the cards open', async () => {
    usageReads(52);
    await render(false);
    expect(line()?.getAttribute('data-locations-warning')).toBe('full');
    expect(line()?.className).toContain('text-red-600');
    expect(line()?.textContent).toBe('52 / 50 prompt locations used·Plan & usage');

    const trigger = container.querySelector<HTMLElement>('[aria-label="More actions"]')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    const show = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
      el.textContent?.startsWith('Show usage'),
    )!;
    expect(show.textContent).toBe('Show usage52 / 50 prompt locations');
    await act(async () => show.click());
    expect(container.querySelector('section[aria-label="Prompt usage"]')).not.toBeNull();
    expect(line()).not.toBeNull();
  });
});

/**
 * Track now (moved from the brand's Manage prompts page, where it was
 * Analyze Prompts): the active prompts with no answers yet, read as that page
 * read them, in the table's status line and the bulk bar, for admins and
 * managers; the same call starts tracking them, saved as the brand's
 * tracking job, without leaving the page.
 */
describe('Track now', () => {
  const answered: Prompt = { ...prompt, id: 'p2', text: 'Best espresso machine?' };
  const fresh: Prompt = { ...prompt, id: 'p3', text: 'Best decaf beans?' };
  const answers = {
    avgVisibility: 40,
    avgVisibilityVisible: 40,
    totalMentions: 2,
    totalCitations: 1,
    runs: 4,
    visibleRuns: 2,
    visibilityRate: 50,
    score: 40,
    mentionAnswers: 2,
    citationAnswers: 1,
    positionFactor: 0.5,
    lastRunAt: '2026-11-16T09:00:00.000Z',
  };
  // The table's read: p1 and p3 have no answers yet; p9 is no prompt on the page.
  const withPrompts = (
    visibility: Record<string, typeof answers> = { p2: answers },
    withoutAnswers: string[] | null = ['p1', 'p3', 'p9'],
  ) =>
    actions.getPromptsPageData.mockImplementation(
      async (_brandId: string, opts?: { withoutAnswers?: boolean }) => ({
        volumes: [],
        quota: null,
        promptSets: [{ prompts: [prompt, answered, fresh] }],
        visibility,
        positions: {},
        ...(opts?.withoutAnswers ? { withoutAnswers } : {}),
      }),
    );
  const line = (state: 'waiting' | 'started') =>
    container.querySelector<HTMLElement>(`[data-track-now="${state}"]`);
  const trackNowButton = () => line('waiting')?.querySelector('button') ?? null;
  const bulkButton = (text: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find(
      (b) => b.textContent === text,
    );
  const select = async (p: Prompt) => {
    const box = container.querySelector<HTMLElement>(`[aria-label="Select ${p.text}"]`)!;
    await act(async () => box.click());
  };

  beforeEach(() => {
    withPrompts();
    trackNowApi.trackPromptsNow.mockResolvedValue({ ok: true, jobId: 'job-1', count: 2 });
  });

  it('says how many prompts have no answers yet, in the status line', async () => {
    await render(false);
    // Asked of the table's own read, not read on their own once the rows are in.
    expect(actions.getPromptsPageData).toHaveBeenCalledOnce();
    expect(actions.getPromptsPageData.mock.calls[0][1]).toMatchObject({ withoutAnswers: true });
    expect(line('waiting')?.textContent).toBe('2 prompts have no answers yet·Track now');
    expect(container.querySelector('[data-notices]')?.contains(line('waiting'))).toBe(true);
    expect(trackNowButton()?.getAttribute('aria-label')).toBe('Track 2 prompts now');
    // Not Analyze: that is the volume analysis.
    expect(line('waiting')?.textContent).not.toContain('Analyze');
  });

  it('tracks them now with the brand page’s call, saves the job, and says so in place', async () => {
    await render(false);
    await act(async () => trackNowButton()!.click());
    expect(trackNowApi.trackPromptsNow).toHaveBeenCalledExactlyOnceWith('b1', ['p1', 'p3']);
    expect(jobStore.saveTrackingJob).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-1',
      brandId: 'b1',
      startedAt: expect.any(Number),
    });
    expect(toast.success).toHaveBeenCalledWith('Tracking 2 prompts now', {
      description: 'Answers arrive over the next minutes. Visibility shows the run as it goes.',
    });
    // The page stays; the line says the run started, with the way to its answers.
    expect(nav.push).not.toHaveBeenCalled();
    expect(line('waiting')).toBeNull();
    expect(line('started')?.textContent).toBe('Tracking 2 prompts now·See answers');
    expect(line('started')?.querySelector('a')?.getAttribute('href')).toBe('/dashboard/insights');
  });

  it('says nothing when every active prompt has answers, or when they couldn’t be read', async () => {
    withPrompts({ p1: answers, p2: answers, p3: answers }, []);
    await render(false);
    expect(line('waiting')).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    withPrompts({ p2: answers }, null);
    await render(false);
    expect(container.textContent).toContain(fresh.text);
    expect(line('waiting')).toBeNull();
  });

  it('leaves it out for members, who can’t track: not asked for, no line, no button', async () => {
    role.canManage = false;
    await render(false);
    expect(actions.getPromptsPageData.mock.calls[0][1]).toMatchObject({ withoutAnswers: false });
    expect(line('waiting')).toBeNull();
  });

  it('opens the upgrade dialog on a read-only workspace, starting nothing', async () => {
    await render(true);
    await act(async () => trackNowButton()!.click());
    expect(openUpgrade).toHaveBeenCalledWith('Tracking prompts needs a plan');
    expect(trackNowApi.trackPromptsNow).not.toHaveBeenCalled();
  });

  it('offers Track now in the bulk bar for the selected prompts with no answers only', async () => {
    await render(false);
    await select(answered);
    expect(bulkButton('Track now')).toBeUndefined();
    await select(fresh);
    expect(bulkButton('Track 1 now')).toBeDefined();
    await act(async () => bulkButton('Track 1 now')!.click());
    expect(trackNowApi.trackPromptsNow).toHaveBeenCalledExactlyOnceWith('b1', ['p3']);

    await act(async () => root.unmount());
    root = createRoot(container);
    trackNowApi.trackPromptsNow.mockClear();
    await render(true);
    await select(fresh);
    await act(async () => bulkButton('Track now')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Tracking prompts needs a plan');
    expect(trackNowApi.trackPromptsNow).not.toHaveBeenCalled();
  });

  it('says why a run was refused, and keeps the line', async () => {
    trackNowApi.trackPromptsNow.mockResolvedValue({
      ok: false,
      status: 429,
      message: 'Please wait 5 minutes before running another analysis.',
      code: null,
    });
    await render(false);
    await act(async () => trackNowButton()!.click());
    expect(toast.error).toHaveBeenCalledWith("Couldn't start tracking", {
      description: 'Please wait 5 minutes before running another analysis.',
    });
    expect(jobStore.saveTrackingJob).not.toHaveBeenCalled();
    expect(line('waiting')).not.toBeNull();
  });

  it('opens the upgrade dialog when the API says the plan isn’t active', async () => {
    trackNowApi.trackPromptsNow.mockResolvedValue({
      ok: false,
      status: 402,
      message: null,
      code: 'subscription_inactive',
    });
    await render(false);
    await act(async () => trackNowButton()!.click());
    expect(openUpgrade).toHaveBeenCalled();
    expect(jobStore.saveTrackingJob).not.toHaveBeenCalled();
  });

  it('says so when they have answers by now, and drops the line', async () => {
    trackNowApi.trackPromptsNow.mockResolvedValue({ ok: true, jobId: null, count: 0 });
    await render(false);
    await act(async () => trackNowButton()!.click());
    expect(toast.info).toHaveBeenCalledWith('These prompts have answers already.');
    expect(jobStore.saveTrackingJob).not.toHaveBeenCalled();
    expect(line('waiting')).toBeNull();
    expect(line('started')).toBeNull();
  });
});

describe('Tracked Prompts with no prompts yet', () => {
  beforeEach(() => {
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [] }],
      visibility: {},
      positions: {},
    });
  });

  it('offers Add prompt, and no Manage prompts', async () => {
    await render(false);
    expect(container.textContent).toContain('No prompts yet');
    const adds = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === 'Add prompt',
    );
    // The header's and the empty state's.
    expect(adds).toHaveLength(2);
    expect(container.textContent).not.toContain('Manage prompts');
    expect(container.querySelector('a[href="/dashboard/brands/b1/prompts"]')).toBeNull();
  });

  it('tells a member whom to ask, with nothing to click', async () => {
    role.canManage = false;
    await render(false);
    expect(container.textContent).toContain('No prompts yet');
    expect(container.textContent).toContain('Ask an admin or a manager to add prompts.');
    expect(container.textContent).not.toContain('Manage prompts');
    expect(button('Add prompt')).toBeUndefined();
  });
});

/** A promise the test settles when it wants. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const volumeOf = (p: Prompt, estAiVolume: number, competitionIndex: number | null = 42) => ({
  id: `v-${p.id}`,
  promptId: p.id,
  promptText: p.text,
  promptCategory: 'Coffee',
  intent: 'commercial',
  keywords: ['coffee subscription'],
  googleVolumes: { 'coffee subscription': estAiVolume * 2.5 },
  totalGoogleVolume: estAiVolume * 2.5,
  aiVolumeMultiplier: 0.4,
  estAiVolume,
  competitionIndex,
  competition: competitionIndex === null ? null : 'MEDIUM',
  fetchedAt: '2026-10-20T00:00:00.000Z',
});

/** The table's row for a prompt, and its cell under a header. */
const rowOf = (p: Prompt) =>
  [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')].find((tr) =>
    tr.textContent?.includes(p.text),
  )!;
const cellOf = (p: Prompt, header: string) => {
  const heads = [...container.querySelectorAll<HTMLTableCellElement>('thead th')];
  const at = heads.findIndex((th) => th.textContent?.trim() === header);
  return rowOf(p).querySelectorAll('td')[at] as HTMLTableCellElement;
};

describe("Tracked Prompts' first view: one read before the table, none a row (load speed)", () => {
  const many: Prompt[] = Array.from({ length: 30 }, (_, i) => ({
    ...prompt,
    id: `p${i + 1}`,
    text: `Prompt number ${i + 1}?`,
  }));

  // Every server action the page could send, from the mocked action modules.
  // getPromptsPageData itself runs behind /api/prompts/read (readPromptsPageData).
  const serverActions = () => [
    ...Object.values(actions).filter((fn) => fn !== actions.getPromptsPageData),
    ...Object.values(volumes),
    ...Object.values(topicActions),
    ...Object.values(improving),
    ...Object.values(swap),
    getOpenSuggestionForPrompt,
  ];
  const actionCalls = () => serverActions().reduce((n, fn) => n + fn.mock.calls.length, 0);

  it('sends no server action before the table: its read is one fetch, which also brings its columns', async () => {
    const rows = deferred<unknown>();
    pageReads.readPromptsPageData.mockReturnValue(rows.promise);
    await render(false);

    // The table waits for its one read, which nothing queued holds up.
    expect(pageReads.readPromptsPageData).toHaveBeenCalledOnce();
    expect(pageReads.readPromptsPageData).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ first: true, withoutAnswers: true, volumes: false }),
    );
    expect(actionCalls()).toBe(0);
    expect(container.querySelector('tbody tr')).toBeNull();

    await act(async () =>
      rows.resolve({
        promptSets: [{ prompts: many }],
        visibility: {},
        positions: {},
        improving: {},
        withoutAnswers: [],
        tableViews: { mine: { order: ['topic', 'volume'], hidden: [] }, brand: null },
      }),
    );
    await act(async () => {});
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    // Its own columns from the first frame: no read of them of its own.
    expect(container.querySelector('thead')?.textContent).toMatch(/^PromptTopicVolume/);
    expect(container.querySelector('thead')?.textContent).not.toContain('Visibility');
    // Still no server action for what the rows show (Improve links, Track now, volumes' status).
    expect(improving.getImprovingPrompts).not.toHaveBeenCalled();
    expect(volumes.getVolumeAnalysisStatus).not.toHaveBeenCalled();
  });

  it('reads once for 30 rows: no read a row, nor a page of rows', async () => {
    actions.getPromptsPageData.mockResolvedValue({
      volumes: many.map((p, i) => volumeOf(p, 100 + i)),
      quota: null,
      promptSets: [{ prompts: many }],
      visibility: {},
      positions: {},
      improving: {},
      withoutAnswers: [],
    });
    await render(false);
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(10);

    expect(pageReads.readPromptsPageData).toHaveBeenCalledOnce();
    expect(pageReads.readPromptVolumes).toHaveBeenCalledOnce();
    expect(visibilityReads.getBrandFilterOptions).toHaveBeenCalledOnce();
    // The only server action of the first view, once the rows are in: the
    // content quota the row menu and the bulk bar use.
    expect(getOpenSuggestionForPrompt).not.toHaveBeenCalled();
    expect(improving.getImprovingPrompts).not.toHaveBeenCalled();
    expect(volumes.getVolumeAnalysisStatus).not.toHaveBeenCalled();
    expect(topicActions.getTopics).not.toHaveBeenCalled();
    expect(actionCalls()).toBe(0);
  });

  it('keeps the Location filter in its place until the brand’s locations are read', async () => {
    const twoPlaces = { ...prompt, regions: ['US', 'GB'] };
    actions.getPromptsPageData.mockResolvedValue({
      volumes: [],
      quota: null,
      promptSets: [{ prompts: [twoPlaces] }],
      visibility: {},
      positions: {},
    });
    const regions = deferred<{ regions: string[] }>();
    visibilityReads.getBrandFilterOptions.mockReturnValueOnce(regions.promise);
    await render(false);
    const row = container.querySelector('[data-filter-row]')!;
    expect(row.querySelector('[data-location-filter-pending]')).not.toBeNull();

    await act(async () => regions.resolve({ regions: ['GB', 'US'] }));
    expect(row.querySelector('[data-location-filter-pending]')).toBeNull();
    expect(row.querySelector('[aria-label="Location"]')).not.toBeNull();
  });
});

describe('Volume and Competition on the first view', () => {
  const second: Prompt = { ...prompt, id: 'p2', text: 'Best espresso beans?' };
  const third: Prompt = { ...prompt, id: 'p3', text: 'Coffee grinder for beginners?' };
  const rowsRead = (list: Prompt[]) => ({
    promptSets: [{ prompts: list }],
    visibility: {},
    positions: {},
    improving: {},
  });
  const volumesRead = (list: ReturnType<typeof volumeOf>[]) => ({
    volumes: list,
    quota: { used: 1, limit: 10, remaining: 9 },
    status: null,
  });

  it('fills them, and counts the prompts without a volume, from the first render on', async () => {
    actions.getPromptsPageData.mockResolvedValue({
      ...rowsRead([prompt, second, third]),
      volumes: [volumeOf(prompt, 400, 42), volumeOf(second, 900, 77)],
      quota: { used: 2, limit: 10, remaining: 8 },
    });
    await render(false);

    for (const p of [prompt, second]) {
      expect(cellOf(p, 'Volume').textContent).not.toBe('—');
      expect(cellOf(p, 'Volume').textContent).toMatch(/\d/);
    }
    expect(
      cellOf(prompt, 'Competition').querySelector('[aria-label="Competition 42 of 100"]'),
    ).not.toBeNull();
    expect(
      cellOf(second, 'Competition').querySelector('[aria-label="Competition 77 of 100"]'),
    ).not.toBeNull();
    expect(cellOf(third, 'Volume').textContent).toBe('—');
    // One prompt without, not all three: no range change needed.
    expect(notAnalyzed()?.textContent).toMatch(/\b1 prompt\b/);
    expect(pageReads.readPromptVolumes).toHaveBeenCalledOnce();
  });

  it('says nothing about prompts without a volume while the volumes are on their way', async () => {
    actions.getPromptsPageData.mockResolvedValue(rowsRead([prompt, second, third]));
    const read = deferred<ReturnType<typeof volumesRead>>();
    pageReads.readPromptVolumes.mockReturnValueOnce(read.promise);
    await render(false);

    // The rows are in; their Volume and Competition wait in place.
    expect(rowOf(third)).toBeDefined();
    expect(notAnalyzed()).toBeNull();
    expect(cellOf(prompt, 'Volume').querySelector('[data-volume-pending]')).not.toBeNull();
    expect(cellOf(prompt, 'Competition').querySelector('[data-volume-pending]')).not.toBeNull();

    await act(async () =>
      read.resolve(volumesRead([volumeOf(prompt, 400), volumeOf(second, 900)])),
    );
    expect(container.querySelector('[data-volume-pending]')).toBeNull();
    expect(notAnalyzed()?.textContent).toMatch(/\b1 prompt\b/);
  });

  it('tries a failed volumes read again before saying anything, and shows what it brings', async () => {
    actions.getPromptsPageData.mockResolvedValue(rowsRead([prompt, second]));
    pageReads.readPromptVolumes
      .mockRejectedValueOnce(new Error('Server error: 429'))
      .mockResolvedValueOnce(volumesRead([volumeOf(prompt, 400), volumeOf(second, 900)]));
    await render(false);
    expect(pageReads.readPromptVolumes).toHaveBeenCalledTimes(2);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(notAnalyzed()).toBeNull();
    expect(cellOf(second, 'Volume').textContent).toMatch(/\d/);
  });

  it('says the volumes are unavailable when the second try fails too, never "not analyzed"', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    actions.getPromptsPageData.mockResolvedValue(rowsRead([prompt, second]));
    pageReads.readPromptVolumes.mockRejectedValue(new Error('timeout'));
    await render(false);
    expect(toast.warning).toHaveBeenCalledWith(
      'Volume data is temporarily unavailable — showing prompts without it.',
    );
    expect(notAnalyzed()).toBeNull();
    error.mockRestore();
  });

  it('keeps the newer read when an older one lands after it', async () => {
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    pageReads.readPromptsPageData
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    await render(false);

    // Another range before the first read is back: a second read, sent beside it.
    const range = container.querySelector('[role="group"][aria-label="Date Range"]')!;
    const sevenDays = [...range.querySelectorAll<HTMLButtonElement>('button')][1];
    await act(async () => sevenDays.click());
    expect(pageReads.readPromptsPageData).toHaveBeenCalledTimes(2);

    await act(async () => newer.resolve(rowsRead([second])));
    expect(rowOf(second)).toBeDefined();
    await act(async () => older.resolve(rowsRead([third])));
    await act(async () => {});
    expect(rowOf(second)).toBeDefined();
    expect(container.textContent).not.toContain(third.text);
    // The volumes have no date: the range change didn't read them again.
    expect(pageReads.readPromptVolumes).toHaveBeenCalledOnce();
  });

  it('keeps the newer volumes when an older volumes read lands after them', async () => {
    actions.getPromptsPageData.mockResolvedValue(rowsRead([prompt, second]));
    const older = deferred<ReturnType<typeof volumesRead>>();
    pageReads.readPromptVolumes
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(volumesRead([volumeOf(prompt, 400), volumeOf(second, 900)]));
    await render(false);
    expect(notAnalyzed()).toBeNull();

    // A change to the prompts (a bulk Pause) reads the table and its volumes again.
    const box = container.querySelector<HTMLElement>(`[aria-label="Select ${second.text}"]`)!;
    await act(async () => box.click());
    await act(async () => button('Pause')!.click());
    await act(async () => {});
    expect(pageReads.readPromptVolumes).toHaveBeenCalledTimes(2);
    expect(notAnalyzed()).toBeNull();
    expect(cellOf(prompt, 'Volume').textContent).toMatch(/\d/);

    // The first read, answered late with no volumes, changes nothing.
    await act(async () => older.resolve(volumesRead([])));
    expect(cellOf(prompt, 'Volume').textContent).toMatch(/\d/);
    expect(notAnalyzed()).toBeNull();
  });
});

describe('Insights while its volumes load', () => {
  beforeEach(() => {
    nav.pathname = '/dashboard/prompts/insights';
    // The Prompt Volumes chart sizes itself to its box.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  const rows = {
    promptSets: [{ prompts: [prompt] }],
    visibility: {},
    positions: {},
    improving: {},
  };

  it('shows the cards and chart once the volumes are in, on the first render', async () => {
    actions.getPromptsPageData.mockResolvedValue({
      ...rows,
      volumes: [volumeOf(prompt, 400)],
      quota: { used: 1, limit: 10, remaining: 9 },
    });
    await render(false);
    expect(container.textContent).toContain('Prompts Analyzed');
    expect(container.textContent).not.toContain('No volume data yet');
    expect(container.querySelector('[data-insights-loading]')).toBeNull();
  });

  it('shows a skeleton, never "No volume data yet", while the read is pending', async () => {
    actions.getPromptsPageData.mockResolvedValue(rows);
    pageReads.readPromptVolumes.mockReturnValueOnce(new Promise(() => {}));
    await render(false);
    expect(container.querySelector('[data-insights-loading]')).not.toBeNull();
    expect(container.textContent).not.toContain('No volume data yet');
  });

  it('says "No volume data yet" once a finished read brought none', async () => {
    actions.getPromptsPageData.mockResolvedValue({ ...rows, volumes: [] });
    await render(false);
    expect(container.querySelector('[data-insights-loading]')).toBeNull();
    expect(container.textContent).toContain('No volume data yet');
  });

  it('says the read failed, with Retry, rather than "No volume data yet"', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    actions.getPromptsPageData.mockResolvedValue(rows);
    pageReads.readPromptVolumes.mockRejectedValue(new Error('timeout'));
    await render(false);
    expect(container.querySelector('[data-volumes-failed]')).not.toBeNull();
    expect(container.textContent).not.toContain('No volume data yet');

    pageReads.readPromptVolumes.mockResolvedValue({
      volumes: [volumeOf(prompt, 400)],
      quota: null,
      status: null,
    });
    await act(async () => button('Retry')!.click());
    expect(container.textContent).toContain('Prompts Analyzed');
    error.mockRestore();
  });
});
