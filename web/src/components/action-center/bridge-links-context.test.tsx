import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { BridgeLinksContext, bridgeLinkPairs, linkPlanText } from './bridge-links-context';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

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
        <BridgeLinksContext payload={payload} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const SITE = 'https://acme.example';
const payload = {
  linkPairs: [
    {
      from: `${SITE}/blog/cold-brew`,
      to: `${SITE}/products/cold-brew-maker`,
      anchor: 'Cold brew maker',
      reason: 'sells',
      salesPage: 'product',
      aiVisits: 120,
      citations: 30,
      toTransactions: 6,
    },
    {
      from: `${SITE}/blog/what-is-a-crm`,
      to: `${SITE}/pricing`,
      anchor: null,
      reason: 'sales_page',
      salesPage: 'pricing',
      aiVisits: 0,
      citations: 25,
    },
    // Not whole addresses: left out.
    { from: '/blog/x', to: `${SITE}/y` },
  ],
};

describe('bridgeLinkPairs', () => {
  it('reads the pairs defensively, and words a plan line for each', () => {
    const pairs = bridgeLinkPairs(payload);
    expect(pairs.map((p) => [p.from, p.to, p.reason, p.salesPage])).toEqual([
      [`${SITE}/blog/cold-brew`, `${SITE}/products/cold-brew-maker`, 'sells', 'product'],
      [`${SITE}/blog/what-is-a-crm`, `${SITE}/pricing`, 'sales_page', 'pricing'],
    ]);
    expect(bridgeLinkPairs({ linkPairs: 'nope' })).toEqual([]);
    expect(linkPlanText(pairs, (p) => `${p.from} > ${p.to}`)).toBe(
      `${SITE}/blog/cold-brew > ${SITE}/products/cold-brew-maker\n${SITE}/blog/what-is-a-crm > ${SITE}/pricing`,
    );
  });
});

describe('BridgeLinksContext', () => {
  it('shows each page AI sends readers to, the page it should link to and why, and the link text', async () => {
    await render(payload);
    const text = container.textContent ?? '';
    expect(text).toContain('/blog/cold-brew');
    expect(text).toContain('120 AI visits · 30 citations in 28 days');
    expect(text).toContain('→ /products/cold-brew-maker');
    expect(text).toContain('Sells: 6 orders in 28 days');
    expect(text).toContain('Link text: “Cold brew maker”');
    expect(text).toContain('Your pricing page');
    expect(text).toContain('Start now opens each page in the Content Editor');
  });

  it('copies the link plan, one line per pair', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await render(payload);
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Copy link plan'),
    )!;
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledWith(
      `On ${SITE}/blog/cold-brew, link to ${SITE}/products/cold-brew-maker with the text “Cold brew maker”\n` +
        `On ${SITE}/blog/what-is-a-crm, link to ${SITE}/pricing`,
    );
    expect(toast.success).toHaveBeenCalledWith('Link plan copied');
  });

  it('says when no pair is left, with nothing to copy', async () => {
    await render({});
    expect(container.textContent).toContain('No links left to suggest.');
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Copy link plan'),
    )!;
    expect(button.disabled).toBe(true);
  });
});
