import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { toast } from 'sonner';
import { RoleProvider } from '@/components/providers/role-provider';
import type { TeamRole } from '@/components/providers/role-provider';
import { sendCancelFeedback } from '@/lib/actions/cancel-feedback';
import { PlanSwitcher } from './plan-switcher';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/actions/cancel-feedback', () => ({
  sendCancelFeedback: vi.fn(async () => ({ ok: true })),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onUpdate = vi.fn();

async function render(
  planId = 'starter',
  {
    status = 'active',
    interval = 'month',
    role = 'admin',
  }: { status?: string; interval?: string; role?: TeamRole } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <PlanSwitcher
            subscription={{
              planId,
              status,
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              priceAmount: 49,
              interval,
            }}
            onUpdate={onUpdate}
          />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

async function click(label: string) {
  await act(async () => {
    button(label)!.click();
  });
}

/** Each plan card's text, by plan name. */
const cardText = () =>
  Object.fromEntries(
    [...container.querySelectorAll('[data-slot="card"]')].map((card) => [
      card.querySelector('[data-slot="card-title"]')?.textContent,
      card.textContent,
    ]),
  );

/** Each plan card's name and its list, in order. */
const cards = () =>
  Object.fromEntries(
    [...container.querySelectorAll('[data-slot="card"]')].map((card) => [
      card.querySelector('[data-slot="card-title"]')?.textContent,
      [...card.querySelectorAll('li')].map((li) => li.textContent),
    ]),
  );

beforeEach(() => {
  vi.clearAllMocks();
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

  it('links to every feature on the pricing page, in a new tab, for any role', async () => {
    await render('starter', { role: 'manager' });
    const link = container.querySelector('a[href="https://www.ansvisor.com/pricing"]');
    expect(link?.textContent).toBe('See everything each plan includes');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('the billing period', () => {
  it('shows a year up front with the full year struck through and the saving', async () => {
    await render();
    expect(cardText().Starter).toContain('$49/mo');
    expect(cardText().Growth).toContain('Popular');
    expect(cardText().Starter).not.toContain('Popular');

    await click('AnnualSave 20%');

    const starter = container.querySelectorAll('[data-slot="card"]')[0];
    const struck = starter.querySelector('.line-through');
    expect(struck?.textContent).toBe('Regular price $588');
    expect(starter.textContent).toContain('$470/yr');
    expect(starter.textContent).toContain('Save 20%');
    const growth = container.querySelectorAll('[data-slot="card"]')[1];
    expect(growth.querySelector('.line-through')?.textContent).toBe('Regular price $2,988');
    expect(growth.textContent).toContain('$2,390/yr');
  });

  it('moves a paid plan to annual billing from its own card', async () => {
    await render('starter');
    expect(button('Switch to annual billing')).toBeUndefined();

    await click('AnnualSave 20%');
    await click('Switch to annual billing');

    expect(document.body.textContent).toContain('Switch to annual billing?');
    expect(document.body.textContent).toContain('Your Starter plan will cost $470 a year.');
  });
});

describe('buying during the free trial', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ planId: 'growth', status: 'active', interval: 'month', priceAmount: 249 }),
      ),
    );
  });

  it('leaves buying and changing the plan to admins', async () => {
    await render('starter', { status: 'trialing', role: 'manager' });
    expect(document.body.textContent).toContain(
      'Only admins can buy or change the plan. Ask an admin in your organization.',
    );
    expect(
      [...document.querySelectorAll('button')].filter((b) =>
        /^(Buy|Upgrade|Downgrade|Switch)/.test(b.textContent?.trim() ?? ''),
      ),
    ).toEqual([]);
  });

  it('leaves cancelling to admins', async () => {
    const cancel = () =>
      [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Cancel Subscription',
      );
    await render('growth', { status: 'active', role: 'manager' });
    expect(cancel()).toBeUndefined();
    await render('growth', { status: 'active', role: 'admin' });
    expect(cancel()).toBeDefined();
  });

  it('offers every plan now, with the first-month code on monthly', async () => {
    await render('starter', { status: 'trialing' });
    expect(button('Buy Starter now')).toBeDefined();
    expect(button('Buy Growth now')).toBeDefined();
    expect(container.textContent).toContain('50% off your first month with code SAVE50');
  });

  it('buys Growth monthly with SAVE50 filled in', async () => {
    await render('starter', { status: 'trialing' });
    await click('Buy Growth now');

    expect(document.body.textContent).toContain('Buy Growth now?');
    expect(document.body.textContent).toContain(
      'Your free trial ends today and the card you added is charged $249 for the first month.',
    );
    const code = document.querySelector<HTMLInputElement>('#promo-code');
    expect(code?.value).toBe('SAVE50');
    expect(document.body.textContent).toContain('With SAVE50, your first month is $124.50.');

    await click('Buy now');

    expect(fetch).toHaveBeenCalledWith('/api/stripe/subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newPlanId: 'growth',
        interval: 'month',
        buyNow: true,
        promoCode: 'SAVE50',
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('buys a year without a code', async () => {
    await render('starter', { status: 'trialing' });
    await click('AnnualSave 20%');
    expect(container.textContent).not.toContain('SAVE50');
    await click('Buy Starter now');

    expect(document.querySelector('#promo-code')).toBeNull();
    await click('Buy now');

    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toEqual({
      newPlanId: 'starter',
      interval: 'year',
      buyNow: true,
    });
  });

  it('offers to update the card when the payment fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: 'Your card was declined.', code: 'payment_failed' }, { status: 402 }),
    );
    await render('starter', { status: 'trialing' });
    await click('Buy Starter now');
    await click('Buy now');

    expect(toast.error).toHaveBeenCalledWith('Your card was declined.', {
      description: 'Your free trial carries on. Update your card on Stripe, then try again.',
      action: { label: 'Update card', onClick: expect.any(Function) },
    });
    expect(onUpdate).not.toHaveBeenCalled();
    // The dialog stays open to try again.
    expect(document.body.textContent).toContain('Buy Starter now?');
  });
});

describe('cancelling', () => {
  it('asks what went wrong first, then cancels at the end of the period and tells the team', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ cancelAtPeriodEnd: true, currentPeriodEnd: '2026-11-20T00:00:00Z' }),
      ),
    );
    await render('growth');
    await click('Cancel Subscription');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Before you go, what went wrong?');
    await act(async () => {
      [...dialog.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === 'Cancel Subscription')!
        .click();
    });
    expect(fetch).toHaveBeenCalledWith('/api/stripe/subscription', { method: 'DELETE' });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-11-20T00:00:00Z',
      }),
    );
    expect(sendCancelFeedback).toHaveBeenCalledWith({ reasons: [], message: '', choice: 'cancel' });
  });
});
