import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';

/**
 * What Chat's side panel sees of the Mentions tab (the owner's plan of
 * 2026-11-16, item 8): the open tab and the search, and on the Mentions
 * tab its table's sort, the answers on screen and how many match (the
 * table's own part is _mentions-tab.test.tsx's).
 */

vi.mock('@/components/brand-visibility/shell-context', () => ({
  TabHeaderActions: () => null,
  useBrandRead: () => undefined,
}));
vi.mock('@/lib/visibility-reads', () => ({
  getBrandFilterOptions: vi.fn(),
  getCompetitors: vi.fn(),
  getTopics: vi.fn(),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (pick: (state: unknown) => unknown) =>
    pick({ activeBrandId: 'b1', brands: [{ id: 'b1', name: 'Acme', slug: 'acme', domains: [] }] }),
}));
vi.mock('./_filter-bar', () => ({ MentionsFilterBar: () => null }));
vi.mock('./_header-actions', () => ({ MentionsHeaderActions: () => null }));
vi.mock('./_overview', () => ({ MentionsOverviewTab: () => null }));
vi.mock('./_perception', () => ({ MentionsPerceptionTab: () => null }));
vi.mock('./_use-mentions-export', () => ({ useMentionsExport: () => ({}) }));
const TABLE = {
  sort: { key: 'co_mentions', dir: 'desc' },
  rows: [{ ref: 'r1', label: 'Best espresso beans? · Gemini' }],
  total: 31,
};
vi.mock('./_mentions-tab', () => ({
  MentionsListTab: ({ onChatView }: { onChatView?: (view: object | null) => void }) => {
    useEffect(() => {
      onChatView?.(TABLE);
      return () => onChatView?.(null);
    }, [onChatView]);
    return null;
  },
}));

const { default: MentionsPage } = await import('./page');
const { ChatPageSetterContext } = await import('@/components/chat/panel/chat-panel-context');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render(url: string, setPage: (page: unknown) => void) {
  window.history.replaceState(null, '', url);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatPageSetterContext.Provider value={setPage}>
          <MentionsPage />
        </ChatPageSetterContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

describe("what Chat's side panel sees of Mentions", () => {
  it("tells the open tab, the search, and on Mentions its table's sort and answers on screen", async () => {
    const setPage = vi.fn();
    await render('/dashboard/mentions?tab=mentions&q=%20espresso%20', setPage);
    expect(setPage.mock.lastCall![0].view).toEqual({
      tab: 'mentions',
      search: 'espresso',
      ...TABLE,
    });
  });

  it('tells only the tab and the search on another tab', async () => {
    const setPage = vi.fn();
    await render('/dashboard/mentions?tab=perception&q=espresso', setPage);
    expect(setPage.mock.lastCall![0].view).toEqual({ tab: 'perception', search: 'espresso' });
    // The URL is read once, after mount: a new page.
    act(() => root.unmount());
    root = createRoot(container);
    await render('/dashboard/mentions', setPage);
    expect(setPage.mock.lastCall![0].view).toEqual({ tab: 'overview' });
  });
});
