import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** AI-written text in the reader's language (LOC-010): the rows on screen, asked once. */

const read = vi.hoisted(() => vi.fn());
vi.mock('@/lib/i18n/ai-text-client', () => ({
  AI_TEXT_MAX_ROWS: 2,
  readAiTextTranslations: (...args: unknown[]) => read(...args),
}));

const { forgetAiTextTranslations, translatesAiText, useAiText } = await import('./use-ai-text');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function Rows({ ids }: { ids: string[] }) {
  const text = useAiText('opportunity', ids);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id}>{text(id, 'title', `English ${id}`)}</li>
      ))}
    </ul>
  );
}

async function render(locale: string, ids: string[]) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={{}} timeZone="UTC">
        <Rows ids={ids} />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const lines = () => [...container.querySelectorAll('li')].map((li) => li.textContent);

beforeEach(() => {
  forgetAiTextTranslations();
  read.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('useAiText', () => {
  it('shows the English, then the translation once it lands, asking for the rows on screen in chunks', async () => {
    read.mockImplementation(async (_kind: string, ids: string[]) =>
      Object.fromEntries(
        ids.filter((id) => id !== 'c').map((id) => [id, { title: `Türkçe ${id}` }]),
      ),
    );
    await render('tr', ['a', 'b', 'c']);
    // Two requests of at most AI_TEXT_MAX_ROWS (2 here), in the person's language.
    expect(read).toHaveBeenCalledWith('opportunity', ['a', 'b'], 'tr');
    expect(read).toHaveBeenCalledWith('opportunity', ['c'], 'tr');
    // A row the API couldn't translate stays in English.
    expect(lines()).toEqual(['Türkçe a', 'Türkçe b', 'English c']);
    // Shown again: read from this tab, never asked twice.
    await render('tr', ['a', 'b', 'c']);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('asks for nothing in English or staff’s pseudo-locale', async () => {
    await render('en', ['a']);
    expect(lines()).toEqual(['English a']);
    expect(read).not.toHaveBeenCalled();
    expect(translatesAiText('en-XA')).toBe(false);
    expect(translatesAiText('de')).toBe(true);
  });

  it('keeps the English when the read fails, and doesn’t ask again this load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    read.mockRejectedValue(new Error('down'));
    await render('de', ['a']);
    expect(lines()).toEqual(['English a']);
    await render('de', ['a']);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
