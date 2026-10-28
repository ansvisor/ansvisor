import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import { ChoosePlanDialog } from './choose-plan-dialog';

/**
 * "Choose a plan to keep going" with the plans: Billing's features and
 * prices, monthly or a year up front, a promotion code checked with Stripe
 * (monthly only), and Checkout from a card. Members see the plans without
 * buying.
 */

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

/** SAVE50 as the promo route reads it from Stripe. */
const save50 = {
  valid: true,
  code: 'SAVE50',
  percentOff: 50,
  amountOff: null,
  duration: 'once',
  durationInMonths: null,
  monthlyOnly: true,
};

async function render({
  role = 'admin',
  action = 'Adding prompts needs a plan',
}: { role?: TeamRole; action?: string | null } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <ChoosePlanDialog
            open
            onOpenChange={() => {}}
            action={action}
            askAdmin="Ask your admin to choose a plan."
            organizationId="org1"
          />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const card = (plan: string) => dialog().querySelector<HTMLElement>(`[data-plan="${plan}"]`)!;
const price = (plan: string) =>
  card(plan).querySelector('[data-slot="plan-price"]')!.textContent?.replace(/\s+/g, ' ').trim();
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const codeInput = () => document.querySelector<HTMLInputElement>('#upgrade-promo-code');
const note = () => document.querySelector('#upgrade-promo-note')!.textContent;

async function click(label: string) {
  await act(async () => {
    button(label)!.click();
  });
}

/** Types a code and presses Apply. */
async function apply(code: string) {
  const input = codeInput()!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, code);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Apply');
}

/** The promo route answers with this; Checkout with a URL. */
function answer(promo: unknown) {
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/stripe/promo-code' ? Response.json(promo) : Response.json({ url: '#checkout' }),
  );
}

