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

  it('opened from a card, marks and scrolls to that section with its sample', async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('data-formula-section') ?? '');
    };
    try {
      await act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <FormulaDialog
              open
              onOpenChange={() => {}}
              section="position"
              samples={{ position: { count: 12, of: 'placed' } }}
            />
          </NextIntlClientProvider>,
        );
      });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
    // Controlled: no header button of its own.
    expect(container.querySelector('button')).toBeNull();
    const active = document.querySelectorAll('[role="dialog"] [data-active]');
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute('data-formula-section')).toBe('position');
    expect(active[0].getAttribute('aria-current')).toBe('true');
    expect(scrolled).toEqual(['position']);
    const sample = document.querySelectorAll('[data-slot="formula-sample"]');
    expect(sample).toHaveLength(1);
    expect(sample[0].textContent).toBe('Based on 12 answers that place you in this period.');
    expect(sample[0].closest('[data-formula-section]')?.getAttribute('data-formula-section')).toBe(
      'position',
    );
  });

  it('from the header button, marks no section', async () => {
    await openIn(messages);
    expect(document.querySelector('[role="dialog"] [data-active]')).toBeNull();
    expect(document.querySelector('[data-slot="formula-sample"]')).toBeNull();
  });
});
