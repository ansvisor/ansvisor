import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';

/** The staff's review list of suggested translations: Accept and Reject. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const review = vi.hoisted(() => ({ reviewTranslationSuggestion: vi.fn() }));
vi.mock('@/lib/actions/translation-suggestions-review', () => review);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { TranslationSuggestionsAdmin } = await import('./_translation-suggestions-admin');

let container: HTMLDivElement;
let root: Root;

const row = {
  id: 's1',
  locale: 'de',
  path: '/dashboard/prompts',
  message_key: 'prompts.title',
  current_text: 'Neue Eingabe',
  suggestion: 'Neuer Prompt',
  note: 'klingt besser',
  created_at: '2026-11-19T10:00:00Z',
};

function draw(rows: (typeof row)[]) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TranslationSuggestionsAdmin rows={rows} />
      </NextIntlClientProvider>,
    ),
  );
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  review.reviewTranslationSuggestion.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('TranslationSuggestionsAdmin', () => {
  it('lists the suggestion with its language, screen, texts, key and note', () => {
    draw([row]);
    const text = container.textContent ?? '';
    for (const part of [
      'Deutsch',
      '/dashboard/prompts',
      'Neue Eingabe',
      'Neuer Prompt',
      'klingt besser',
      'Key: prompts.title',
    ]) {
      expect(text).toContain(part);
    }
  });

  it('says so when nothing is new', () => {
    draw([]);
    expect(container.textContent).toContain('No new suggestions.');
  });

  it('accepts, and the row leaves the list', async () => {
    draw([row]);
    await act(async () => button('Accept').click());
    expect(review.reviewTranslationSuggestion).toHaveBeenCalledWith('s1', 'accepted');
    expect(toast.success).toHaveBeenCalled();
    expect(container.textContent).toContain('No new suggestions.');
  });

  it('rejects', async () => {
    draw([row]);
    await act(async () => button('Reject').click());
    expect(review.reviewTranslationSuggestion).toHaveBeenCalledWith('s1', 'rejected');
  });
});
