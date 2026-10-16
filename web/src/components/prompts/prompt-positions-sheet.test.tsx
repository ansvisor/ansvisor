import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { summarizePositions, type PositionAnswer } from '@/lib/prompt-positions';
import type { PromptPositionsData } from '@/lib/actions/prompt-positions';

/**
 * The positions panel over a week: its cards carry the table's answer,
 * mention and citation counts beside the days.
 */

const { getPromptPositions } = vi.hoisted(() => ({ getPromptPositions: vi.fn() }));
vi.mock('@/lib/actions/prompt-positions', () => ({ getPromptPositions }));
vi.mock('./prompt-improve-tab', () => ({
  ImproveTab: () => null,
  useImprove: () => ({ count: null, dirty: false }),
}));
vi.mock('@/components/filters/date-range-filter', () => ({ DateRangeFilter: () => null }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { PromptPositionsSheet } = await import('./prompt-positions-sheet');

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const WEEK = { from: '2026-10-04T00:00:00.000Z', to: '2026-10-10T23:59:59.999Z' };

const answer = (over: Partial<PositionAnswer> & { createdAt: string }): PositionAnswer => ({
  platform: 'chatgpt-web',
  region: 'US',
  mentioned: false,
  mentions: 0,
  mentionPosition: null,
  mentionTotal: null,
  sentiment: null,
  cited: false,
  citations: 0,
  citation: null,
  ...over,
});

function data(locked = false): PromptPositionsData {
  const { summary, platforms } = summarizePositions(
    [
      answer({
        createdAt: '2026-10-08T02:00:00Z',
        mentioned: true,
        mentions: 3,
        mentionPosition: 2,
        mentionTotal: 3,
        cited: true,
        citations: 2,
        citation: { rank: 1, total: 4 },
      }),
      answer({ createdAt: '2026-10-09T02:00:00Z' }),
    ],
    [
      { id: 'chatgpt-web', label: 'ChatGPT', access: { state: 'included' } },
      ...(locked
        ? [
            {
              id: 'google-aio' as const,
              label: 'Google AI Overviews',
              access: { state: 'locked' as const, requiredPlan: 'growth' as const },
            },
          ]
        : []),
    ],
    WEEK,
  );
  return {
    prompt: { id: 'p1', text: 'Best coffee subscription?', topicName: null, isActive: true },
    planId: 'enterprise',
    window: WEEK,
    summary,
    platforms,
    improving: null,
  };
}

let container: HTMLDivElement;
let root: Root;

async function open(preset: '7d' | '24h' = '7d') {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PromptPositionsSheet
          prompt={{ id: 'p1', text: 'Best coffee subscription?' }}
          range={{ preset, from: '', to: '' }}
          window={WEEK}
          onRangeChange={() => {}}
          region=""
          onClose={() => {}}
        />
      </NextIntlClientProvider>,
    ),
  );
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getPromptPositions.mockResolvedValue(data());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('PromptPositionsSheet', () => {
  it("puts the table's answer, mention and citation counts beside the days", async () => {
    await open();
    const text = document.body.textContent ?? '';
    expect(text).toContain('2 answers');
    expect(text).toContain('In 1 of 2 answers · 3 mentions');
    expect(text).toContain('In 1 of 2 answers · 2 citations');
    expect(text).not.toContain('your plan includes');
  });

  it("says the 24h cards' answer counts cover the period, not the latest run", async () => {
    await open('24h');
    const text = document.body.textContent ?? '';
    expect(text).toContain('2 answers in this period');
    expect(text).toContain('In 1 of 2 answers in this period · 3 mentions');
  });

  it('says the counts leave out a platform the plan locks', async () => {
    getPromptPositions.mockResolvedValue(data(true));
    await open();
    expect(document.body.textContent).toContain(
      'Answer counts cover the platforms your plan includes.',
    );
  });
});
