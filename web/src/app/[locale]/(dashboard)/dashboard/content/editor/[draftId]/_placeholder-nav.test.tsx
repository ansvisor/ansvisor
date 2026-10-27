import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { PlaceholderMarks } from './_placeholder-marks';
import { PlaceholderNav } from './_placeholder-nav';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let editor: Editor;

async function render(content: string, hidden = 0, onShowHidden = vi.fn()) {
  editor = new Editor({ extensions: [StarterKit, PlaceholderMarks], content });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlaceholderNav editor={editor} hidden={hidden} onShowHidden={onShowHidden} />
      </NextIntlClientProvider>,
    );
  });
  return onShowHidden;
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent === label,
  )!;
const selected = () => {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to);
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  editor.destroy();
  container.remove();
});

/** The toolbar's placeholders (CE-044): how many are left, and the way through them. */
describe('PlaceholderNav', () => {
  it('counts the placeholders left and steps through them, round from the last', async () => {
    await render(
      '<p>Rivals like [competitor] lead.</p><h2>FAQ</h2><p>See [notes] and [notes].</p>',
    );
    expect(container.textContent).toContain('3 placeholders to fill');

    await act(async () => button('Next placeholder').click());
    expect(selected()).toBe('[competitor]');
    expect(container.textContent).toContain('Placeholder 1 of 3');

    await act(async () => button('Next placeholder').click());
    await act(async () => button('Next placeholder').click());
    expect(container.textContent).toContain('Placeholder 3 of 3');
    await act(async () => button('Next placeholder').click());
    expect(container.textContent).toContain('Placeholder 1 of 3');

    await act(async () => button('Previous placeholder').click());
    expect(container.textContent).toContain('Placeholder 3 of 3');
  });

  it('goes on to the next one once one is filled, and leaves once none is left', async () => {
    await render('<p>Rivals like [competitor] and [partner] lead.</p>');
    await act(async () => button('Next placeholder').click());
    await act(async () => {
      editor.commands.insertContent('Acme');
    });
    expect(container.textContent).toContain('1 placeholder to fill');
    await act(async () => button('1 placeholder to fill').click());
    expect(selected()).toBe('[partner]');
    await act(async () => {
      editor.commands.insertContent('Beta');
    });
    expect(container.textContent).toBe('');
  });

  it('counts the ones the page doesn’t show, and shows them in HTML once the rest are filled', async () => {
    const onShowHidden = await render('<p>Rivals like [competitor] lead.</p>', 1);
    expect(container.textContent).toContain('2 placeholders to fill');
    await act(async () => button('Next placeholder').click());
    await act(async () => {
      editor.commands.insertContent('Acme');
    });
    expect(container.textContent).toContain('1 placeholder to fill');
    await act(async () => button('Show in HTML').click());
    expect(onShowHidden).toHaveBeenCalledOnce();
  });

  it('shows nothing for a page without one', async () => {
    await render('<p>Nothing to fill.</p>');
    expect(container.textContent).toBe('');
  });
});
