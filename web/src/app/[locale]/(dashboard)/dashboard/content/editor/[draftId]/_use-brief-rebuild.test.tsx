import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentDraft } from '@/lib/content/drafts';
import type { DraftSourceChoice, DraftSourcesData } from '@/lib/content/sources';
import { toast } from 'sonner';
import { useBriefRebuild } from './_use-brief-rebuild';
import type { SourcesRead } from './_use-draft-reads';

/**
 * Rebuild outline (CE-007): from the sources in hand, or read afresh once
 * prompts were added — and that fresh read becomes the editor's, so the
 * Sources tab doesn't read them again.
 */

const addDraftPrompts = vi.fn();
const getDraftSources = vi.fn();
const rebuildDraftBrief = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  addDraftPrompts: (...args: unknown[]) => addDraftPrompts(...args),
  getDraftSources: (...args: unknown[]) => getDraftSources(...args),
  rebuildDraftBrief: (...args: unknown[]) => rebuildDraftBrief(...args),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SOURCES: { data: DraftSourcesData; choices: DraftSourceChoice[] } = {
  data: {
    prompts: [],
    fanouts: [{ query: 'espresso ratio', platforms: ['copilot-web'], searched: 3 }],
    citedPages: [],
    gscQueries: [],
    brandDomains: [],
    competitorDomains: [],
  },
  choices: [],
};
const draft = { id: 'd1', brandId: 'b1', sourceUrl: null } as unknown as ContentDraft;
const onSourcesRead = vi.fn();
const onRebuilt = vi.fn();
let inHand: SourcesRead | null;

/** The hook behind buttons, as the side panel drives it. */
function Harness() {
  const { rebuild } = useBriefRebuild({
    draft,
    pageNow: () => ({ title: 'T', html: '<h1>T</h1>', length: 3000 }),
    sourcesNow: () => inHand,
    onSourcesRead,
    onRebuilt,
  });
  return (
    <>
      <button data-rebuild onClick={() => void rebuild()} />
      <button data-lost onClick={() => void rebuild({ addPrompts: ['p1'] })} />
    </>
  );
}

const press = (name: 'rebuild' | 'lost') =>
  act(async () => container.querySelector<HTMLButtonElement>(`[data-${name}]`)!.click());

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  for (const fn of [addDraftPrompts, getDraftSources, rebuildDraftBrief, onSourcesRead, onRebuilt])
    fn.mockReset();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  addDraftPrompts.mockResolvedValue(undefined);
  getDraftSources.mockResolvedValue(SOURCES);
  rebuildDraftBrief.mockResolvedValue({ brief: { builtFrom: null } });
  inHand = { ...SOURCES, failed: false };
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Harness />
      </NextIntlClientProvider>,
    ),
  );
});

afterEach(() => act(() => root.unmount()));

describe('useBriefRebuild', () => {
  it('builds from the sources in hand, reading nothing', async () => {
    await press('rebuild');
    expect(getDraftSources).not.toHaveBeenCalled();
    expect(onSourcesRead).not.toHaveBeenCalled();
    expect(onRebuilt).toHaveBeenCalled();
  });

  it('reads the sources once after adding prompts, and hands that read to the editor', async () => {
    await press('lost');
    expect(addDraftPrompts).toHaveBeenCalledWith('d1', ['p1']);
    expect(getDraftSources).toHaveBeenCalledTimes(1);
    expect(onSourcesRead).toHaveBeenCalledWith({ ...SOURCES, failed: false });
  });

  it('says the fresh read failed, so the Sources tab can try again', async () => {
    getDraftSources.mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await press('lost');
    expect(onSourcesRead).toHaveBeenCalledWith({ data: null, choices: [], failed: true });
    expect(rebuildDraftBrief).not.toHaveBeenCalled();
  });

  it('says a rebuild stopped from the agent card changed nothing, not that it failed', async () => {
    rebuildDraftBrief.mockResolvedValue({ error: 'stopped' });
    await press('rebuild');
    expect(toast).toHaveBeenCalledWith('Stopped · nothing was changed');
    expect(toast.error).not.toHaveBeenCalled();
    expect(onRebuilt).not.toHaveBeenCalled();
  });
});
