import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { PromptResultWithText } from '@/lib/actions/tracking';

/**
 * An AI answer's own page (step 9's detail pages): what Chat's side panel
 * sees of it, from the answer the page already read.
 */

const ID = '0b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d';
vi.mock('next/navigation', () => ({ useParams: () => ({ id: ID }) }));
const getPromptResultById = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/tracking', () => ({ getPromptResultById }));
vi.mock('@/components/results/response-detail', () => ({ ResponseDetail: () => null }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const { chatPage } = vi.hoisted(() => ({ chatPage: vi.fn() }));
vi.mock('@/components/chat/panel/chat-panel-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatPageContext: chatPage,
}));

const { default: ResultDetailPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const answer = {
  id: ID,
  promptId: 'p1',
  brandId: 'b1',
  platform: 'chatgpt-web',
  response: 'Northwind is a good pick.',
  citations: [],
  mentionCount: 1,
  citationCount: 0,
  sentiment: 'positive',
  visibilityScore: 70,
  region: 'US',
  createdAt: '2026-10-17T09:00:00.000Z',
  promptText: 'Best coffee subscriptions',
} as unknown as PromptResultWithText;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  chatPage.mockClear();
  getPromptResultById.mockReset().mockResolvedValue(answer);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ResultDetailPage />
      </NextIntlClientProvider>,
    );
  });
}

describe("what Chat's side panel sees (the owner's plan, step 9's detail pages)", () => {
  it('holds the AI answer open by its id, named by its prompt and platform', async () => {
    await render();
    expect(container.textContent).toContain('Best coffee subscriptions');
    expect(chatPage.mock.lastCall![0]).toEqual({
      pageName: 'AI answer',
      view: { open: { ref: ID, label: 'Best coffee subscriptions (ChatGPT)' } },
    });
  });

  it('says nothing while it reads', async () => {
    getPromptResultById.mockReturnValue(new Promise(() => {}));
    await render();
    expect(chatPage.mock.lastCall![0]).toBeNull();
  });

  it('says nothing for an answer it can’t find', async () => {
    getPromptResultById.mockResolvedValue(null);
    await render();
    expect(chatPage.mock.lastCall![0]).toBeNull();
  });
});
