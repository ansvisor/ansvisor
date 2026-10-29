import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import type { QueryFanoutData } from '@/lib/actions/fanout';

/**
 * Track on the Query Fan-out tab adds the sub-query as a tracked prompt; on
 * a read-only workspace (plan not active) it opens the upgrade dialog
 * instead, and the intents aren't asked for.
 */

const actions = vi.hoisted(() => ({
  getQueryFanout: vi.fn(),
  trackFanoutQuery: vi.fn(),
  classifyFanoutIntents: vi.fn(async () => ({})),
}));
vi.mock('@/lib/actions/fanout', () => actions);
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { QueryFanoutTab } = await import('./_fanout-tab');
const { toast } = await import('sonner');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const data: QueryFanoutData = {
  subQueries: [
    {
      query: 'best coffee beans',
      engines: ['chatgpt-web'],
      timesSearched: 3,
      sourcedPrompts: [{ id: 'p1', text: 'Best coffee subscription?' }],
      tracked: false,
      trackedPromptId: null,
    },
  ],
  totalObserved: 1,
  promptCoverage: [
    {
      id: 'p1',
      text: 'Best coffee subscription?',
      totalRuns: 3,
      runsWithFanout: 3,
      platforms: ['chatgpt-web'],
      fanoutPlatforms: ['chatgpt-web'],
    },
  ],
  engines: [],
  truncated: false,
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
          <QueryFanoutTab brandId="b1" range={null} rangeLabel="last 7 days" />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  // The High frequency view lists each sub-query with its Track button.
  const view = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'High frequency',
  )!;
  await act(async () => view.click());
}

const track = () =>
  container.querySelector<HTMLButtonElement>(
    '[aria-label=\'Track "best coffee beans" as a prompt\']',
  )!;

beforeEach(() => {
  vi.clearAllMocks();
  actions.getQueryFanout.mockResolvedValue(data);
  actions.trackFanoutQuery.mockResolvedValue({ promptId: 'p2' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Track on the Query Fan-out tab', () => {
  it('opens the upgrade dialog, tracking nothing, on a read-only workspace', async () => {
    await render(true);
    await act(async () => track().click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Tracking prompts needs a plan');
    expect(actions.trackFanoutQuery).not.toHaveBeenCalled();
    expect(actions.classifyFanoutIntents).not.toHaveBeenCalled();
  });

  it('tracks the sub-query on an active plan', async () => {
    await render(false);
    await act(async () => track().click());
    expect(actions.trackFanoutQuery).toHaveBeenCalledWith('b1', 'best coffee beans');
    expect(openUpgrade).not.toHaveBeenCalled();
    expect(actions.classifyFanoutIntents).toHaveBeenCalledWith(['best coffee beans']);
  });

  it('asks for a topic first on a brand without one, with a way to the Topics tab', async () => {
    actions.trackFanoutQuery.mockResolvedValue({
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    await render(false);
    await act(async () => track().click());
    expect(document.body.textContent).toContain('Add a topic first');
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent === 'Add a topic');
    expect(link?.getAttribute('href')).toBe('/dashboard/prompts/topics?new=1');
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
