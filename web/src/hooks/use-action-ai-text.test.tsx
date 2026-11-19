import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** An action's written text in the reader's language (LOC-010). */

const read = vi.hoisted(() => vi.fn());
vi.mock('@/lib/i18n/ai-text-client', () => ({
  AI_TEXT_MAX_ROWS: 50,
  readAiTextTranslations: (...args: unknown[]) => read(...args),
}));

const { forgetAiTextTranslations } = await import('./use-ai-text');
const { useActionAiText } = await import('./use-action-ai-text');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Row = { id: string; kind: string; payload: Record<string, unknown> };

const ACTIONS: Row[] = [
  { id: 'a', kind: 'chat_finding', payload: { title: 'Win pricing', why: 'Rivals lead', n: 3 } },
  { id: 'b', kind: 'content_opportunity', payload: { title: 'Compare trackers', why: 'x' } },
  { id: 'c', kind: 'visibility_drop', payload: { title: 'Not written' } },
];

let container: HTMLDivElement;
let root: Root;

function Rows({ actions }: { actions: Row[] }) {
  const shown = useActionAiText(actions);
  return (
    <ul>
      {actions.map((action) => {
        const payload = shown(action).payload;
        return <li key={action.id}>{[payload.title, payload.why].join(' | ')}</li>;
      })}
    </ul>
  );
}

async function render(locale: string) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={{}} timeZone="UTC">
        <Rows actions={ACTIONS} />
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
});

describe('useActionAiText', () => {
  it('asks for the kinds with written text, and shows their fields translated', async () => {
    read.mockResolvedValue({
      a: { title: 'Fiyatı kazanın', why: 'Rakipler önde' },
      // A field its kind doesn't write stays as it is, whatever comes back.
      b: { title: 'Takipçileri karşılaştırın', why: 'çeviri' },
    });
    await render('tr');
    expect(read).toHaveBeenCalledWith('action', ['a', 'b'], 'tr');
    expect(lines()).toEqual([
      'Fiyatı kazanın | Rakipler önde',
      'Takipçileri karşılaştırın | x',
      'Not written | ',
    ]);
  });

  it('keeps the English in English', async () => {
    await render('en');
    expect(read).not.toHaveBeenCalled();
    expect(lines()[0]).toBe('Win pricing | Rivals lead');
  });
});
