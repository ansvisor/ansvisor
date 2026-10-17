import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { SignalWhereLine } from './signal-table';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
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

describe('SignalWhereLine', () => {
  it('shows one icon per engine and the first locations, and names them all for screen readers', () => {
    render(
      <SignalWhereLine
        where={{
          platforms: [
            'chatgpt-web',
            'chatgpt',
            'gemini-web',
            'google-aio',
            'perplexity-web',
            'grok-web',
          ],
          regions: ['US', 'GB', 'DE'],
        }}
      />,
    );
    // The ChatGPT app and its API share one icon; four shown, one more counted.
    const icons = [...container.querySelectorAll('[aria-hidden="true"] > [title]')];
    expect(icons.map((icon) => icon.getAttribute('title'))).toEqual([
      'ChatGPT',
      'Gemini',
      'Google AI Overview',
      'Perplexity',
    ]);
    expect(container.textContent).toContain('+1');
    expect(container.textContent).toContain('US · GB +1');
    expect(container.querySelector('.sr-only')?.textContent).toBe(
      'Tracked on ChatGPT, ChatGPT API, Gemini, Google AI Overview, Perplexity, Grok · Tracked in United States, United Kingdom, Germany',
    );
  });

  it('says nothing when Affected already names the one place, or there is none', () => {
    render(
      <SignalWhereLine
        where={{ platforms: ['gemini-web'], regions: [] }}
        besides={['Gemini', null]}
      />,
    );
    expect(container.textContent).toBe('');
    render(<SignalWhereLine where={{ platforms: [], regions: [] }} />);
    expect(container.textContent).toBe('');
  });
});
