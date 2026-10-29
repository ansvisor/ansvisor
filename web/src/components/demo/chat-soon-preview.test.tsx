import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { ChatSoonPreview, isPreviewShortcut } from './chat-soon-preview';

/**
 * The demo's Chat preview: its shortcuts work while the app around the frame
 * has the focus, handed to the frame; the app's other keys stay the app's.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatSoonPreview />
      </NextIntlClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The keys the frame's document receives. */
function frameKeys() {
  const keys: string[] = [];
  const doc = container.querySelector('iframe')!.contentDocument!;
  doc.addEventListener('keydown', (e) =>
    keys.push(
      `${e.metaKey ? 'Meta+' : ''}${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.key}`,
    ),
  );
  return keys;
}

describe('ChatSoonPreview', () => {
  it("hands the preview's shortcuts to the frame", () => {
    const keys = frameKeys();
    const press = (init: KeyboardEventInit) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(press({ key: 'O', metaKey: true, shiftKey: true })).toBe(true);
    expect(press({ key: 'k', ctrlKey: true })).toBe(true);
    expect(press({ key: 'a', metaKey: true })).toBe(false);
    expect(keys).toEqual(['Meta+Shift+O', 'Ctrl+k']);
  });

  it('knows its shortcuts', () => {
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
      isPreviewShortcut({
        key: k,
        code: '',
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        ...mods,
      });
    expect(key('o', { shiftKey: true })).toBe(true);
    expect(key('k')).toBe(true);
    expect(key('j')).toBe(true);
    expect(key('\\')).toBe(true);
    expect(key('o')).toBe(false);
    expect(key('k', { metaKey: false })).toBe(false);
  });
});
