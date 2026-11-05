import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { applyChatEvent, emptyRun } from '@/lib/chat/run-state';
import { chatEvent } from '@/lib/chat/events';
import { RememberThis } from './remember-this';

/**
 * "Remember this?" under the latest answer (CHAT-14 item 9, W4-33): the
 * run keeps the line its event offered; the line shows it, and a click
 * sends "Remember this: …" as the next message, which opens the Remember
 * card. Nothing shows without a line.
 */

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
});

async function render(text: string | null, onPick = vi.fn(), disabled = false) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RememberThis text={text} onPick={onPick} disabled={disabled} />
      </NextIntlClientProvider>,
    ),
  );
  return onPick;
}

describe('RememberThis', () => {
  it('keeps the offered line on the run, from its event', () => {
    const run = applyChatEvent(
      emptyRun(),
      chatEvent('remember.offered', 4, { text: 'Blog posts use US English' }),
    );
    expect(run.remember).toBe('Blog posts use US English');
    expect(emptyRun().remember).toBeNull();
  });

  it('shows the line and sends "Remember this: …" on a click', async () => {
    const onPick = await render('Blog posts use US English');
    expect(container.textContent).toBe('Remember this?“Blog posts use US English”');
    await act(async () =>
      container.querySelector<HTMLElement>('[data-action="rememberThis.open"]')!.click(),
    );
    expect(onPick).toHaveBeenCalledWith('Remember this: Blog posts use US English');
  });

  it('shows nothing without a line, and its button is off at the AI limit', async () => {
    await render(null);
    expect(container.innerHTML).toBe('');
    await render('Blog posts use US English', vi.fn(), true);
    expect(
      (container.querySelector('[data-action="rememberThis.open"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
