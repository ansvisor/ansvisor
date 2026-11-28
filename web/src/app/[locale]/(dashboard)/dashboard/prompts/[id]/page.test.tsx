import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import trMessages from '../../../../../../../messages/tr.json';
import { mergeMessages, type Messages } from '@/i18n/messages';
import type { PromptDetailData } from '@/lib/actions/tracking';

/**
 * A prompt's page (step 9's detail pages): what Chat's side panel sees of
 * it, from what the page already read.
 */

const PROMPT = '0b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d';
vi.mock('next/navigation', () => ({ useParams: () => ({ id: PROMPT }) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/components/citations/filter-bar', () => ({ buildCitationDetailHref: () => '#' }));
const getPromptDetail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/tracking', () => ({ getPromptDetail }));
vi.mock('@/lib/actions/prompt-volume', () => ({ getPromptVolume: vi.fn(async () => null) }));
vi.mock('@/lib/actions/prompt-demand-signals', () => ({
  getPromptDemandSignals: vi.fn(async () => ({ unavailable: true })),
}));
vi.mock('@/lib/actions/integrations', () => ({
  getSuggestionSourceStates: vi.fn(async () => ({ gsc: null })),
}));
vi.mock('@/lib/traffic-sources', () => ({ googleSourceStatus: () => null }));
vi.mock('@/components/prompts/demand-card', () => ({
  DemandLevelValue: () => null,
  DemandSection: () => null,
}));
const getOpportunities = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/content', () => ({ getOpportunities }));
vi.mock('@/lib/actions/prompt-workflow', () => ({
  getPromptWorkflow: vi.fn(async () => ({ workStatus: null, notes: [], targetUrls: [] })),
  setPromptWorkStatus: vi.fn(),
}));
vi.mock('./_workflow-cards', () => ({
  NotesCard: () => null,
  TargetUrlsCard: () => null,
  ContentOpportunitiesCard: () => null,
  OPPORTUNITY_PREVIEW_LIMIT: 5,
}));
vi.mock('@/components/prompts/work-status', () => ({ WorkStatusBadge: () => null }));
vi.mock('@/components/results/response-detail', () => ({ ResponseDetail: () => null }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => ({ canManage: true }) }));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const { chatPage } = vi.hoisted(() => ({ chatPage: vi.fn() }));
vi.mock('@/components/chat/panel/chat-panel-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatPageContext: chatPage,
}));

const { default: PromptDetailPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const source = (domain: string) => ({
  domain,
  category: 'editorial',
  models: ['chatgpt-web'],
  totalCitations: 3,
  resultsCiting: 2,
  usagePct: 40,
});

const detail = {
  prompt: {
    id: PROMPT,
    brandId: 'b1',
    text: 'Best coffee subscriptions in 2026',
    topicName: 'Coffee subscriptions',
    isActive: true,
    createdAt: '2026-09-01T00:00:00Z',
  },
  summary: {
    avgVisibilityScore: 40,
    visibilityRate: 50,
    visibleResults: 2,
    score: 52,
    mentionAnswers: 2,
    citationAnswers: 1,
    positionFactor: null,
    totalMentions: 3,
    totalCitations: 1,
    totalResults: 4,
    lastCheckedAt: null,
  },
  results: [],
  // Twelve sources: the Domains table's first page shows ten.
  topSources: Array.from({ length: 12 }, (_, i) => source(`source${i + 1}.example`)),
  topSourceUrls: [],
} as unknown as PromptDetailData;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  chatPage.mockClear();
  getPromptDetail.mockReset().mockResolvedValue(detail);
  getOpportunities.mockReset().mockResolvedValue({
    opportunities: [{ id: 'o1', title: 'Compare coffee subscriptions' }],
    total: 1,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(locale: 'en' | 'tr' = 'en') {
  const localeMessages =
    locale === 'en' ? messages : mergeMessages(messages as unknown as Messages, trMessages);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={localeMessages} timeZone="UTC">
        <PromptDetailPage />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;

describe('the AI answers', () => {
  it('scrolls to them when the page is opened on #ai-answers', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.history.replaceState(null, '', `/dashboard/prompts/${PROMPT}#ai-answers`);
    try {
      await render();
      const answers = container.querySelector('#ai-answers');
      expect(answers?.textContent).toContain('Platform Results');
      expect(scrollIntoView).toHaveBeenCalled();
      expect(scrollIntoView.mock.contexts[0]).toBe(answers);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('stays at the top without the hash', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.history.replaceState(null, '', `/dashboard/prompts/${PROMPT}`);
    await render();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("what Chat's side panel sees (the owner's plan, step 9's detail pages)", () => {
  it('holds the prompt open by its id, its date range, its first Top Sources and its opportunities', async () => {
    await render();
    expect(chatPage.mock.lastCall![0]).toEqual({
      pageName: 'Prompt',
      dateRange: { from: '30d', to: null, label: 'Last 30 days' },
      view: {
        open: { ref: PROMPT, label: 'Best coffee subscriptions in 2026' },
        rows: [
          ...Array.from({ length: 10 }, (_, i) => ({
            ref: `source${i + 1}.example`,
            label: `Top sources: source${i + 1}.example`,
          })),
          { ref: 'o1', label: 'Content opportunity: Compare coffee subscriptions' },
        ],
      },
    });
  });

  it("follows the page's date range", async () => {
    await render();
    await act(async () => button('7d').click());
    await act(async () => {});
    expect(chatPage.mock.lastCall![0].dateRange).toEqual({
      from: '7d',
      to: null,
      label: 'Last 7 days',
    });
    await act(async () => button('All').click());
    await act(async () => {});
    expect(chatPage.mock.lastCall![0].dateRange).toEqual({
      from: 'all',
      to: null,
      label: 'All time',
    });
  });

  it('sends no opportunities while they read', async () => {
    getOpportunities.mockReturnValue(new Promise(() => {}));
    await render();
    expect(chatPage.mock.lastCall![0].view.rows).toHaveLength(10);
  });

  it('says nothing while the prompt reads', async () => {
    getPromptDetail.mockReturnValue(new Promise(() => {}));
    await render();
    expect(chatPage.mock.lastCall![0]).toBeNull();
  });
});

describe("the page's copy", () => {
  it('reads from the messages, in English', async () => {
    await render();
    const text = container.textContent;
    expect(text).toContain('Platform Results');
    expect(text).toContain('4 results grouped by platform and model.');
    expect(text).toContain('Visibility — mentioned in 2 of 4 answers, cited in 1');
    expect(text).toContain('Active');
    expect(text).toContain('Domains (12)');
  });

  it('follows the language: Turkish', async () => {
    await render('tr');
    const text = container.textContent;
    expect(text).toContain('Platform Sonuçları');
    expect(text).toContain('En İyi Kaynaklar');
    expect(text).toContain('Aktif');
    expect(text).not.toContain('Platform Results');
  });
});
