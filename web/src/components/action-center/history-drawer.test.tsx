import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ActionHistoryItem } from '@/lib/action-center/history';
import type { Signal } from '@/lib/signals/map';
import { guessedVolumeEstimate } from '@/lib/volume-estimate';

/**
 * The History drawer's goal and what happened, told from the action's own
 * signals as the Actions drawer tells them (AC-003), with the general
 * sentences while nothing can be read.
 */

const { getActionSignals, getPromptDemand } = vi.hoisted(() => ({
  getActionSignals: vi.fn(),
  getPromptDemand: vi.fn(),
}));
vi.mock('@/lib/actions/action-center', () => ({ getActionSignals, getPromptDemand }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { HistoryDrawer } = await import('./history-drawer');

// Days are read where the reader is; pin it so the fixtures' days hold anywhere.
process.env.TZ = 'UTC';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const item = {
  id: 'a1',
  actionNo: 12,
  kind: 'recover_lost_citations',
  type: 'recover',
  priorityScore: 84,
  priorityLevel: 'high',
  status: 'completed',
  outcome: 'improved',
  payload: {},
  kpiKeys: [],
  sources: ['ai_results'],
  triggerSignals: [{ signalId: 's1', kind: 'lost_citations', detectedAt: '2026-10-09T00:00:00Z' }],
  affected: [],
  results: [],
  positionOutcome: null,
  tasks: [],
  assignee: null,
  dueDate: '2026-11-09',
  createdAt: '2026-10-10T00:00:00Z',
  completedAt: '2026-10-20T00:00:00Z',
  timeToCloseDays: 10,
} as ActionHistoryItem;

const signal = {
  id: 's1',
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status: 'resolved',
  source: ['ai_results'],
  detectedAt: '2026-10-09T00:00:00Z',
  lastDetectedAt: '2026-10-09T00:00:00Z',
  resolvedAt: '2026-10-20T00:00:00Z',
  previousValue: null,
  currentValue: null,
  changeValue: null,
  payload: {
    promptId: 'p1',
    promptText: 'Best coffee subscription?',
    lostUrls: [{ url: 'https://acme.example/pricing', position: 2 }],
  },
  kpiKeys: [],
  actionId: 'a1',
  where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
} as unknown as Signal;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

/** The text under a section's label. */
const under = (label: string) =>
  [...document.querySelectorAll('section')].find((s) => s.textContent?.startsWith(label))
    ?.textContent ?? '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getActionSignals.mockReset();
  getPromptDemand.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('HistoryDrawer', () => {
  it("tells the goal and what happened from the action's signals once they are read", async () => {
    let answer: (value: unknown) => void = () => {};
    getActionSignals.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    getPromptDemand.mockResolvedValue({ p1: guessedVolumeEstimate(5500, null) });
    render(<HistoryDrawer brandId="b1" item={item} onOpenChange={() => {}} />);

    // Placeholders while reading, not the general sentences.
    expect(under('What was the goal?')).toBe('What was the goal?');
    expect(getActionSignals).toHaveBeenCalledWith('b1', 'a1');

    await act(async () => answer([signal]));
    const happened = under('What happened?');
    expect(happened).toContain('Best coffee subscription?');
    expect(happened).toContain('2.7–11k AI searches a month, estimated');
    expect(happened).toContain('Oct 9');
    // The goal is dated by the action's due date.
    expect(under('What was the goal?')).toContain('Nov 9');
  });

  it('keeps the general sentences when the signals cannot be read', async () => {
    getActionSignals.mockRejectedValue(new Error('offline'));
    render(<HistoryDrawer brandId="b1" item={item} onOpenChange={() => {}} />);
    await act(async () => {});

    expect(under('What happened?')).toContain(
      `What happened?${messages.actionCenter.actionTexts.recover_lost_citations.description}`,
    );
    expect(under('What was the goal?')).not.toBe('What was the goal?');
    expect(getPromptDemand).not.toHaveBeenCalled();
  });

  it.each([
    [1, 'Consolidated from 1 signal'],
    [3, 'Consolidated from 3 signals'],
  ])('counts %i trigger signal(s) in the right grammatical number', async (count, text) => {
    getActionSignals.mockResolvedValue([]);
    const triggerSignals = Array.from({ length: count }, (_, i) => ({
      signalId: `s${i}`,
      kind: 'lost_citations',
      detectedAt: '2026-10-09T00:00:00Z',
    }));
    render(
      <HistoryDrawer brandId="b1" item={{ ...item, triggerSignals }} onOpenChange={() => {}} />,
    );
    await act(async () => {});

    const line = [...document.querySelectorAll('p')].find((p) =>
      p.textContent?.startsWith('Consolidated from'),
    );
    expect(line?.textContent).toBe(text);
  });
});
