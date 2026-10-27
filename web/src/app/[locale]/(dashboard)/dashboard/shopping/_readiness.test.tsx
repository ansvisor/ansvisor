import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/** The Readiness tab (ECOM-015). */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ReadinessTab } = await import('./_readiness');

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

describe('ReadinessTab', () => {
  it("shows the market, each channel's state and source, and the scored checklist with its fixes", () => {
    const onProducts = vi.fn();
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ReadinessTab
            market="europe"
            tracked={['chatgpt-shopping', 'copilot-web']}
            ownSlots={new Map([['copilot-web', 3]])}
            score={64}
            items={[
              { key: 'catalog', state: 'pass', values: { count: 320 } },
              { key: 'merchantCenter', state: 'fail', action: 'settings' },
              { key: 'firstWords', state: 'fail', values: { count: 132 }, action: 'products' },
              {
                key: 'wrongPrice',
                state: 'fail',
                values: {
                  count: 2,
                  product: 'Trail Runner X',
                  seen: 139,
                  yours: 129,
                  currency: 'USD',
                },
                action: 'products',
              },
            ]}
            onProducts={onProducts}
          />
        </NextIntlClientProvider>,
      );
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Market: Europe.');
    expect(text).toContain(
      'ChatGPT ShoppingTracked, yours not shownGoogle Shopping · via Merchant Center',
    );
    expect(text).toContain('Microsoft CopilotShowing your productsMicrosoft Merchant Center');
    expect(text).toContain('Google GeminiNot tracked');
    expect(text).toContain('AI shopping readiness64 / 100');
    expect(text).toContain('Catalog connected320 products from your feed, file or store.');
    expect(text).toContain('First 40 words of descriptions · 132 products');
    expect(text).toContain(
      'Wrong price in AI answers · 2 productsAI shows $139 for Trail Runner X, your price is $129.',
    );
    expect(container.querySelector('a[href="/dashboard/settings/integrations"]')?.textContent).toBe(
      'Connect',
    );
    act(() => (container.querySelector('button') as HTMLButtonElement).click());
    expect(onProducts).toHaveBeenCalled();
  });
});
