import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRubricText } from './use-rubric-text';

/** Site Audit's rubric copy in the reader's language (LOC). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const MESSAGES = {
  auditRubric: {
    categories: { structure: { label: 'Yapı', description: '…' } },
    signals: {
      'list-usage': { label: 'Liste kullanımı', what: 'En az 3 öğeli bir <ul> ya da <ol>.' },
    },
  },
};

let container: HTMLDivElement;
let root: Root;

function Words() {
  const rubric = useRubricText();
  return (
    <ul>
      <li>{rubric.category('structure', 'Structure')}</li>
      <li>{rubric.signal('list-usage', 'label', 'List usage')}</li>
      <li>{rubric.signal('list-usage', 'what', 'English what')}</li>
      <li>{rubric.signal('list-usage', 'why', 'English why')}</li>
      <li>{rubric.signal('new-signal', 'label', 'New signal')}</li>
      <li>{rubric.category('new-category', 'New category')}</li>
    </ul>
  );
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useRubricText', () => {
  it('reads the messages’ words, tags as written, and the server’s English for the rest', () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="tr" messages={MESSAGES} timeZone="UTC">
          <Words />
        </NextIntlClientProvider>,
      );
    });
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Yapı',
      'Liste kullanımı',
      'En az 3 öğeli bir <ul> ya da <ol>.',
      'English why',
      'New signal',
      'New category',
    ]);
  });
});
