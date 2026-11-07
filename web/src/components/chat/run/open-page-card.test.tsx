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
  it('asks where: here, the editor or staying in chat, and none marked Recommended', async () => {
    await render();
    expect(container.textContent).toContain('Where should we open this page?');
    expect(action('openPage.here').textContent).toContain('Open here');
    expect(action('openPage.here').textContent).toContain(
      'Edit it next to this chat. Ask for changes in plain words.',
    );
    expect(action('openPage.editor').textContent).toContain('Open in Content Editor');
    expect(action('openPage.editor').textContent).toContain(
      'The full editor with Brief, Rules and Quality.',
    );
    expect(action('openPage.chat').textContent).toContain('Keep working in chat');
    expect(container.textContent).not.toContain('Recommended');
    // The mockup's order (#e-open): Open here 1, the Content Editor 2, then the text button.
    const order = [...container.querySelectorAll('[data-action^="openPage."]')].map((el) =>
      el.getAttribute('data-action'),
    );
    expect(order).toEqual([
      'openPage.here',
      'openPage.editor',
      'openPage.chat',
      'openPage.dontAskAgain',
    ]);
    expect(action('openPage.here').querySelector('kbd')!.textContent).toBe('1');
    expect(action('openPage.editor').querySelector('kbd')!.textContent).toBe('2');
  });

  it('gives the choice, and whether to keep it', async () => {
    await render();
    await act(async () => action('openPage.chat').click());
    expect(onChoose).toHaveBeenLastCalledWith('chat', false);
    await act(async () => action('openPage.here').click());
    expect(onChoose).toHaveBeenLastCalledWith('here', false);
    await act(async () => action('openPage.dontAskAgain').click());
    await act(async () => action('openPage.editor').click());
    expect(onChoose).toHaveBeenLastCalledWith('editor', true);
    await act(async () => action('openPage.here').click());
    expect(onChoose).toHaveBeenLastCalledWith('here', true);
  });

  it('picks Open here with key 1 and the editor with key 2, and nothing while it saves', async () => {
    await render();
    const card = container.querySelector<HTMLElement>('[data-slot="open-page-card"]')!;
    const press = (key: string) =>
      act(async () => {
        card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    await press('1');
    expect(onChoose).toHaveBeenLastCalledWith('here', false);
    await press('2');
    expect(onChoose).toHaveBeenLastCalledWith('editor', false);
    await press('3');
    expect(onChoose).toHaveBeenCalledTimes(2);
    onChoose.mockReset();
    await render(true);
    expect((action('openPage.here') as HTMLButtonElement).disabled).toBe(true);
    expect((action('openPage.editor') as HTMLButtonElement).disabled).toBe(true);
    await press('1');
    await press('2');
    expect(onChoose).not.toHaveBeenCalled();
  });
});
