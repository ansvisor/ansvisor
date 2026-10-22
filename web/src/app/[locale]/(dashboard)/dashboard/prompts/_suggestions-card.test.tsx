import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PromptSuggestion, TrackSuggestionsResult } from '@/lib/actions/prompt-suggestions';
import { SuggestionsCard } from './_suggestions-card';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  getPromptSuggestions: vi.fn(),
  refreshPromptSuggestions: vi.fn(),
  acceptSuggestion: vi.fn(),
  dismissSuggestion: vi.fn(),
  trackSuggestions: vi.fn(),
}));
vi.mock('@/lib/actions/prompt-suggestions', () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const suggestion = (n: number): PromptSuggestion => ({
  id: `s${n}`,
  brandId: 'b1',
  suggestedText: `Prompt ${n}`,
  topicName: null,
  topicId: null,
  reason: null,
  estVolume: null,
  relevance: null,
  source: 'llm',
  sourceData: null,
  status: 'new',
  generatedAt: '2026-10-21T08:00:00.000Z',
  expiresAt: '2026-11-21T08:00:00.000Z',
});

const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `s${from + i}`);

let container: HTMLDivElement;
let root: Root;
const onAccepted = vi.fn();

async function render(count: number, planId: 'starter' | 'growth' = 'starter') {
  actions.getPromptSuggestions.mockResolvedValue({
    suggestions: Array.from({ length: count }, (_, i) => suggestion(i + 1)),
  });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SuggestionsCard
          brandId="b1"
          onAccepted={onAccepted}
          sourceStates={null}
          planId={planId}
          limitActions={<button type="button">Upgrade plan</button>}
        />
      </NextIntlClientProvider>,
    );
  });
}

const addAllButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Add All');
const rows = () => container.querySelectorAll('li');

async function clickAddAll() {
  await act(async () => {
    addAllButton()!.click();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SuggestionsCard — Add All', () => {
  it('sits between New and Clear All', async () => {
    await render(3);
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    const at = (label: string) => labels.indexOf(label);
    expect(at('New')).toBeGreaterThan(-1);
    expect(at('Add All')).toBe(at('New') + 1);
    expect(at('Clear All')).toBe(at('Add All') + 1);
  });

  it('tracks every suggestion listed and takes them off the list', async () => {
    await render(3);
    actions.trackSuggestions.mockResolvedValue({
      trackedIds: ids(1, 3),
      skippedIds: [],
    } satisfies TrackSuggestionsResult);

    await clickAddAll();

    expect(actions.trackSuggestions).toHaveBeenCalledExactlyOnceWith(ids(1, 3));
    expect(rows()).toHaveLength(0);
    expect(onAccepted).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith('3 prompts added to your tracked list');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('sends more than 25 in batches', async () => {
    await render(30);
    actions.trackSuggestions.mockImplementation(async (batch: string[]) => ({
      trackedIds: batch,
      skippedIds: [],
    }));

    await clickAddAll();

    expect(actions.trackSuggestions.mock.calls).toEqual([[ids(1, 25)], [ids(26, 30)]]);
    expect(rows()).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith('30 prompts added to your tracked list');
  });

  it('keeps the rest and says how to make room when the plan limit is reached', async () => {
    await render(25);
    actions.trackSuggestions.mockResolvedValue({
      trackedIds: ids(1, 10),
      skippedIds: [],
      error: 'Your Starter plan allows up to 50 active prompt locations…',
      code: 'plan_limit',
    } satisfies TrackSuggestionsResult);

    await clickAddAll();

    expect(rows()).toHaveLength(15);
    expect(rows()[0].textContent).toContain('Prompt 11');
    expect(toast.success).toHaveBeenCalledWith('10 prompts added to your tracked list');
    expect(toast.error).not.toHaveBeenCalled();
    const note = container.querySelector('[role="alert"]')!;
    expect(note.textContent).toContain("15 suggestions couldn't be added");
    expect(note.textContent).toContain(
      "10 were added before your plan's prompt limit was reached.",
    );
    expect(note.textContent).toContain(
      'Upgrade your plan, or pause 15 prompts in Tracked Prompts first and try again.',
    );
    expect(note.querySelector('a[href="/dashboard/prompts/tracked"]')?.textContent).toBe(
      'Go to Tracked Prompts',
    );
    // The page's own Upgrade / Contact us buttons.
    expect([...note.querySelectorAll('button')].map((b) => b.textContent)).toContain(
      'Upgrade plan',
    );
  });

  it('stops after the batch that reached the limit', async () => {
    await render(30, 'growth');
    actions.trackSuggestions.mockResolvedValue({
      trackedIds: [],
      skippedIds: ['s1'],
      error: 'limit',
      code: 'plan_limit',
    } satisfies TrackSuggestionsResult);

    await clickAddAll();

    expect(actions.trackSuggestions).toHaveBeenCalledOnce();
    expect(onAccepted).not.toHaveBeenCalled();
    // The skipped one was handled elsewhere: it leaves, the other 29 stay.
    expect(rows()).toHaveLength(29);
    const note = container.querySelector('[role="alert"]')!;
    expect(note.textContent).toContain("29 suggestions couldn't be added");
    expect(note.textContent).toContain(
      "Your plan's prompt limit is reached. Contact us to raise your limit, or pause 29 prompts",
    );

    await act(async () => {
      (note.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('reports any other failure as an error and keeps what was not added', async () => {
    await render(3);
    actions.trackSuggestions.mockResolvedValue({
      trackedIds: ['s1'],
      skippedIds: [],
      error: 'Something broke',
    } satisfies TrackSuggestionsResult);

    await clickAddAll();

    expect(rows()).toHaveLength(2);
    expect(toast.success).toHaveBeenCalledWith('1 prompt added to your tracked list');
    expect(toast.error).toHaveBeenCalledWith('Something broke');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('says so when every suggestion was already handled elsewhere', async () => {
    await render(2);
    actions.trackSuggestions.mockResolvedValue({
      trackedIds: [],
      skippedIds: ids(1, 2),
    } satisfies TrackSuggestionsResult);

    await clickAddAll();

    expect(rows()).toHaveLength(0);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('These suggestions were already added or dismissed');
  });
});

describe('SuggestionsCard — estimated volume', () => {
  it("shows an AI's guess as a grey range, never a bare number", async () => {
    actions.getPromptSuggestions.mockResolvedValue({
      suggestions: [{ ...suggestion(1), estVolume: 1200 }],
    });
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <SuggestionsCard
            brandId="b1"
            onAccepted={onAccepted}
            sourceStates={null}
            planId="growth"
          />
        </NextIntlClientProvider>,
      );
    });
    const range = container.querySelector<HTMLButtonElement>('button[aria-label*="a month"]')!;
    expect(range.textContent).toBe('600–2.4k/mo');
    expect(range.getAttribute('aria-label')).toBe('600–2.4k a month, estimated, Low confidence');
    expect(range.className).toContain('text-muted-foreground');
    expect(container.textContent).not.toContain('~1,200');
  });
});
