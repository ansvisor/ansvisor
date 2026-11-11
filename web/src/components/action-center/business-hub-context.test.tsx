import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { BUSINESS_HUB_URL } from '@/lib/business-hub/links';
import { BusinessHubContext } from './business-hub-context';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(payload: Record<string, unknown>) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BusinessHubContext payload={payload} />
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

  it('says Business Agents are for US businesses only outside the open regions', async () => {
    await render({ variant: 'waitlist', region: 'TR' });
    expect(container.textContent).toContain('Business Agents are for US businesses only.');
  });
});
