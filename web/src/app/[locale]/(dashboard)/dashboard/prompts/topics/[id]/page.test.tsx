import { act, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';

/**
 * A topic's page (step 9's detail pages): what Chat's side panel sees of it,
 * from what the page already read.
 */

const TOPIC = '0b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d';
const getTopicDetail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/tracking', () => ({ getTopicDetail }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (s: { activeBrandId: string }) => unknown) =>
    select({ activeBrandId: 'b1' }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('../../../(brand-visibility)/insights/_charts', () => ({
  ShareOfVoicePlatformChart: () => null,
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const { chatPage } = vi.hoisted(() => ({ chatPage: vi.fn() }));
vi.mock('@/components/chat/panel/chat-panel-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatPageContext: chatPage,
}));

const { default: TopicDetailPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Seven prompts' latest runs: the page ranks its 5 best and 5 weakest, 3 of them in both. */
const runs = [
  ['p1', 'Best coffee subscriptions', [80, 90]],
  ['p2', 'Coffee subscription for the office', [70]],
  ['p3', 'Pause a coffee subscription', [60]],
  ['p4', 'Cheapest coffee subscription', [50]],
  ['p5', 'Coffee subscription gift', [40]],
  ['p6', 'Is a coffee subscription worth it', [30]],
  ['p7', 'Decaf coffee subscription', [20, 10]],
] as const;
const detail = {
  topic: { id: TOPIC, brandId: 'b1', name: 'Coffee subscriptions', isActive: true, createdAt: '' },
  summary: null,
  trend: [],
  sov: null,
  competitors: null,
  results: runs.flatMap(([promptId, promptText, scores]) =>
    scores.map((visibilityScore) => ({ promptId, promptText, visibilityScore })),
  ),
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  chatPage.mockClear();
  getTopicDetail.mockReset().mockResolvedValue(detail);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  const params = Promise.resolve({ id: TOPIC });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Suspense fallback={null}>
          <TopicDetailPage params={params} />
        </Suspense>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

describe("what Chat's side panel sees (the owner's plan, step 9's detail pages)", () => {
  it('holds the topic open by its id, over all time, and the prompts it ranks, each once, best first', async () => {
    await render();
    expect(getTopicDetail).toHaveBeenCalledWith('b1', TOPIC);
    expect(container.textContent).toContain('Needs improvement');
    expect(chatPage.mock.lastCall![0]).toEqual({
      pageName: 'Coffee subscriptions',
      dateRange: { from: 'all', to: null, label: 'All time' },
      view: {
        open: { ref: TOPIC, label: 'Coffee subscriptions' },
        rows: runs.map(([ref, label]) => ({ ref, label })),
      },
    });
  });

  it('says nothing while it reads', async () => {
    getTopicDetail.mockReturnValue(new Promise(() => {}));
    await render();
    expect(chatPage.mock.lastCall![0]).toBeNull();
  });

  it('says nothing for a topic it couldn’t read', async () => {
    getTopicDetail.mockRejectedValue(new Error('Topic not found'));
    await render();
    expect(chatPage.mock.lastCall![0]).toBeNull();
  });
});
