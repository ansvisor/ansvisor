import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { OpenPageCard } from './open-page-card';

/** "Where should we open this page?" (CHAT-25 §3, W4-11). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const onChoose = vi.fn();

async function render(saving = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <OpenPageCard saving={saving} onChoose={onChoose} />
      </NextIntlClientProvider>,
    );
  });
}
const action = (name: string) => container.querySelector<HTMLElement>(`[data-action="${name}"]`)!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onChoose.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('OpenPageCard', () => {
  it('asks where, with the editor and staying in chat, and none marked Recommended', async () => {
    await render();
    expect(container.textContent).toContain('Where should we open this page?');
    expect(action('openPage.editor').textContent).toContain('Open in Content Editor');
    expect(action('openPage.editor').textContent).toContain(
      'The full editor with Brief, Rules and Quality.',
    );
    expect(action('openPage.chat').textContent).toContain('Keep working in chat');
    expect(container.textContent).not.toContain('Recommended');
    // Open here (the editor inside Chat) comes with W4-15.
    expect(container.textContent).not.toContain('Open here');
  });

  it('gives the choice, and whether to keep it', async () => {
    await render();
    await act(async () => action('openPage.chat').click());
    expect(onChoose).toHaveBeenLastCalledWith('chat', false);
    await act(async () => action('openPage.dontAskAgain').click());
    await act(async () => action('openPage.editor').click());
    expect(onChoose).toHaveBeenLastCalledWith('editor', true);
  });

  it('picks the editor with key 1, and nothing while it saves', async () => {
    await render();
    const card = container.querySelector<HTMLElement>('[data-slot="open-page-card"]')!;
    await act(async () => {
      card.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    });
    expect(onChoose).toHaveBeenCalledWith('editor', false);
    onChoose.mockReset();
    await render(true);
    expect((action('openPage.editor') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      card.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    });
    expect(onChoose).not.toHaveBeenCalled();
  });
});
