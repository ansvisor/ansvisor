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
 * before. The volumes the server refuses it don't read as an outage.
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
}));
vi.mock('@/lib/actions/prompt', () => actions);
vi.mock('@/lib/actions/tracking-countries', () => ({ getTrackingCountries: async () => [] }));
const volumes = vi.hoisted(() => ({
  startPromptVolumeAnalysis: vi.fn(),
  getVolumeAnalysisStatus: vi.fn(async () => null),
  refreshVolumes: vi.fn(),
}));
vi.mock('@/lib/actions/volumes', () => volumes);
vi.mock('@/lib/actions/tracking', () => ({
  getBrandFilterOptions: vi.fn(async () => ({ regions: [] })),
}));
vi.mock('@/lib/actions/topic', () => ({ getTopics: vi.fn(async () => []) }));
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
vi.mock('@/components/prompts/prompt-positions-sheet', () => ({
  PromptPositionsSheet: () => null,
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => ({ canManage: true }) }));
// The brand's first run: null unless a test says it goes on.
const firstRun = vi.hoisted(() => ({ run: null as FirstRun | null }));
vi.mock('@/hooks/use-first-run', () => ({ useFirstRun: () => firstRun.run }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (state: unknown) => unknown) =>
    select({ activeBrandId: 'b1', brands: [{ id: 'b1', slug: 'acme', name: 'Acme' }] }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
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

const { default: PromptsPage } = await import('./page');

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
  createdAt: '2026-09-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <PromptsPage />
        </UpgradeDialogContext.Provider>
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

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/dashboard/prompts/tracked';
  firstRun.run = null;
  contentUsage.value = null;
  getOpenSuggestionForPrompt.mockResolvedValue(null);
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
  // The prompt has no volume yet: the banner offers "Analyze 1 prompt".
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
    await act(async () => button('Analyze 1 prompt')!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Analyzing prompts needs a plan');
    expect(volumes.startPromptVolumeAnalysis).not.toHaveBeenCalled();
  });

  it('opens the upgrade dialog, not "not part of your plan", when the server says the plan ended', async () => {
    volumes.startPromptVolumeAnalysis.mockResolvedValue({
      ok: false,
      code: 'subscription_inactive',
    });
    await render(false);
    await act(async () => button('Analyze 1 prompt')!.click());
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

  it('offers Analyze on Tracked, not "limit is reached", and it opens the upgrade dialog', async () => {
    actions.getPromptsPageData.mockResolvedValue(pageData(noPlan));
    await render(true);
    expect(container.textContent).toContain('Run volume analysis to fill in');
    expect(container.textContent).not.toContain('limit is reached');
    const analyze = button('Analyze 1 prompt')!;
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
