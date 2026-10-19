import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/** The tracking snippet's dialog (AT-001): the whole tag, wrapped in its box, and a copy button. */

vi.mock('@/config/api', () => ({ getPublicApiBaseUrl: () => 'https://api.example.com' }));

const { SnippetDialog } = await import('./_snippet-code');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const writeText = vi.fn();

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  writeText.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('SnippetDialog', () => {
  it('shows the whole tag, wrapping in its box rather than widening the dialog, and copies it', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <SnippetDialog trackingCode="t_abc123" open onOpenChange={() => {}} />
        </NextIntlClientProvider>,
      );
    });
    const tag = '<script src="https://api.example.com/t.js" data-t="t_abc123" defer></script>';
    const pre = document.body.querySelector('pre')!;
    expect(pre.textContent).toBe(tag);
    // jsdom has no layout: what keeps it inside the dialog is the wrap and a
    // block that may shrink below the tag's width (a grid item otherwise can't).
    expect(pre.className).toContain('whitespace-pre-wrap');
    expect(pre.closest('.min-w-0')?.parentElement?.className).toContain('min-w-0');

    const copy = document.body.querySelector(
      'button[aria-label="Copy tracking script"]',
    ) as HTMLElement;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith(tag);
  });
});
