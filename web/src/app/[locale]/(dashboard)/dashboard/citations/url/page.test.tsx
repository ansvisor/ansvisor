import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import { ChatPageSetterContext } from '@/components/chat/panel/chat-panel-context';

/**
 * What Chat's side panel sees of one cited page (the owner's plan of
 * 2026-11-16, step 9): its period and filters. The panel adds its address
 * (?u=) from the URL, which the page holds open (page-view-scope.ts).
 */

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => search.params }));
const getCitationUrlDetail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/citations', () => ({ getCitationUrlDetail }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({ getActiveBrand: () => ({ id: 'b1', name: 'Acme' }) }),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/citations/filter-bar', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CitationsFilterBar: () => null,
}));
vi.mock('@/components/citations/add-competitor-button', () => ({
  AddCompetitorButton: () => null,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { default: CitationUrlDetailPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const setPage = vi.fn();

beforeEach(() => {
  setPage.mockReset();
  // Never read: the context doesn't wait for the page's data.
  getCitationUrlDetail.mockReturnValue(new Promise(() => {}));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(query: string) {
  search.params = new URLSearchParams(query);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatPageSetterContext.Provider value={setPage}>
          <CitationUrlDetailPage />
        </ChatPageSetterContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  return setPage.mock.lastCall?.[0];
}

describe("what Chat's side panel sees (the owner's plan, step 9)", () => {
  it('sends its period and its filters; the address is the URL’s', async () => {
    const page = await render(
      'u=https%3A%2F%2Facme.example%2Fpricing&preset=7d&platform=chatgpt-web&region=US',
    );
    expect(page).toEqual({
      pageName: 'Cited page',
      dateRange: { from: '7d', to: null, label: 'Last 7 days' },
      filters: [
        { key: 'platform', label: 'ChatGPT', value: 'chatgpt-web' },
        { key: 'region', label: expect.any(String), value: 'US' },
      ],
    });
  });

  it('opens on the Citations default, Last 24 hours, with no filter', async () => {
    const page = await render('u=https%3A%2F%2Facme.example%2Fpricing');
    expect(page).toEqual({
      pageName: 'Cited page',
      dateRange: { from: '24h', to: null, label: 'Last 24 hours' },
      filters: [],
    });
  });

  it('says nothing without an address', async () => {
    expect(await render('')).toBeNull();
  });
});
