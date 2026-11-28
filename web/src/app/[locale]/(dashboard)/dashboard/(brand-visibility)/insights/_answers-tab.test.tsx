import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { InsightsAnswer, InsightsAnswersPage } from '@/lib/insights-answers';
import type { InsightsBreakdown } from '@/lib/insights-breakdown';

/** The breakdown panel's Answers tab: the answers behind a card's number. */

const actions = vi.hoisted(() => ({
  getInsightsAnswers: vi.fn(),
  getInsightsBreakdown: vi.fn(),
  getPromptResultById: vi.fn(),
}));
vi.mock('@/lib/actions/insights-answers', () => ({
  getInsightsAnswers: actions.getInsightsAnswers,
}));
vi.mock('@/lib/actions/tracking', () => ({
  getInsightsBreakdown: actions.getInsightsBreakdown,
  getPromptResultById: actions.getPromptResultById,
}));
vi.mock('@/components/results/response-detail', () => ({
  ResponseDetail: ({ result }: { result: { response: string } }) => (
    <div data-slot="response-detail">{result.response}</div>
  ),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { MetricBreakdownSheet } = await import('./_metric-breakdown-sheet');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const breakdown: InsightsBreakdown = {
  metric: 'visibility',
  curTotal: 42,
  comparedCur: 42,
  prevTotal: 40,
  comparison: null,
  delta: 2,
  deltaPct: null,
  windowDays: 30,
  byPrompt: [],
  byPlatform: [],
  byTopic: [],
  rootCause: 'Steady.',
};

const answer = (over: Partial<InsightsAnswer> = {}): InsightsAnswer => ({
  id: 'r1',
  promptId: 'p1',
  promptText: 'best coffee brand',
  platform: 'chatgpt',
  model: 'gpt-5',
  region: 'US',
  createdAt: '2026-11-20T10:00:00.000Z',
  status: 'mentioned',
  position: 2,
  excerpt: 'Acme Coffee is a solid pick.',
  sources: 3,
  ownSources: 1,
  ...over,
});

const pageOf = (answers: InsightsAnswer[], total = answers.length, page = 1) =>
  ({ answers, total, page, pageSize: 25 }) satisfies InsightsAnswersPage;

const filters = { days: { dayFrom: '2026-11-01', dayTo: '2026-11-28' }, region: 'US' };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  actions.getInsightsBreakdown.mockResolvedValue(breakdown);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function openSheet(metric: 'visibility' | 'mentions' = 'visibility') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <MetricBreakdownSheet
          brandId="b1"
          metric={metric}
          onOpenChange={() => {}}
          filters={filters}
          initialTab="answers"
        />
      </NextIntlClientProvider>,
    );
  });
}

const sheet = () => document.querySelector('[role="dialog"]') as HTMLElement;
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-slot="answer-row"]')];
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;

describe('the Answers tab', () => {
  it("opens on Answers and reads the card's window and filters", async () => {
    actions.getInsightsAnswers.mockResolvedValue(pageOf([answer()]));
    await openSheet();
    expect(sheet().querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'Answers',
    );
    expect(actions.getInsightsAnswers).toHaveBeenCalledWith('b1', 'visibility', filters, 1);
    expect(rows()).toHaveLength(1);
    const text = rows()[0].textContent ?? '';
    expect(text).toContain('best coffee brand');
    expect(text).toContain('Mentioned · #2');
    expect(text).toContain('ChatGPT');
    expect(text).toContain('3 sources (1 yours)');
    expect(text).toContain('Acme Coffee is a solid pick.');
  });

  it('shows loading, then an empty state', async () => {
    let answerWith: (p: InsightsAnswersPage) => void = () => {};
    actions.getInsightsAnswers.mockReturnValue(new Promise((r) => (answerWith = r)));
    await openSheet();
    expect(document.querySelector('[data-slot="answers-loading"]')).toBeTruthy();
    await act(async () => answerWith(pageOf([])));
    expect(document.querySelector('[data-slot="answers-loading"]')).toBeNull();
    expect(sheet().textContent).toContain('No answers in this period and these filters yet.');
  });

  it('says when the answers could not be read', async () => {
    actions.getInsightsAnswers.mockRejectedValue(new Error('boom'));
    await openSheet();
    expect(sheet().textContent).toMatch(/boom|Couldn't load the answers/);
  });

  it('never labels an answer without text as not mentioned', async () => {
    actions.getInsightsAnswers.mockResolvedValue(
      pageOf([
        answer({ id: 'empty', status: 'noAnswer', position: null, excerpt: '', sources: 0 }),
        answer({ id: 'miss', status: 'notMentioned', position: null, ownSources: 0 }),
      ]),
    );
    await openSheet();
    const [empty, miss] = rows();
    expect(empty.textContent).toContain('No answer text');
    expect(empty.textContent).not.toContain('Not mentioned');
    expect(empty.querySelector('[data-status]')?.getAttribute('data-status')).toBe('noAnswer');
    expect(miss.textContent).toContain('Not mentioned');
    expect(miss.textContent).not.toContain('yours');
  });

  it('pages through the answers 25 at a time', async () => {
    actions.getInsightsAnswers.mockResolvedValue(pageOf([answer()], 30));
    await openSheet('mentions');
    expect(sheet().textContent).toContain('1–25 of 30');
    actions.getInsightsAnswers.mockResolvedValue(pageOf([answer({ id: 'r26' })], 30, 2));
    await act(async () => button('Next').click());
    expect(actions.getInsightsAnswers).toHaveBeenLastCalledWith('b1', 'mentions', filters, 2);
    expect(sheet().textContent).toContain('26–30 of 30');
  });

  it('opens an answer in full', async () => {
    actions.getInsightsAnswers.mockResolvedValue(pageOf([answer()]));
    actions.getPromptResultById.mockResolvedValue({
      id: 'r1',
      promptText: 'best coffee brand',
      response: 'The whole answer naming Acme Coffee.',
      citations: [],
    });
    await openSheet();
    await act(async () => button('Open full answer').click());
    expect(actions.getPromptResultById).toHaveBeenCalledWith('r1');
    expect(document.querySelector('[data-slot="response-detail"]')?.textContent).toBe(
      'The whole answer naming Acme Coffee.',
    );
  });
});
