import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import { FormulaDialog } from './_formula-dialog';

/** Insights' "Formulas" dialog, worded from the messages (LOC). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function openIn(words: typeof messages) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={words} timeZone="UTC">
        <FormulaDialog />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => container.querySelector('button')!.click());
  return document.querySelector('[role="dialog"]')!.textContent ?? '';
}

describe('FormulaDialog', () => {
  it('shows the weights in the formula and bolds each part', async () => {
    const text = await openIn(messages);
    expect(text).toContain('How metrics are calculated');
    expect(text).toMatch(/Visibility = 100 × \(0\.\d+ × mention rate/);
    expect(document.querySelector('[role="dialog"] li span.font-medium')?.textContent).toMatch(
      /^Mention rate \(\d+%\)$/,
    );
  });

  it('words every section from the messages', async () => {
    const formulas = messages.insights.formulas;
    const text = await openIn({
      ...messages,
      insights: {
        ...messages.insights,
        formulas: {
          ...formulas,
          title: 'Metrikler nasıl hesaplanır',
          coverage: { ...formulas.coverage, title: 'Kapsam' },
        },
      },
    });
    expect(text).toContain('Metrikler nasıl hesaplanır');
    expect(text).toContain('Kapsam');
    expect(text).not.toContain('How metrics are calculated');
  });
});
