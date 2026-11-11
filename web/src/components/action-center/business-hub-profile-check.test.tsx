import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { ChatAgenticProvider } from '@/components/providers/chat-agentic-provider';
import { BusinessHubContext } from './business-hub-context';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The setup action's Check what ChatGPT says (Business Hub plan, PR 7):
 * Chat with the ChatGPT profile check in its box, with the new Chat on.
 */

let container: HTMLDivElement;
let root: Root;

async function render(chatOn: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatAgenticProvider enabled={chatOn}>
          <BusinessHubContext payload={{ variant: 'open', region: 'US' }} />
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
}

const check = () =>
  [...container.querySelectorAll('a')].find((a) => a.textContent === 'Check what ChatGPT says');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Check what ChatGPT says', () => {
  it('opens Chat with the ChatGPT profile check in its box, in the same tab', async () => {
    await render(true);
    const href = new URL(check()!.getAttribute('href')!, 'https://app.example');
    expect(href.pathname).toBe('/dashboard/chat');
    expect(href.searchParams.get('compose')).toBe(
      '/chatgpt-profile Check what ChatGPT says about our business, and prepare our Business Hub corrections and site fixes.',
    );
    expect(check()!.getAttribute('target')).toBeNull();
    // Beside Business Hub itself.
    expect(container.textContent).toContain('Open Business Hub');
  });

  it('is not there while the new Chat is off for the workspace', async () => {
    await render(false);
    expect(check()).toBeUndefined();
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });
});
