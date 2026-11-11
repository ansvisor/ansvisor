import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { ChatAgenticProvider } from '@/components/providers/chat-agentic-provider';
import { BUSINESS_HUB_URL } from '@/lib/business-hub/links';
import { BusinessHubContext } from './business-hub-context';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(payload: Record<string, unknown>, chatOn = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatAgenticProvider enabled={chatOn}>
          <BusinessHubContext payload={payload} />
        </ChatAgenticProvider>
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

describe('BusinessHubContext', () => {
  it('opens Business Hub in a new tab, and says each task is marked done by hand', async () => {
    await render({ variant: 'open', region: 'US' });
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(BUSINESS_HUB_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('Open Business Hub');
    expect(container.textContent).toContain(
      "There's no Business Hub API: mark each task done when its Done when is true.",
    );
    expect(container.textContent).not.toContain('Business Agents are for US businesses only.');
  });

  it('opens Chat with the ChatGPT profile check in its box, with the new Chat on (PR 7)', async () => {
    await render({ variant: 'open', region: 'US' }, true);
    const check = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Check what ChatGPT says',
    )!;
    const href = new URL(check.getAttribute('href')!, 'https://app.example');
    expect(href.pathname).toBe('/dashboard/chat');
    expect(href.searchParams.get('compose')).toBe(
      '/chatgpt-profile Check what ChatGPT says about our business, and prepare our Business Hub corrections and site fixes.',
    );
    expect(check.getAttribute('target')).toBeNull();
  });

  it('offers no profile check while the new Chat is off for the workspace', async () => {
    await render({ variant: 'open', region: 'US' });
    expect(container.textContent).not.toContain('Check what ChatGPT says');
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });

  it('says Business Agents are for US businesses only outside the open regions', async () => {
    await render({ variant: 'waitlist', region: 'TR' });
    expect(container.textContent).toContain('Business Agents are for US businesses only.');
  });
});
