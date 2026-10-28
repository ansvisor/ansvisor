import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import type { Prompt } from '@/types';

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
}));
vi.mock('@/lib/actions/prompt', () => actions);
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
vi.mock('@/lib/actions/content', () => ({
  getContentUsage: vi.fn(async () => null),
  getGenerationJobStatus: vi.fn(),
  getOpenSuggestionForPrompt: vi.fn(async () => null),
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
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (state: unknown) => unknown) =>
    select({ activeBrandId: 'b1', brands: [{ id: 'b1', slug: 'acme', name: 'Acme' }] }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => '/dashboard/prompts/tracked',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