/** The body the dialog sent to a route. */
const sent = (url: string) =>
  JSON.parse(fetchMock.mock.calls.find(([u]) => u === url)![1].body as string);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  answer(save50);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ChoosePlanDialog', () => {
  it('shows what was clicked, the title and the read-only word', async () => {
    await render();
    expect(dialog().querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Adding prompts needs a plan',
    );
    expect(dialog().textContent).toContain('Choose a plan to keep going');
    expect(dialog().textContent).toContain(
      "Your workspace has no active plan, so it's read-only. Everything you set up is still here",
    );
  });

  it('says the workspace is read-only when opened from the banner', async () => {
    await render({ action: null });
    expect(dialog().querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Your workspace is read-only',
    );
  });

  it("lists Billing's plans with their monthly prices, Growth as Popular, and Custom", async () => {
    await render();
    expect(price('starter')).toBe('$49/mo');
    expect(price('growth')).toBe('$249/mo');
    expect(card('growth').textContent).toContain('Popular');
    expect(card('starter').textContent).toContain('ChatGPT & Microsoft Copilot tracking');
    expect(card('starter').textContent).toContain('1x AI usage');
    expect(card('growth').textContent).toContain('5x AI usage');
    expect(card('growth').textContent).toContain('White-label reports & Looker Studio');
    expect(button('Choose Starter')).toBeDefined();
    expect(button('Choose Growth')).toBeDefined();
    expect(card('starter').textContent).toContain("You'll pay by card on Stripe's checkout.");

    const custom = card('custom').textContent;
    expect(custom).toContain('Starting at$499/mo');
    expect(custom).toContain('Contact us');
    expect(custom).toContain('Custom AI usage, from 10x');
    expect(custom).toContain('SSO / SAML and custom feature requests');
    expect(card('custom').querySelector('a')?.getAttribute('href')).toBe(
      'https://www.ansvisor.com/contact-us',
    );

    expect(dialog().textContent).toContain('Prices in USD.');
    const pricing = [...dialog().querySelectorAll('a')].find((a) =>
      a.textContent?.includes('See everything each plan includes'),
    );
    expect(pricing?.getAttribute('href')).toBe('https://www.ansvisor.com/pricing');
  });

  it('shows a year up front against twelve months, and its monthly share', async () => {
    await render();
    await click('AnnualSave 20%');
    expect(button('AnnualSave 20%')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Monthly')?.getAttribute('aria-pressed')).toBe('false');
    expect(price('starter')).toBe('Regular price $588$470/yr$39.17 a month, billed yearly');
    expect(price('growth')).toBe('Regular price $2,988$2,390/yr$199.17 a month, billed yearly');
  });

  it('applies a code Stripe takes: first month off on the cards and the buttons', async () => {
    await render();
    await apply('save50');
    expect(sent('/api/stripe/promo-code')).toEqual({ code: 'save50' });
    expect(dialog().querySelector('[data-slot="promo-applied"]')?.textContent).toBe(
      'SAVE50 · 50% off your first month',
    );
    expect(codeInput()).toBeNull();
    expect(price('starter')).toBe(
      'SAVE50: first month 50% offRegular price $49$24.50first monththen $49/mo',
    );
    expect(price('growth')).toContain('$124.50first month');
    expect(button('Choose Growth · $124.50 today')).toBeDefined();
    expect(button('Choose Starter · $24.50 today')).toBeDefined();
    expect(note()).toContain('Code applied. You pay 50% less for the first month');
  });

  it('says when a code is not valid, by the field', async () => {
    answer({ valid: false });
    await render();
    await apply('nope10');
    expect(note()).toBe('“NOPE10” isn’t a valid code.');
    expect(codeInput()?.getAttribute('aria-invalid')).toBe('true');
    expect(codeInput()?.getAttribute('aria-describedby')).toBe('upgrade-promo-note');
    expect(document.querySelector('#upgrade-promo-note')?.getAttribute('aria-live')).toBe('polite');
    expect(price('starter')).toBe('$49/mo');
    expect(button('Choose Starter')).toBeDefined();
  });

  it('says when the code could not be checked', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Internal error' }, { status: 500 }));
    await render();
    await apply('SAVE50');
    expect(note()).toBe("Couldn't check the code. Try again.");
  });

  it('keeps a code to monthly plans, with a way back to Monthly', async () => {
    await render();
    await apply('SAVE50');
    await click('AnnualSave 20%');
    expect(note()).toBe('SAVE50 is for monthly plans: 50% off the first month.Switch to Monthly');
    expect(price('starter')).toBe('Regular price $588$470/yr$39.17 a month, billed yearly');
    expect(button('Choose Starter')).toBeDefined();

    await click('Switch to Monthly');
    expect(button('Monthly')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Choose Starter · $24.50 today')).toBeDefined();
  });

  it('takes the code off with ×', async () => {
    await render();
    await apply('SAVE50');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Remove the code"]')!.click();
    });
    expect(codeInput()?.value).toBe('');
    expect(price('growth')).toBe('$249/mo');
    expect(button('Choose Growth')).toBeDefined();
  });

  it('opens Checkout for the plan and period, with the code on a monthly plan', async () => {
    await render();
    await apply('SAVE50');
    await click('Choose Growth · $124.50 today');
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'growth',
      organizationId: 'org1',
      interval: 'month',
      returnTo: 'billing',
      promotionCode: 'SAVE50',
    });
    await vi.waitFor(() => expect(window.location.hash).toBe('#checkout'));
  });

  it('opens Checkout for a year without the code', async () => {
    await render();
    await apply('SAVE50');
    await click('AnnualSave 20%');
    await click('Choose Starter');
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'starter',
      organizationId: 'org1',
      interval: 'year',
      returnTo: 'billing',
    });
  });

  it('opens Checkout without a code when none was applied', async () => {
    await render();
    await click('Choose Starter');
    expect(sent('/api/stripe/checkout')).toEqual({
      planId: 'starter',
      organizationId: 'org1',
      interval: 'month',
      returnTo: 'billing',
    });
  });

  it('takes back a code Checkout refused, and says so', async () => {
    await render();
    await apply('SAVE50');
    fetchMock.mockResolvedValue(
      Response.json(
        { error: "That promo code isn't valid", code: 'invalid_promo_code' },
        { status: 400 },
      ),
    );
    await click('Choose Starter · $24.50 today');
    expect(note()).toBe('“SAVE50” isn’t a valid code.');
    expect(button('Choose Starter')).toBeDefined();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports a Checkout that would not open', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Stripe is down' }, { status: 500 }));
    await render();
    await click('Choose Starter');
    expect(toast.error).toHaveBeenCalledWith('Stripe is down');
    expect(button('Choose Starter')?.disabled).toBe(false);
  });

  it('shows another member the plans without buying, a code or a discount', async () => {
    await render({ role: 'manager' });
    expect(dialog().querySelector('[data-slot="member-note"]')?.textContent).toBe(
      'Only an admin can choose a plan for your workspace. Ask your admin to choose a plan.',
    );
    expect(button('Choose Starter')).toBeUndefined();
    expect(button('Choose Growth')).toBeUndefined();
    expect(dialog().textContent).not.toContain("You'll pay by card");
    expect(dialog().querySelectorAll('[data-slot="ask-admin"]')).toHaveLength(2);
    expect(card('starter').textContent).toContain('Ask your admin to choose a plan');
    expect(codeInput()).toBeNull();
    expect(document.querySelector('#upgrade-promo-note')).toBeNull();
    expect(price('starter')).toBe('$49/mo');
    expect(card('custom').textContent).toContain('Contact us');

    // The period still switches, to see the prices.
    await click('AnnualSave 20%');
    expect(price('growth')).toContain('$2,390/yr');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
