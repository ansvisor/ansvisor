import { act, isValidElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionItem } from '@/lib/actions/action-center';
import type { FocusCard } from '@/lib/actions/today-focus';
import type { TodayOverview } from '@/lib/actions/today';
import type { TodayStanding } from '@/lib/action-center/focus';
import { actionItemFromRow } from '@/lib/action-center/rows';
import type { Signal } from '@/lib/signals/map';
import { buildGettingStarted, type GettingStartedFacts } from '@/lib/getting-started/steps';
import { UpgradeDialogContext, type UpgradeDialogState } from '@/components/providers/upgrade-gate';
import messages from '../../../../../../../messages/en.json';

/**
 * Action Center › Today (SIMPLE_NAV): not found while the simplified layout
 * is off; with it on, the Action Center's header with the day, brand and
 * when answers came in, the loop strip, Today's focus, Where you stand, the
 * parts still being built, and Ask Chat. Each part reads on its own.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('@/components/action-center/action-center-tabs', () => ({
  ActionCenterTabs: () => <nav data-testid="tabs" />,
}));
vi.mock('@/components/action-center/agent-work-gear', () => ({
  AgentWorkGear: () => <button type="button" data-testid="gear" />,
}));
// The brand on screen; a test switches it and draws again.
let activeBrandId = 'b1';
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (
    selector: (state: { activeBrandId: string; brands: { id: string; name: string }[] }) => unknown,
  ) =>
    selector({
      activeBrandId,
      brands: [
        { id: 'b1', name: 'Brewline Coffee' },
        { id: 'b2', name: 'Other Roasters' },
      ],
    }),
}));
let firstRun: { progress: { current: number; total: number } | null } | null = null;
vi.mock('@/hooks/use-first-run', () => ({ useFirstRun: () => firstRun }));
let chatOn = true;
vi.mock('@/components/providers/chat-agentic-provider', () => ({
  useChatAgentic: () => chatOn,
}));
const panel = { available: true, open: false, fill: vi.fn(), toggle: vi.fn() };
vi.mock('@/components/chat/panel/chat-panel-context', () => ({ useChatPanel: () => panel }));
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track }));
const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('sonner', () => ({ toast }));

const reads = vi.hoisted(() => ({
  getTodayOverview: vi.fn(),
  getTodayStanding: vi.fn(),
  getTodayFocus: vi.fn(),
  skipTodayFocus: vi.fn(),
  readUserBrandState: vi.fn(),
  markSeen: vi.fn(async () => ({ ok: true })),
  getTodayChanges: vi.fn(),
  getTodayWaiting: vi.fn(),
  getGettingStarted: vi.fn(),
  skipGettingStarted: vi.fn(),
  startGettingStarted: vi.fn(),
  hideCard: vi.fn(),
  getTodayFirstDay: vi.fn(),
  markPromptsChecked: vi.fn(),
  setPromptActive: vi.fn(),
  addPromptToBrand: vi.fn(),
  acceptSuggestion: vi.fn(),
  getTodayLastWeek: vi.fn(),
  getTodayEnded: vi.fn(),
  getTodayTopic: vi.fn(),
  openTopicCard: vi.fn(),
  writeTopicPrompts: vi.fn(),
  trackTopicPrompts: vi.fn(),
}));
vi.mock('@/lib/actions/today-topic', () => ({
  getTodayTopic: reads.getTodayTopic,
  openTopicCard: reads.openTopicCard,
  writeTopicPrompts: reads.writeTopicPrompts,
  trackTopicPrompts: reads.trackTopicPrompts,
}));
vi.mock('@/lib/actions/today-week', () => ({
  getTodayLastWeek: reads.getTodayLastWeek,
  getTodayEnded: reads.getTodayEnded,
}));
vi.mock('@/lib/actions/today-first-day', () => ({
  getTodayFirstDay: reads.getTodayFirstDay,
  markPromptsChecked: reads.markPromptsChecked,
}));
vi.mock('@/lib/actions/prompt', () => ({
  setPromptActive: reads.setPromptActive,
  addPromptToBrand: reads.addPromptToBrand,
}));
vi.mock('@/lib/actions/prompt-suggestions', () => ({ acceptSuggestion: reads.acceptSuggestion }));
const tour = { available: true, show: vi.fn(async () => {}) };
vi.mock('@/components/chat/tour/chat-tour', () => ({ useChatTour: () => tour }));
vi.mock('@/lib/actions/getting-started', () => ({
  getGettingStarted: reads.getGettingStarted,
  skipGettingStarted: reads.skipGettingStarted,
  startGettingStarted: reads.startGettingStarted,
}));
let canManage = true;
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => ({ canManage }) }));
vi.mock('@/lib/actions/today-waiting', () => ({ getTodayWaiting: reads.getTodayWaiting }));
vi.mock('@/lib/actions/today-changes', () => ({ getTodayChanges: reads.getTodayChanges }));
let hidden = new Set<string>();
vi.mock('@/components/providers/menu-access-provider', () => ({
  useHiddenMenuSections: () => hidden,
}));
vi.mock('@/lib/actions/today', () => ({
  getTodayOverview: reads.getTodayOverview,
  getTodayStanding: reads.getTodayStanding,
}));
vi.mock('@/lib/actions/today-focus', () => ({
  getTodayFocus: reads.getTodayFocus,
  skipTodayFocus: reads.skipTodayFocus,
}));
vi.mock('@/lib/actions/user-brand-state', () => ({
  readUserBrandState: reads.readUserBrandState,
  markSeen: reads.markSeen,
  hideCard: reads.hideCard,
}));

const { default: ActionCenterTodayPage } = await import('./page');
const { TodayPage } = await import('@/components/action-center/today-page');

function action(id: string, overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id,
    actionNo: 1,
    category: 'recover',
    kind: 'recover_lost_citations',
    impact: 'high',
    status: 'new',
    payload: {},
    kpiKeys: [],
    assignee: null,
    dueDate: null,
    createdAt: '2026-11-10T09:05:31Z',
    updatedAt: '2026-11-10T09:05:31Z',
    taskTotal: 4,
    taskCompleted: 0,
    signalCount: 1,
    priorityScore: 80,
    priorityLevel: 'high',
    priorityReason: null,
    ...overrides,
  };
}

const card = (id: string, overrides: Partial<FocusCard> = {}): FocusCard => ({
  id,
  action: action(id),
  isNew: false,
  firstStep: null,
  effort: null,
  who: 'team',
  ...overrides,
});

const overview: TodayOverview = {
  zone: 'UTC',
  lastRunAt: new Date(Date.now() - 3600_000).toISOString(),
  trackedPrompts: 12,
  openActions: 3,
  doneThisWeek: 1,
};
const standing: TodayStanding = {
  score: 53.9,
  change: 0.4,
  rank: 2,
  of: 5,
  neighbour: { name: 'Northbound Roasters', gap: 6.2, ahead: false },
  competitors: [],
};

function signal(id: string, overrides: Partial<Signal> = {}): Signal {
  return {
    id,
    category: 'visibility',
    kind: 'prompt_gain',
    impact: 'high',
    status: 'new',
    source: ['ai_results'],
    detectedAt: '2026-11-11T04:00:00Z',
    lastDetectedAt: '2026-11-11T04:00:00Z',
    resolvedAt: null,
    previousValue: null,
    currentValue: null,
    changeValue: 12,
    payload: { promptText: 'best whole bean coffee for espresso' },
    kpiKeys: [],
    actionId: null,
    where: { platforms: [], locations: [] } as unknown as Signal['where'],
    ...overrides,
  };
}

const changes = {
  since: new Date(Date.now() - 6 * 3600_000).toISOString(),
  items: [
    signal('s1'),
    signal('s2', {
      category: 'citation',
      kind: 'first_citation',
      changeValue: null,
      actionId: 'a9',
      payload: { url: 'beanbulletin.example', promptText: 'low-acid coffee' },
    }),
    signal('s3', {
      category: 'competitor',
      kind: 'competitor_surge',
      impact: 'medium',
      previousValue: 20,
      currentValue: 24.1,
      payload: { competitorName: 'Morning Ritual Co.' },
    }),
  ],
  total: 3,
  small: 2,
};

const waiting = {
  canManage: true,
  today: '2026-11-11',
  drafts: [
    { id: 'd1', title: 'Low-acid guide' },
    { id: 'd2', title: 'Espresso page' },
  ],
  actions: [
    {
      id: 'a7',
      action: action('a7'),
      firstStep: { taskKey: 'validate', title: null, titleParams: {}, url: null },
      dueDate: '2026-11-11',
    },
  ],
  reviews: 2,
  ideas: { count: 2, sources: ['gsc'] },
};
let chats: Record<string, unknown>[] = [];

const setUp = (over: Partial<GettingStartedFacts> = {}) =>
  buildGettingStarted({
    startedAt: '2026-10-20T10:00:00Z',
    dismissedAt: null,
    confirmedAt: '2026-10-20T10:00:00Z',
    records: {},
    recordedAt: {},
    kpiSetupAt: '2026-10-01T00:00:00Z',
    competitors: 4,
    topicPrompts: [3, 3, 3],
    gsc: false,
    ga: false,
    firstAnswer: true,
    firstVisit: false,
    dataSuggestions: 0,
    dataTracked: 0,
    contentSuggestions: 0,
    contentPicked: 0,
    contentCreated: 0,
    contentRecent: 0,
    audits: 0,
    draftsCreated: 0,
    draftsOptimized: 0,
    ...over,
  });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  reads.getTodayOverview.mockResolvedValue(overview);
  reads.getTodayStanding.mockResolvedValue(standing);
  reads.getTodayFocus.mockResolvedValue([
    card('a1', {
      effort: '~20 min',
      firstStep: { taskKey: 'validate', title: null, titleParams: {}, url: null },
    }),
    card('a2', { isNew: true, action: action('a2', { priorityLevel: 'medium' }) }),
    card('a3', { action: action('a3', { taskCompleted: 2 }) }),
  ]);
  reads.skipTodayFocus.mockResolvedValue({ ok: true });
  reads.getTodayChanges.mockResolvedValue(changes);
  reads.getTodayWaiting.mockResolvedValue(waiting);
  reads.getGettingStarted.mockResolvedValue(setUp({ records: { ga: 'skipped' } }));
  reads.skipGettingStarted.mockResolvedValue(undefined);
  reads.startGettingStarted.mockResolvedValue(undefined);
  reads.hideCard.mockResolvedValue({ ok: true });
  reads.getTodayTopic.mockResolvedValue(null);
  chats = [
    {
      id: 'c1',
      mine: true,
      state: 'needsYou',
      title: 'Comparison page',
      lastMessageAt: '2026-11-11T07:00:00Z',
    },
    {
      id: 'c2',
      mine: false,
      state: 'needsYou',
      title: 'Theirs',
      lastMessageAt: '2026-11-11T08:00:00Z',
    },
    {
      id: 'c3',
      mine: true,
      state: 'running',
      title: 'Running',
      lastMessageAt: '2026-11-11T08:00:00Z',
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, chats }) })),
  );
  reads.readUserBrandState.mockResolvedValue({
    navSeen: { today: '2026-11-10T08:00:00.000Z' },
    focus: [],
    hidden: {},
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  chatOn = true;
  firstRun = null;
  activeBrandId = 'b1';
  panel.available = true;
  hidden = new Set();
  canManage = true;
  upgrade = null;
  vi.useRealTimers();
});

let upgrade: UpgradeDialogState | null = null;
async function draw() {
  const page = ActionCenterTodayPage();
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider value={upgrade}>{page}</UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const text = (selector: string) => container.querySelector(selector)?.textContent;
const titles = () => [...container.querySelectorAll('section h2')].map((h) => h.textContent);
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);

describe('Action Center › Today', () => {
  it('shows Today', () => {
    const page = ActionCenterTodayPage();
    expect(isValidElement(page) && page.type).toBe(TodayPage);
  });

  it('heads the page with the day, the brand and when AI answers came in, then the loop', async () => {
    await draw();
    expect(text('h1')).toBe('Action Center');
    expect(text('header p')).toMatch(
      /^\w+day, \w{3} \d{1,2} · Brewline Coffee · AI answers updated 1 hour ago$/,
    );
    expect(container.querySelector('[data-testid="tabs"]')).not.toBeNull();
    const cells = [...container.querySelectorAll('ol[aria-label="Your loop"] li')].map(
      (li) => li.textContent,
    );
    expect(cells).toEqual([
      '1 · Prompts12 tracked',
      '2 · AI answersUpdated today',
      '3 · Actions3 open',
      '4 · Done1 this week',
      '5 · Results53.9 +0.4',
    ]);
    expect(container.querySelector('[aria-current="step"]')?.getAttribute('data-loop-step')).toBe(
      'actions',
    );
    expect(reads.getTodayOverview).toHaveBeenCalledWith('b1', expect.any(String));
  });

  it("shows a first run's answers coming in", async () => {
    firstRun = { progress: { current: 7, total: 44 } };
    await draw();
    expect(text('[data-loop-step="answers"]')).toBe('2 · AI answers7 of 44 in');
  });

  it('lays out the parts as the mockup does, each named by its title', async () => {
    await draw();
    expect(titles()).toEqual([
      'Since yesterday',
      "Today's focus",
      'Waiting for you',
      'Finish setting up',
      'Where you stand',
    ]);
    for (const section of container.querySelectorAll('section')) {
      const id = section.getAttribute('aria-labelledby');
      expect(id && container.querySelector(`[id="${id}"]`)).toBeTruthy();
    }
    const link = (label: string) =>
      [...container.querySelectorAll('a')].find((a) => a.textContent === label);
    expect(link('All signals')?.getAttribute('href')).toBe('/dashboard/action-center/signals');
    expect(link('All actions')?.getAttribute('href')).toBe('/dashboard/action-center/actions');
  });

  it("lists the focus with why, impact, effort and steps, and opens each action's drawer", async () => {
    await draw();
    const rows = [...container.querySelectorAll('[data-focus-id]')];
    expect(rows.map((row) => row.getAttribute('data-focus-id'))).toEqual(['a1', 'a2', 'a3']);
    expect(rows[0].textContent).toContain('Recover lost citations');
    expect(rows[0].textContent).toContain('Citations you held consistently are gone.');
    expect(rows[0].textContent).toContain('High impact · about ~20 min · 0 of 4 steps done');
    expect(rows[0].textContent).toContain('First step: Validate across AI platforms');
    expect(rows[1].textContent).toContain('New');
    expect(rows[1].textContent).toContain('Medium impact');
    expect(rows[0].querySelector('a')?.textContent).toBe('Start');
    expect(rows[2].querySelector('a')?.textContent).toBe('Continue');
    expect(rows[2].querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/action-center/actions?action=a3',
    );
    // The gear for who starts agent work sits on the focus with Chat on.
    expect(
      container.querySelector('[data-today-part="focus"] [data-testid="gear"]'),
    ).not.toBeNull();
  });

  /** A topic gap sent from Visibility (VIS-010), as the server stores its priority. */
  it('says why a topic gap sent from Visibility is in focus: its gap and rival', async () => {
    const gap = actionItemFromRow(
      {
        id: 'a1',
        action_no: 7,
        category: 'compete',
        kind: 'topic_competitor_gap',
        impact: 'high',
        status: 'new',
        payload: {
          source: 'topic_competitor_gap',
          topicName: 'Coffee subscriptions',
          competitorName: 'Northbound Roasters',
          gap: 23.4,
          targetEntity: 'prompts',
          targetCount: 12,
        },
        kpi_keys: ['ai_visibility', 'share_of_voice'],
        assignee_id: null,
        due_date: null,
        created_at: '2026-11-10T09:05:31Z',
        updated_at: '2026-11-10T09:05:31Z',
        priority_score: 77,
        priority_level: 'high',
        priority_reason: {
          version: 1,
          change: 'gap',
          subject: { entity: 'prompts', count: 12 },
          competitorGap: { points: 23.4, competitor: 'Northbound Roasters' },
          demand: 'medium',
          realDemand: null,
          searches: 380,
          commercial: true,
          heldBefore: false,
          days: null,
          kinds: 0,
          sources: 0,
          pastSuccess: null,
          factors: { severity: 0.53, confidence: 0.6 },
        },
        priority_updated_at: '2026-11-10T09:05:31Z',
      },
      { assignee: null, taskTotal: 9, taskCompleted: 0, signalCount: 0 },
    );
    reads.getTodayFocus.mockResolvedValue([card('a1', { action: gap })]);
    await draw();
    const row = container.querySelector('[data-focus-id="a1"]')?.textContent ?? '';
    expect(row).toContain('Close the 23.4-pt gap with Northbound Roasters in Coffee subscriptions');
    expect(row).toContain(
      'A 23.4-pt gap with Northbound Roasters on 12 prompts — commercial intent.',
    );
    expect(row).not.toContain('Its findings have resolved');
  });

  it('reads the focus with the last visit, then keeps this one and counts it viewed', async () => {
    await draw();
    expect(reads.getTodayFocus).toHaveBeenCalledWith('b1', '2026-11-10T08:00:00.000Z');
    expect(reads.markSeen).toHaveBeenCalledWith('b1', 'today');
    expect(reads.getTodayChanges).toHaveBeenCalledWith('b1', '2026-11-10T08:00:00.000Z', []);
    // setup_done comes along when Finish setting up has read by then.
    expect(track).toHaveBeenCalledWith(
      'today_viewed',
      expect.objectContaining({
        state: 'normal',
        since_count: 3,
        focus_count: 3,
        waiting_count: 5,
      }),
    );
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('skips a card for the person and reads the focus again', async () => {
    await draw();
    reads.getTodayFocus.mockResolvedValue([card('a2'), card('a3'), card('a4')]);
    await act(async () => {
      button('Skip for now')?.click();
    });
    expect(reads.skipTodayFocus).toHaveBeenCalledWith('b1', 'a1');
    expect(track).toHaveBeenCalledWith('today_focus_skipped', {
      action_kind: 'recover_lost_citations',
    });
    expect(
      [...container.querySelectorAll('[data-focus-id]')].map((r) =>
        r.getAttribute('data-focus-id'),
      ),
    ).toEqual(['a2', 'a3', 'a4']);
  });

  it("never shows the last brand's focus after a brand switch", async () => {
    reads.getTodayWaiting.mockResolvedValue({
      ...waiting,
      drafts: [],
      actions: [],
      reviews: null,
      ideas: null,
    });
    chats = [];
    // The new brand's focus is still reading when its Waiting for you has read.
    reads.getTodayFocus.mockImplementation((brandId: string) =>
      brandId === 'b1'
        ? Promise.resolve([
            card('a3', { action: action('a3', { status: 'in_progress', taskCompleted: 2 }) }),
          ])
        : new Promise<FocusCard[]>(() => {}),
    );
    await draw();
    const part = () => container.querySelector('[data-today-part="waiting"]');
    expect(part()?.textContent).toContain('has 2 of 4 steps done.');

    activeBrandId = 'b2';
    await draw();
    expect(reads.getTodayWaiting).toHaveBeenCalledWith('b2', expect.any(String));
    expect(part()?.textContent).toContain('Nothing is waiting for you.');
    expect(part()?.textContent).not.toContain('has 2 of 4 steps done.');
    expect(container.querySelector('a[href$="action=a3"]')).toBeNull();
  });

  it('says where the brand stands', async () => {
    await draw();
    const stand = container.querySelector('[data-today-part="stand"]');
    expect(stand?.textContent).toContain('53.9 +0.4 since yesterday');
    expect(stand?.textContent).toContain('#2 of 5 brands. 6.2 points behind Northbound Roasters.');
  });

  it('hides only the part whose read failed', async () => {
    reads.getTodayFocus.mockRejectedValue(new Error('down'));
    reads.getTodayStanding.mockRejectedValue(new Error('down'));
    await draw();
    expect(titles()).toEqual(['Since yesterday', 'Waiting for you', 'Finish setting up']);
    expect(text('[data-loop-step="results"]')).toBe('5 · Results—');
    expect(text('[data-loop-step="prompts"]')).toBe('1 · Prompts12 tracked');
  });

  it('says so when nothing is in focus', async () => {
    reads.getTodayFocus.mockResolvedValue([]);
    await draw();
    expect(text('[data-today-part="focus"]')).toContain('Nothing to focus on right now.');
  });

  it('hands a question to Chat’s side panel with Chat on, and has no box without it', async () => {
    await draw();
    const input = container.querySelector<HTMLInputElement>('#today-ask')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(input, 'why did my score change?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.form?.requestSubmit();
    });
    expect(panel.fill).toHaveBeenCalledWith('why did my score change?');
    expect(panel.toggle).toHaveBeenCalled();

    act(() => root.unmount());
    root = createRoot(container);
    chatOn = false;
    await draw();
    expect(container.querySelector('#today-ask')).toBeNull();
    expect(container.querySelector('[data-testid="gear"]')).toBeNull();
  });

  it('lists what waits for the person, each row with its link, and counts them in the header', async () => {
    await draw();
    const rows = [...container.querySelectorAll('[data-waiting]')];
    expect(rows.map((row) => row.getAttribute('data-waiting'))).toEqual([
      'agent',
      'drafts',
      'due',
      'review',
      'ideas',
    ]);
    const link = (type: string) => container.querySelector(`[data-waiting="${type}"] a`);
    expect(rows[0].textContent).toContain('An agent is waiting for your OK on “Comparison page”.');
    expect(link('agent')?.getAttribute('href')).toBe('/dashboard/chat/c1');
    expect(link('drafts')?.textContent).toBe('Review 2 drafts');
    expect(link('drafts')?.getAttribute('href')).toBe('/dashboard/content/library');
    expect(rows[2].textContent).toContain('Due today: Validate across AI platforms.');
    expect(link('due')?.getAttribute('href')).toBe('/dashboard/action-center/actions?action=a7');
    expect(link('review')?.getAttribute('href')).toBe('/dashboard/action-center/review');
    expect(link('review')?.getAttribute('data-action')).toBe('today.needsReview');
    expect(rows[4].textContent).toContain('2 new prompt ideas from your Search Console.');
    await act(async () => (link('ideas') as HTMLAnchorElement).click());
    expect(track).toHaveBeenCalledWith('today_waiting_clicked', { type: 'ideas' });
    expect(text('header')).toContain('Since yesterday: 3 changes · 5 things waiting for you');
  });

  it("lists the agent runs of the brand on screen, never another brand's", async () => {
    const byBrand: Record<string, Record<string, unknown>[]> = {
      b1: [chats[0]],
      b2: [
        {
          id: 'c9',
          mine: true,
          state: 'needsYou',
          title: 'Another brand’s page',
          lastMessageAt: '2026-11-11T09:00:00Z',
        },
      ],
    };
    // As the chats API answers: one brand's chats when asked, every brand's otherwise.
    vi.mocked(fetch).mockImplementation(async (input) => {
      const brand = new URL(String(input), 'https://app.example.com').searchParams.get('brandId');
      const list = brand ? (byBrand[brand] ?? []) : Object.values(byBrand).flat();
      return { ok: true, json: async () => ({ ok: true, chats: list }) } as unknown as Response;
    });
    await draw();
    expect(fetch).toHaveBeenCalledWith('/api/chat/conversations?brandId=b1', { cache: 'no-store' });
    const agent = container.querySelector('[data-waiting="agent"]');
    expect(agent?.textContent).toContain('An agent is waiting for your OK on “Comparison page”.');
    expect(agent?.textContent).not.toContain('Another brand');
    expect(agent?.querySelector('a')?.getAttribute('href')).toBe('/dashboard/chat/c1');
  });

  it("leaves out agent runs without Chat, and rows off the person's menu", async () => {
    chatOn = false;
    hidden = new Set(['content', 'prompts']);
    await draw();
    const rows = [...container.querySelectorAll('[data-waiting]')];
    expect(rows.map((row) => row.getAttribute('data-waiting'))).toEqual(['due', 'review']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says prompts wait for a spot, with Free up a spot and, on Starter, See Growth', async () => {
    reads.getTodayWaiting.mockResolvedValue({
      ...waiting,
      prompts: { count: 3, free: 0, fits: false, plan: 'starter' },
    });
    await draw();
    const types = [...container.querySelectorAll('[data-waiting]')].map((row) =>
      row.getAttribute('data-waiting'),
    );
    expect(types).toEqual(['agent', 'drafts', 'due', 'review', 'prompts', 'ideas']);
    const row = container.querySelector('[data-waiting="prompts"]')!;
    expect(row.textContent).toContain('3 prompts are waiting for a spot.');
    const links = [...row.querySelectorAll('a')];
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Free up a spot', '/dashboard/prompts/tracked?status=waiting&swap=1'],
      ['See Growth', '/dashboard/settings?tab=billing'],
    ]);
    await act(async () => links[1].click());
    expect(track).toHaveBeenCalledWith('prompt_limit_see_growth', { source: 'today' });
    await act(async () => links[0].click());
    expect(track).toHaveBeenCalledWith('today_waiting_clicked', { type: 'prompts' });
  });

  it('says a spot is free for one, which a waiting prompt never takes by itself', async () => {
    reads.getTodayWaiting.mockResolvedValue({
      ...waiting,
      prompts: { count: 2, free: 1, fits: true, plan: 'growth' },
    });
    await draw();
    const row = container.querySelector('[data-waiting="prompts"]')!;
    expect(row.textContent).toContain('1 spot free · 2 prompts wait for one.');
    expect(
      [...row.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([['Track a waiting prompt', '/dashboard/prompts/tracked?status=waiting&swap=1']]);
  });

  it('says nothing waits, and offers the focus action furthest along', async () => {
    reads.getTodayWaiting.mockResolvedValue({
      ...waiting,
      drafts: [],
      actions: [],
      reviews: null,
      ideas: null,
    });
    chats = [];
    reads.getTodayFocus.mockResolvedValue([
      card('a3', { action: action('a3', { status: 'in_progress', taskCompleted: 2 }) }),
    ]);
    await draw();
    const part = container.querySelector('[data-today-part="waiting"]');
    expect(part?.textContent).toContain('Nothing is waiting for you.');
    expect(part?.textContent).toContain('has 2 of 4 steps done.');
    expect(part?.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/action-center/actions?action=a3',
    );
    expect(text('header')).toContain('nothing waiting');
  });

  it('lists the night’s biggest changes as Up, Down and Rival, and counts them in the header', async () => {
    hidden = new Set(['traffic']);
    await draw();
    const rows = [...container.querySelectorAll('[data-today-part="since"] li')];
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual([
      'Up',
      'Up',
      'Rival',
    ]);
    expect(rows[2].textContent).toContain('Morning Ritual Co.');
    // The change and its action read as two sentences, not one run-on line.
    expect(rows[1].textContent).toBe(
      'UpFirst citation for beanbulletin.example. An action was added.',
    );
    expect(rows[0].textContent).toBe(
      'UpVisibility gained for “best whole bean coffee for espresso”',
    );
    const added = rows[1].querySelector('a');
    expect(added?.textContent).toBe('An action was added');
    expect(added?.getAttribute('href')).toBe('/dashboard/action-center/actions?action=a9');
    await act(async () => added?.click());
    expect(track).toHaveBeenCalledWith('today_since_clicked', {
      kind: 'first_citation',
      direction: 'up',
      target: 'action',
    });
    expect(text('header')).toContain('Since yesterday: 3 changes');
    expect(reads.getTodayChanges).toHaveBeenCalledWith('b1', '2026-11-10T08:00:00.000Z', [
      'traffic',
    ]);
  });

  it('names the day the window starts when it is before yesterday', async () => {
    const friday = new Date(Date.now() - 3 * 86_400_000);
    reads.getTodayChanges.mockResolvedValue({ ...changes, since: friday.toISOString() });
    await draw();
    const day = friday.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    expect(text('#today-since-title')).toBe(`Since ${day}`);
    expect(text('header')).toContain(`Since ${day}: 3 changes`);
  });

  it('says a quiet day is quiet, with the score held and small moves in all signals', async () => {
    reads.getTodayChanges.mockResolvedValue({ ...changes, items: [], total: 0, small: 2 });
    reads.getTodayStanding.mockResolvedValue({
      ...standing,
      change: 0,
      competitors: [{ name: 'Northbound Roasters', score: 60.1, change: 0.6 }],
    });
    await draw();
    const since = container.querySelector('[data-today-part="since"]');
    expect(since?.textContent).toContain(
      'No big changes. Your score held at 53.9, and no competitor moved more than 1 point.',
    );
    expect(since?.textContent).toContain(
      'Next update tomorrow morning. Small moves are in all signals.',
    );
    expect(since?.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/action-center/signals',
    );
    expect(text('header')).toContain('Since yesterday: no big changes');
  });
  it('lists the next 2 set-up steps with how long each takes, and all 7 on request', async () => {
    await draw();
    const part = container.querySelector('[data-today-part="setup"]')!;
    expect(part.textContent).toContain('Finish setting up5 of 7');
    const steps = () => [...part.querySelectorAll('[data-setup-step]')].map((li) => li.textContent);
    expect(steps()).toEqual([
      'Connect Google Search Console2 min',
      'Add the AI Traffic snippet5 min',
    ]);
    expect(part.querySelector('[data-setup-step="gsc"] a')?.getAttribute('href')).toBe(
      '/dashboard/settings?tab=integrations',
    );
    await act(async () => button('Show all steps')?.click());
    expect(steps()).toHaveLength(7);
    expect(steps()[5]).toBe('Connect Google AnalyticsSkipped');
  });

  it('hides the steps for the brand when an admin or manager hides them', async () => {
    await draw();
    await act(async () => button('Hide')?.click());
    expect(reads.skipGettingStarted).toHaveBeenCalledWith('b1');
    expect(reads.hideCard).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('today_setup_hidden', { by: 'brand' });
    expect(container.querySelector('[data-today-part="setup"]')).toBeNull();
  });

  it('hides the card for anyone else, and keeps it hidden on the next visit', async () => {
    canManage = false;
    await draw();
    await act(async () => button('Hide')?.click());
    expect(reads.skipGettingStarted).not.toHaveBeenCalled();
    expect(reads.hideCard).toHaveBeenCalledWith('b1', 'setup', null);
    expect(container.querySelector('[data-today-part="setup"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    reads.readUserBrandState.mockResolvedValue({ navSeen: {}, focus: [], hidden: { setup: null } });
    await draw();
    expect(container.querySelector('[data-today-part="setup"]')).toBeNull();
  });

  it('is gone at 7 of 7, and after Getting started was skipped', async () => {
    reads.getGettingStarted.mockResolvedValue(setUp({ gsc: true, ga: true, firstVisit: true }));
    await draw();
    expect(container.querySelector('[data-today-part="setup"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    reads.getGettingStarted.mockResolvedValue(setUp({ dismissedAt: '2026-10-21T00:00:00Z' }));
    await draw();
    expect(container.querySelector('[data-today-part="setup"]')).toBeNull();
  });

  it('asks an admin or manager whether to run it for a brand added beside others', async () => {
    reads.getGettingStarted.mockResolvedValueOnce(setUp({ confirmedAt: null }));
    await draw();
    const part = container.querySelector('[data-today-part="setup"]')!;
    expect(part.textContent).toContain('Run Getting started for Brewline Coffee?');
    await act(async () => button('Run Getting started')?.click());
    expect(reads.startGettingStarted).toHaveBeenCalledWith('b1');
    expect(reads.getGettingStarted).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('[data-setup-step]')).toHaveLength(2);
  });
  describe("on a brand's first day", () => {
    const firstDay = {
      firstName: 'Alex',
      engines: ['ChatGPT', 'Google Gemini'],
      prompts: [
        {
          id: 'p1',
          text: 'Best whole bean coffee for espresso?',
          topic: 'Espresso',
          demand: 'high',
        },
        {
          id: 'p2',
          text: 'Easiest coffee on a sensitive stomach?',
          topic: 'Low-acid',
          demand: null,
        },
      ],
      total: 22,
      checked: false,
      platforms: ['chatgpt-web', 'gemini-web'],
      models: [],
      suggestions: [{ id: 's1', text: 'Is single-origin coffee worth the price?' }],
      spots: { left: 28, limit: 50, plan: 'Starter' },
    };
    beforeEach(() => {
      reads.getTodayOverview.mockResolvedValue({
        ...overview,
        lastRunAt: null,
        trackedPrompts: 22,
      });
      reads.getTodayFirstDay.mockResolvedValue(firstDay);
      reads.getGettingStarted.mockResolvedValue(setUp({ kpiSetupAt: null }));
      reads.markPromptsChecked.mockResolvedValue({ ok: true });
      reads.setPromptActive.mockResolvedValue({ prompt: {} });
      reads.acceptSuggestion.mockResolvedValue({ promptId: 'p9' });
      firstRun = { progress: { current: 7, total: 44 } };
    });

    it('welcomes the person, shows the answers coming in, and asks them to check the prompts', async () => {
      await draw();
      expect(text('header p')).toBe(
        "Welcome, Alex · Brewline Coffee · we're asking ChatGPT and Google Gemini your questions right now",
      );
      const cells = [...container.querySelectorAll('ol[aria-label="Your loop"] li')].map(
        (li) => li.textContent,
      );
      expect(cells).toEqual([
        '1 · Prompts · you are here22 tracked',
        '2 · AI answers7 of 44 in',
        '3 · ActionsTomorrow',
        '4 · Done—',
        '5 · Results—',
      ]);
      expect(titles()).toEqual([
        'Check the prompts we track for you',
        'Worth tracking too',
        'While you wait · optional',
      ]);
      const rows = [...container.querySelectorAll('[data-prompt-id]')].map((li) => li.textContent);
      expect(rows[0]).toBe('Best whole bean coffee for espresso?Espresso · high demand');
      expect(text('[data-today-part="worth"]')).toContain(
        'From your website. 28 of 50 spots left on Starter.',
      );
      // No normal day's parts, and no reads for them.
      expect(reads.getTodayFocus).not.toHaveBeenCalled();
      expect(reads.getTodayStanding).not.toHaveBeenCalled();
      expect(track).toHaveBeenCalledWith('today_viewed', { state: 'day1' });
      expect(reads.markSeen).toHaveBeenCalledWith('b1', 'today');
    });

    it('stops tracking a prompt that doesn’t fit, and keeps Looks good for the brand', async () => {
      await draw();
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[data-prompt-id="p1"] button')?.click(),
      );
      expect(reads.setPromptActive).toHaveBeenCalledWith('p1', false);
      expect(track).toHaveBeenCalledWith('today_prompt_removed');
      expect(container.querySelector('[data-prompt-id="p1"]')).toBeNull();
      await act(async () => button('Looks good')?.click());
      expect(reads.markPromptsChecked).toHaveBeenCalledWith('b1');
      expect(track).toHaveBeenCalledWith('today_prompts_checked');
      expect(container.querySelector('[data-today-part="prompts"]')).toBeNull();
    });

    it('tracks a stored suggestion, and reads the day again', async () => {
      await draw();
      await act(async () => button('Track')?.click());
      expect(reads.acceptSuggestion).toHaveBeenCalledWith('s1');
      expect(reads.getTodayFirstDay).toHaveBeenCalledTimes(2);
    });

    it('offers the open set-up steps and, with Chat on, the tour while the person waits', async () => {
      await draw();
      const wait = container.querySelector('[data-today-part="wait"]')!;
      expect([...wait.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'Connect Google Search Console2 min',
        'Set one goal for this month1 min',
        'Take the 2-minute tour2 min',
      ]);
      await act(async () => button('Take the 2-minute tour2 min')?.click());
      expect(tour.show).toHaveBeenCalledWith('visibility', 'everything');
    });

    it('hides Worth tracking too without suggestions, and the tour without Chat', async () => {
      chatOn = false;
      canManage = false;
      reads.getTodayFirstDay.mockResolvedValue({ ...firstDay, suggestions: [], spots: null });
      await draw();
      expect(titles()).toEqual(['Check the prompts we track for you', 'While you wait · optional']);
      expect(text('[data-today-part="wait"]')).not.toContain('tour');
      // Anyone else can't remove or add, and Looks good hides the check for them.
      expect(container.querySelector('[data-prompt-id="p1"] button')).toBeNull();
      expect(button('+ Add a prompt')).toBeUndefined();
      await act(async () => button('Looks good')?.click());
      expect(reads.hideCard).toHaveBeenCalledWith('b1', 'prompts_check', null);
    });
  });
  describe('on Mondays', () => {
    const lastWeek = {
      visibility: { ...standing, score: 53.9, change: 3.5 },
      done: {
        count: 2,
        actions: [
          { id: 'd1', kind: 'recover_lost_citations', payload: {} },
          { id: 'd2', kind: 'recover_lost_citations', payload: {} },
        ],
      },
      results: { count: 1, actions: [{ id: 'd1', kind: 'recover_lost_citations', payload: {} }] },
    };
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-16T09:00:00Z'));
      reads.getTodayLastWeek.mockResolvedValue(lastWeek);
    });

    it("sums up last week in the loop strip's place, and names this week's focus", async () => {
      await draw();
      expect(reads.getTodayLastWeek).toHaveBeenCalledWith('b1', expect.any(String));
      expect(container.querySelector('ol[aria-label="Your loop"]')).toBeNull();
      const week = container.querySelector('[data-today-part="week"]')!;
      expect(week.textContent).toContain('Visibility53.9 +3.5from 50.4 · #2 of 5');
      expect(week.textContent).toContain('Actions done2');
      expect(week.textContent).toContain('Results in1 improved');
      expect(week.querySelector('a')?.getAttribute('href')).toBe('/dashboard/reports');
      expect(titles()).toContain("This week's focus");
      expect(titles()).not.toContain('Where you stand');
      expect(track).toHaveBeenCalledWith(
        'today_viewed',
        expect.objectContaining({ state: 'monday' }),
      );
    });

    it('keeps the normal day before the brand has a full week of runs', async () => {
      reads.getTodayLastWeek.mockResolvedValue(null);
      await draw();
      expect(container.querySelector('ol[aria-label="Your loop"]')).not.toBeNull();
      expect(titles()).toContain("Today's focus");
      expect(titles()).toContain('Where you stand');
    });
  });

  describe('after the plan ended', () => {
    const openUpgrade = vi.fn();
    beforeEach(() => {
      upgrade = { isLocked: true, reason: 'ended', adminName: null, openUpgrade };
      reads.getTodayEnded.mockResolvedValue({
        lastRunAt: '2026-11-14T05:00:00Z',
        trial: {
          score: 53.9,
          change: 3.5,
          rank: 2,
          of: 5,
          neighbour: { name: 'Northbound Roasters', gap: 6.2, ahead: false },
          competitors: [],
        },
        prompts: 22,
        competitors: 4,
        done: 2,
        improved: {
          count: 1,
          actions: [{ id: 'd1', kind: 'recover_lost_citations', payload: {} }],
        },
        open: 3,
        drafts: { count: 1, title: 'The low-acid buying guide' },
      });
    });

    it('reads what the trial found, read-only, with Choose a plan', async () => {
      await draw();
      expect(text('header')).toContain('tracking paused since Nov 14');
      expect(text('header')).toContain('Read-only until you choose a plan');
      const cells = [...container.querySelectorAll('ol[aria-label="Your loop"] li')].map(
        (li) => li.textContent,
      );
      expect(cells).toEqual([
        '1 · Prompts22 saved',
        '2 · AI answersPausedlast on Nov 14',
        '3 · Actions3 waiting',
        '4 · Done2 in the trial',
        '5 · Results53.9 +3.5over the trial',
      ]);
      expect(titles()).toEqual([
        'What your trial found',
        'Ready when you pick a plan',
        'Saved for you',
        'Picking up where you left off',
      ]);
      const found = text('[data-today-part="found"]');
      expect(found).toContain("Visibility rose from 50.4 to 53.9. You're #2 of 5 brands.");
      expect(found).toContain(
        'Northbound Roasters still leads by 6.2 points. 3 actions are ready to close it.',
      );
      expect(text('[data-today-part="saved"]')).toContain(
        '1 draft from your agent: The low-acid buying guide.',
      );
      // The focus is read-only: no Skip, no Start; "Needs a plan" opens the upgrade dialog.
      expect(button('Skip for now')).toBeUndefined();
      await act(async () => button('Needs a plan')?.click());
      expect(openUpgrade).toHaveBeenCalledTimes(1);
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[data-action="today.choosePlan"]')?.click(),
      );
      expect(track).toHaveBeenCalledWith('today_choose_plan_clicked');
      expect(openUpgrade).toHaveBeenCalledTimes(2);
      expect(text('main, div')).toContain('Chat can still read your past answers and data.');
      expect(reads.getTodayWaiting).not.toHaveBeenCalled();
      expect(track).toHaveBeenCalledWith(
        'today_viewed',
        expect.objectContaining({ state: 'ended' }),
      );
    });

    it('is the normal Today while a payment is retried', async () => {
      upgrade = { isLocked: true, reason: 'payment_failed', adminName: null, openUpgrade };
      await draw();
      expect(titles()).toContain("Today's focus");
      expect(reads.getTodayEnded).not.toHaveBeenCalled();
    });
  });

  describe('New area to track', () => {
    const topic = {
      candidate: {
        key: 'cold brew',
        name: 'Cold brew',
        source: 'catalog',
        catalog: { suggestionId: 't1', category: 'Coffee > Cold brew', products: 4 },
        search: { count: 3, sources: ['gsc'] },
        businessHub: null,
        llmSuggestionId: null,
        topicId: null,
        competitors: ['Northbound Roasters', 'Kettle & Crate'],
      },
      spots: { left: 3, plan: 'Starter' },
    };
    const ideas = [
      { id: 'i1', text: 'best cold brew coffee concentrate' },
      { id: 'i2', text: 'how to make cold brew at home' },
      { id: 'i3', text: 'cold brew vs iced coffee caffeine' },
      { id: 'i4', text: 'low acid cold brew for sensitive stomachs' },
    ];
    const card = () => container.querySelector('[data-today-part="topic"]');
    const boxes = () => [...card()!.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]')];
    const waits = () =>
      [...card()!.querySelectorAll('li')].map((li) => li.querySelector('[data-waits]') !== null);

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-16T09:00:00Z'));
      reads.getTodayLastWeek.mockResolvedValue(null);
      reads.getTodayTopic.mockResolvedValue(topic);
      reads.openTopicCard.mockResolvedValue({
        ok: true,
        topic: { id: 'topic-9', name: 'Cold brew' },
        ideas,
      });
      reads.trackTopicPrompts.mockResolvedValue({ ok: true, added: 3, waiting: 1 });
    });

    it("offers a topic on the person's Monday, under Waiting for you, with why and the spots", async () => {
      await draw();
      expect(reads.getTodayTopic).toHaveBeenCalledWith('b1');
      const aside = titles();
      expect(aside.indexOf('Cold brew')).toBe(aside.indexOf('Waiting for you') + 1);
      expect(card()!.className).toContain('border-dashed');
      expect(card()!.textContent).toContain('New area to track');
      expect(card()!.textContent).toContain(
        'No topic you track covers it yet. You sell 4 products in Coffee > Cold brew. ' +
          'People look for it: 3 prompt ideas from your Search Console are about it. ' +
          'AI answers name Northbound Roasters and Kettle & Crate here.',
      );
      expect(card()!.textContent).toContain('Needs 5 prompt spots · 3 left on Starter');
      expect(button('Suggest 5 prompts')).toBeDefined();
      expect(track).toHaveBeenCalledWith('today_topic_card_shown', { source: 'catalog' });
    });

    it("waits for today's focus to be finished on any other day", async () => {
      vi.setSystemTime(new Date('2026-11-18T09:00:00Z'));
      await draw();
      expect(card()).toBeNull();
      expect(reads.getTodayTopic).not.toHaveBeenCalled();

      act(() => root.unmount());
      root = createRoot(container);
      reads.getTodayFocus.mockResolvedValue([]);
      await draw();
      expect(card()).not.toBeNull();
    });

    it('is only for admins and managers with Prompts on their menu', async () => {
      canManage = false;
      await draw();
      expect(card()).toBeNull();
      act(() => root.unmount());
      root = createRoot(container);
      canManage = true;
      hidden = new Set(['prompts']);
      await draw();
      expect(card()).toBeNull();
      expect(reads.getTodayTopic).not.toHaveBeenCalled();
    });

    it('snoozes the topic for the person for 30 days with Not now', async () => {
      await draw();
      await act(async () => button('Not now')?.click());
      expect(reads.hideCard).toHaveBeenCalledWith(
        'b1',
        'topic:cold brew',
        new Date('2026-12-16T09:00:00Z'),
      );
      expect(track).toHaveBeenCalledWith('today_topic_not_now', { source: 'catalog' });
      expect(card()).toBeNull();
    });

    it('makes the topic, lists its stored ideas, marks the one past the spots and tracks the ticked', async () => {
      await draw();
      await act(async () => button('Suggest 5 prompts')?.click());
      expect(track).toHaveBeenCalledWith('today_topic_suggest_clicked', { source: 'catalog' });
      expect(reads.openTopicCard).toHaveBeenCalledWith('b1', {
        name: 'Cold brew',
        suggestionId: 't1',
        topicId: null,
      });
      // Stored ideas first: no prompts are written.
      expect(reads.writeTopicPrompts).not.toHaveBeenCalled();
      expect(boxes().map((box) => box.getAttribute('aria-checked'))).toEqual([
        'true',
        'true',
        'true',
        'true',
      ]);
      expect(waits()).toEqual([false, false, false, true]);
      expect(card()!.textContent).toContain(
        "1 prompt past your plan's limit will be saved as waiting for a spot",
      );
      // One unticked: the rest fit in the 3 spots.
      await act(async () => boxes()[1].click());
      expect(waits()).toEqual([false, false, false, false]);
      await act(async () => boxes()[1].click());

      await act(async () => button('Track 4 prompts')?.click());
      expect(reads.trackTopicPrompts).toHaveBeenCalledWith(
        'b1',
        'topic-9',
        ideas.map((idea) => ({ ideaId: idea.id, text: idea.text })),
      );
      expect(card()!.textContent).toContain('3 added to Cold brew, 1 waiting for a spot.');
      expect(card()!.querySelector('a')?.getAttribute('href')).toBe(
        '/dashboard/prompts/topics/topic-9',
      );
      expect(toast.warning).toHaveBeenCalledWith(
        '3 added, 1 waiting for a spot',
        expect.anything(),
      );
      expect(track).toHaveBeenCalledWith('prompt_saved_waiting', { path: 'topic_card', count: 1 });
    });

    it('has the per-topic generator write 5 once when the topic has no stored ideas', async () => {
      reads.openTopicCard.mockResolvedValue({
        ok: true,
        topic: { id: 'topic-9', name: 'Cold brew' },
        ideas: [],
      });
      reads.writeTopicPrompts.mockResolvedValue({
        ok: true,
        prompts: ['best cold brew maker', 'is cold brew less acidic'],
      });
      reads.trackTopicPrompts.mockResolvedValue({ ok: true, added: 2, waiting: 0 });
      await draw();
      await act(async () => button('Suggest 5 prompts')?.click());
      expect(reads.writeTopicPrompts).toHaveBeenCalledTimes(1);
      expect(reads.writeTopicPrompts).toHaveBeenCalledWith('b1', 'topic-9');
      expect(card()!.textContent).toContain('Written just now for this topic.');
      await act(async () => button('Track 2 prompts')?.click());
      expect(reads.trackTopicPrompts).toHaveBeenCalledWith('b1', 'topic-9', [
        { ideaId: null, text: 'best cold brew maker' },
        { ideaId: null, text: 'is cold brew less acidic' },
      ]);
      expect(card()!.textContent).toContain('2 prompts added to Cold brew.');
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('offers to try again when the prompts could not be written', async () => {
      reads.openTopicCard.mockResolvedValue({
        ok: true,
        topic: { id: 'topic-9', name: 'Cold brew' },
        ideas: [],
      });
      reads.writeTopicPrompts.mockResolvedValueOnce({ ok: false, error: 'failed' });
      reads.writeTopicPrompts.mockResolvedValueOnce({
        ok: true,
        prompts: ['best cold brew maker'],
      });
      await draw();
      await act(async () => button('Suggest 5 prompts')?.click());
      expect(card()!.textContent).toContain("Couldn't write prompts just now.");
      await act(async () => button('Try again')?.click());
      expect(reads.writeTopicPrompts).toHaveBeenCalledTimes(2);
      expect(button('Track 1 prompt')).toBeDefined();
    });
  });
});
