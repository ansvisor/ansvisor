import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { Signal } from '@/lib/signals/map';
import { ChatPageSetterContext } from '@/components/chat/panel/chat-panel-context';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

/**
 * What Chat's side panel sees of Action Center › Signals (the owner's plan of
 * 2026-11-16, step 9): its window, its filters as the reads name them, its
 * search, and once read the signals on screen by the code each row shows.
 */

const signals = vi.hoisted(() => ({
  getSignals: vi.fn(),
  getSignalsSummary: vi.fn(),
  updateSignalStatus: vi.fn(),
}));
vi.mock('@/lib/actions/signals', () => signals);
const reads = vi.hoisted(() => ({ getTrackingWindow: vi.fn() }));
vi.mock('@/lib/visibility-reads', () => reads);
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (state: { getActiveBrand: () => unknown }) => unknown) =>
    select({ getActiveBrand: () => ({ id: 'b1', slug: 'acme', name: 'Acme' }) }),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/action-center/action-center-tabs', () => ({ ActionCenterTabs: () => null }));
// The list and its drawer have their own tests: here, what the page hands Chat.
vi.mock('@/components/action-center/signal-table', () => ({
  SignalTable: () => null,
  isSuperseded: () => false,
}));
vi.mock('@/components/action-center/signal-drawer', () => ({ SignalDrawer: () => null }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const { default: SignalsPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ID = '11111111-1111-4111-8111-111111111111';

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
    where: { platforms: [], regions: [] } as unknown as Signal['where'],
    ...overrides,
  };
}

const SUMMARY = {
  total: 3,
  prevTotal: 2,
  important: 1,
  prevImportant: 1,
  newCount: 1,
  prevNew: 0,
  resolved: 0,
  prevResolved: 0,
  byDayActive: {},
  byDayImportant: {},
  byDayNew: {},
  byDayResolved: {},
  byCategory: {},
  bySource: {},
};

let container: HTMLDivElement;
let root: Root;
const setPage = vi.fn();

beforeEach(() => {
  setPage.mockReset();
  signals.getSignals.mockResolvedValue([
    signal('s1', { brandNo: 7 }),
    signal(ID, { kind: 'first_citation', category: 'citation' }),
    signal('s3', { brandNo: 12, kind: 'competitor_surge', category: 'competitor' }),
  ]);
  signals.getSignalsSummary.mockResolvedValue(SUMMARY);
  reads.getTrackingWindow.mockResolvedValue({ lastRunAt: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

async function render(url = '/dashboard/action-center/signals') {
  window.history.replaceState(null, '', url);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked: false, reason: 'ended', adminName: null, openUpgrade: vi.fn() }}
        >
          <ChatPageSetterContext.Provider value={setPage}>
            <SignalsPage />
          </ChatPageSetterContext.Provider>
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
  return setPage.mock.lastCall![0];
}

describe("what Chat's side panel sees (the owner's plan, step 9)", () => {
  it('sends its window and once read the signals on screen by their S- code, else their id', async () => {
    const page = await render();
    expect(page).toMatchObject({
      pageName: 'Signals',
      dateRange: { from: '30d', to: null, label: 'Last 30 days' },
      filters: [],
    });
    expect(page.view.rows.map((row: { ref: string }) => row.ref)).toEqual(['S-07', ID, 'S-12']);
    expect(page.view.total).toBe(3);
    expect(page.view).not.toHaveProperty('search');
    // Leaving the page takes it back.
    act(() => root.unmount());
    expect(setPage).toHaveBeenLastCalledWith(null);
    root = createRoot(container);
  });

  it('sends its filters as the reads name them, and its search', async () => {
    const page = await render(
      '/dashboard/action-center/signals?range=7d&category=citation&impact=high&status=new&source=gsc&platform=openai&q=S-99',
    );
    expect(page.dateRange).toEqual({ from: '7d', to: null, label: 'Last 7 days' });
    expect(page.filters).toEqual([
      { key: 'category', label: 'Citation', value: 'citation' },
      { key: 'impact', label: 'High', value: 'high' },
      { key: 'status', label: 'New', value: 'new' },
      { key: 'source', label: 'Google Search Console', value: 'gsc' },
      { key: 'platform', label: 'ChatGPT', value: 'openai' },
    ]);
    // The search finds none here: its words, no rows, and how many match.
    expect(page.view).toEqual({ search: 'S-99', rows: [], total: 0 });
  });

  it('sends no rows while it reads', async () => {
    signals.getSignals.mockReturnValue(new Promise(() => {}));
    expect((await render()).view).toEqual({});
  });
});

describe('what the page says about its signals', () => {
  it('says the signals come from the latest AI answer run, and how long ago (AC-40)', async () => {
    reads.getTrackingWindow.mockResolvedValue({
      lastRunAt: new Date(Date.now() - 15 * 3_600_000).toISOString(),
    });
    await render();
    expect(reads.getTrackingWindow).toHaveBeenCalledWith('b1');
    expect(container.textContent).toContain(
      'Signals from your latest AI answer run (15 hours ago). They drive your Action Center.',
    );
    expect(container.textContent).not.toContain('Real-time');
  });

  it('before a first run, says where signals come from without a time', async () => {
    await render();
    expect(container.textContent).toContain(
      'Signals from your AI answers, your site and the web. They drive your Action Center.',
    );
  });

  it('explains why Resolved can be more than New (AC-42)', async () => {
    await render();
    const note = container.querySelector('[title^="Can be more than New"]');
    expect(note?.getAttribute('title')).toBe(
      'Can be more than New: it includes signals opened before this period and resolved in it.',
    );
  });
});
