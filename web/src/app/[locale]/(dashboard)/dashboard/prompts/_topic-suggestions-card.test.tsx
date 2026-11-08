import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { TopicSuggestionsCard } from './_topic-suggestions-card';

/**
 * Topic Suggestions by role: generating ideas costs AI, so Generate and
 * Refresh are an admin's or a manager's (2026-10-29); anyone else reads the
 * ideas and who can generate them.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const actions = vi.hoisted(() => ({
  getTopicSuggestions: vi.fn(),
  refreshTopicSuggestions: vi.fn(),
  acceptTopicSuggestion: vi.fn(),
  dismissTopicSuggestion: vi.fn(),
}));
vi.mock('@/lib/actions/topic-suggestions', () => actions);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  // The card remembers being open; each test starts it collapsed.
  try {
    localStorage.clear();
  } catch {
    // No storage: the card starts collapsed anyway.
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  canManage: boolean,
  ideas: { id: string; name: string; source?: string; sourceData?: unknown }[] = [],
) {
  actions.getTopicSuggestions.mockResolvedValue({
    ok: true,
    suggestions: ideas.map((idea) => ({
      source: 'llm',
      sourceData: null,
      ...idea,
      brand_id: 'b1',
      status: 'new',
      reason: null,
    })),
  });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <TopicSuggestionsCard brandId="b1" canManage={canManage} />
      </NextIntlClientProvider>,
    );
  });
  // Collapsed at first: opening it reads the ideas.
  await act(async () => container.querySelector<HTMLElement>('[aria-expanded]')!.click());
  await act(async () => {});
}

const labels = () => [...container.querySelectorAll('button')].map((b) => b.textContent);

describe('TopicSuggestionsCard by role', () => {
  it('offers an admin or a manager Generate Suggestions and Refresh', async () => {
    await render(true);
    expect(labels()).toContain('Generate Suggestions');
    expect(labels()).toContain('Refresh');
    expect(container.textContent).not.toContain('Ask an admin or a manager');
  });

  it('tells an analyst or an agency partner who generates them, with no way to start it', async () => {
    await render(false);
    expect(labels()).not.toContain('Generate Suggestions');
    expect(labels()).not.toContain('Refresh');
    expect(container.textContent).toContain(
      'Ask an admin or a manager to generate topic suggestions.',
    );
    expect(actions.refreshTopicSuggestions).not.toHaveBeenCalled();
  });

  it('shows an analyst the ideas, without accepting or dismissing them', async () => {
    await render(false, [{ id: 't1', name: 'Office coffee' }]);
    expect(container.textContent).toContain('Office coffee');
    expect(container.querySelectorAll('li button')).toHaveLength(0);
  });
});

describe('TopicSuggestionsCard — categories from the catalog (AC plan P-8)', () => {
  it('marks a category no topic covers as Your catalog, with its products in stock', async () => {
    await render(true, [
      {
        id: 't1',
        name: 'Tents',
        source: 'catalog',
        sourceData: { category: 'Camping > Tents', categoryId: 'c-tents', products: 9, inStock: 7 },
      },
      { id: 't2', name: 'Office coffee' },
    ]);
    const [catalog, idea] = [...container.querySelectorAll('li')];
    expect(catalog.textContent).toContain('Tents');
    expect(catalog.textContent).toContain('Your catalog');
    expect(catalog.textContent).toContain(
      "From your catalog's “Camping > Tents” category: 7 products in stock, and no topic covers it yet.",
    );
    expect(idea.textContent).not.toContain('Your catalog');
    // Added and dismissed as any idea.
    expect(catalog.querySelectorAll('button')).toHaveLength(2);
  });
});
