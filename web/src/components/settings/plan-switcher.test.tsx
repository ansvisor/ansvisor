import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { PlanSwitcher } from './plan-switcher';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(planId = 'starter') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanSwitcher
          subscription={{
            planId,
            status: 'active',
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            priceAmount: 49,
            interval: 'month',
          }}
          onUpdate={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
  });
}

/** Each plan card's name and its list, in order. */
const cards = () =>
  Object.fromEntries(
    [...container.querySelectorAll('[data-slot="card"]')].map((card) => [
      card.querySelector('[data-slot="card-title"]')?.textContent,
      [...card.querySelectorAll('li')].map((li) => li.textContent),
    ]),
  );

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the plan cards', () => {
  it('list what each plan includes, as the pricing page does', async () => {
    await render();
    expect(cards()).toEqual({
      Starter: [
        '1 brand',
        'Unlimited seats',
        '50 prompts tracked',
        'ChatGPT & Microsoft Copilot tracking',
        '10 content briefs a month',
        '100 site audits a month',
        '1x AI usage',
        'MCP & API access',
      ],
      Growth: [
        '4 brands',
        'Unlimited seats',
        '200 prompts tracked',
        'ChatGPT, Perplexity, Gemini, Microsoft Copilot, Google AI Mode and Google AI Overviews tracking',
        '50 content briefs a month',
        '500 site audits a month',
        '5x AI usage',
        'Multi-region tracking',
        'White-label reports & Looker Studio',
      ],
    });
    expect(container.textContent).not.toContain('8 answer engines');
    // AI usage says what it covers on hover.
    const ai = [...container.querySelectorAll('li span')].find(
      (el) => el.textContent === '5x AI usage',
    );
    expect(ai?.getAttribute('title')).toContain('Improve suggestions and the Content Editor');
    expect(container.textContent).toContain(
      'For small teams getting started with AI visibility monitoring and optimization.',
    );
  });

  it('says what a custom plan adds, with a way to ask', async () => {
    await render('growth');
    expect(container.textContent).toContain('Need a custom plan?');
    expect(container.textContent).toContain(
      'For large companies and agencies managing AI visibility at scale. Starting at $499/month.',
    );
    for (const point of [
      'Unlimited brands in a custom workspace',
      'All answer engines, Claude included',
      'SSO / SAML and custom feature requests',
    ]) {
      expect(container.textContent).toContain(point);
    }
    expect(
      container.querySelector('a[href="https://www.ansvisor.com/contact-us"]')?.textContent,
    ).toBe('Contact Us');
  });
});
