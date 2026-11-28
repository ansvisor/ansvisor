import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { PlanAddOnsView } from '@/lib/actions/plan-add-ons';

/**
 * Settings › Billing › Add more to your plan (00546): Growth's extra
 * tracking, brands and AI top-ups, picked together, reviewed with Stripe's
 * figures and paid once. The server actions are mocked.
 */

const api = vi.hoisted(() => ({
  read: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
}));
vi.mock('@/lib/actions/plan-add-ons', () => ({
  readPlanAddOns: api.read,
  previewAddOnChange: api.preview,
  applyAddOnChange: api.apply,
}));
vi.mock('@/lib/actions/add-ons', () => ({}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { PlanAddOnsCard } = await import('./plan-add-ons-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const VIEW: PlanAddOnsView = {
  state: 'open',
  interval: 'month',
  currency: 'usd',
  base: { prompts: 200, brands: 4 },
  current: { trackingUnits: 0, extraBrands: 0 },
  tiers: [
    { units: 100, priceCents: 7500, contactSales: false },
    { units: 1000, priceCents: 65900, contactSales: false },
    { units: 5000, priceCents: 289900, contactSales: true },
  ],
  brandPriceCents: 2500,
  topUps: [
    { multiplier: 5, priceCents: 3900, briefs: 50, opportunities: 50 },
    { multiplier: 10, priceCents: 6900, briefs: 100, opportunities: 100 },
  ],
  renewsOn: '2026-11-29T10:00:00.000Z',
  buyState: 'open',
  planId: 'growth',
  planPriceCents: 24900,
  slots: null,
};

const SLOTS: NonNullable<PlanAddOnsView['slots']> = {
  state: 'open',
  platforms: [
    {
      id: 'chatgpt-web',
      group: 'standard',
      unitCents: 1500,
      unitSlots: 100,
      included: 250,
      units: 0,
      inUse: 120,
    },
    {
      id: 'claude-web',
      group: 'signed_in',
      unitCents: 6000,
      unitSlots: 100,
      included: 0,
      units: 0,
      inUse: 0,
    },
  ],
};

const SLOTS_PRICE = { listCents: 0, percentOff: 0, discountCents: 0, next: null };

let container: HTMLDivElement;
let root: Root;

async function render(view: Partial<PlanAddOnsView> | null = {}) {
  api.read.mockResolvedValue(
    view === null ? { ok: false, failure: 'failed' } : { ok: true, addOns: { ...VIEW, ...view } },
  );
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanAddOnsCard />
      </NextIntlClientProvider>,
    );
  });
}

const byText = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('button, a')].find((el) =>
    el.textContent?.includes(text),
  );
async function click(el: HTMLElement | undefined) {
  await act(async () => {
    el!.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/dashboard/settings/billing');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the add-ons card', () => {
  it('lists the tiers with None and Contact sales, the brands and the top-ups', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Extra brands');
    expect(text).toContain('+100 prompt locations$75/mo');
    expect(text).toContain('None');
    expect(byText('+5,000 prompt locations')?.getAttribute('href')).toContain('contact');
    expect(text).toContain('$25 a month per brand');
    expect(text).toContain('until your plan renews on Nov 29, 2026');
    expect(text).toContain('10x AI usage');
  });

  it('says what is due today on the button, and marks the plan as already paid', async () => {
    api.preview.mockResolvedValue({
      ok: true,
      changed: true,
      limits: { prompts: 200, brands: 5 },
      dueTodayCents: 4688,
      totalCents: 27400,
      currency: 'usd',
      interval: 'month',
      prorationDate: 1_800_000_000,
      slots: {},
      slotsPrice: SLOTS_PRICE,
      slotsWaiting: [],
    });
    await render();
    expect(container.textContent).toContain('Already in your subscription · no change');
    await click(document.querySelector<HTMLElement>('[aria-label="One brand more"]')!);
    // Before Stripe answers, the button doesn't guess an amount.
    expect(byText('Review and pay')?.textContent).toBe('Review and pay');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(api.preview).toHaveBeenCalledWith({ trackingUnits: 0, extraBrands: 1, topUp: 0 });
    expect(byText('Review and pay')?.textContent).toBe('Review and pay $46.88');
    expect(container.textContent).toContain('Due today: $46.88 for the added items');
  });

  it('reviews the whole cart with Stripe’s figures, then pays it once', async () => {
    api.preview.mockResolvedValue({
      ok: true,
      changed: true,
      limits: { prompts: 1200, brands: 7 },
      dueTodayCents: 55800,
      totalCents: 98300,
      currency: 'usd',
      interval: 'month',
      prorationDate: 1_800_000_000,
      slots: {},
      slotsPrice: SLOTS_PRICE,
      slotsWaiting: [],
    });
    api.apply.mockResolvedValue({ ok: true, changed: true, limits: { prompts: 1200, brands: 7 } });
    await render();
    await click(byText('+1,000 prompt locations'));
    for (let i = 0; i < 3; i++)
      await click(document.querySelector<HTMLElement>('[aria-label="One brand more"]')!);
    await click(byText('10x AI usage'));
    expect(container.textContent).toContain('Monthly total from the next renewal $983/mo');

    await click(byText('Review and pay'));
    expect(api.preview).toHaveBeenCalledWith({ trackingUnits: 1000, extraBrands: 3, topUp: 10 });
    const dialog = document.body.textContent ?? '';
    expect(dialog).toContain('Due today$558');
    expect(dialog).toContain('$983 a month');

    await click(byText('Pay $558'));
    expect(api.apply).toHaveBeenCalledWith({
      trackingUnits: 1000,
      extraBrands: 3,
      topUp: 10,
      prorationDate: 1_800_000_000,
    });
    expect(refresh).toHaveBeenCalled();
    expect(api.read).toHaveBeenCalledTimes(2);
  });

  it('says why a change is refused, with the numbers when it is below use', async () => {
    api.preview.mockResolvedValue({
      ok: false,
      failure: 'below_usage',
      inUse: { prompts: 950, brands: 6 },
      limits: { prompts: 300, brands: 6 },
    });
    await render({ current: { trackingUnits: 1000, extraBrands: 2 } });
    await click(byText('+100 prompt locations'));
    await click(byText('Review and pay'));
    expect(container.textContent).toContain(
      'You use 950 prompt locations and 6 brands; the new limits are 300 and 6.',
    );
  });

  it('can’t be bought outside an active Growth plan, and says why', async () => {
    await render({ state: 'starter' });
    expect(container.textContent).toContain('Add-ons come with the Growth plan.');
    expect(byText('Review and pay')?.hasAttribute('disabled')).toBe(true);
    expect(byText('+100 prompt locations')?.hasAttribute('disabled')).toBe(true);
  });

  it('leaves buying to admins', async () => {
    await render({ state: 'not_admin' });
    expect(container.textContent).toContain('Only admins change add-ons.');
  });

  it('preselects the next tier from a deep link', async () => {
    window.history.replaceState(null, '', '/dashboard/settings/billing?add=tracking');
    await render({ current: { trackingUnits: 100, extraBrands: 0 } });
    expect(byText('+1,000 prompt locations')?.getAttribute('aria-checked')).toBe('true');
  });

  it('scrolls to itself once read, when a link opened Billing on it', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.replaceState(null, '', '/dashboard/settings/billing#plan-add-ons');
    await render({});
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('picks nothing from the link for one who can’t buy', async () => {
    window.history.replaceState(null, '', '/dashboard/settings/billing?add=tracking');
    await render({ state: 'not_admin', current: { trackingUnits: 100, extraBrands: 0 } });
    expect(byText('+1,000 prompt locations')?.getAttribute('aria-checked')).not.toBe('true');
  });

  it('sells tracking slots in a table, with the volume discount worked out as you pick', async () => {
    await render({ slots: SLOTS });
    const text = () => container.textContent ?? '';
    expect(text()).toContain('Buy extra tracking credits');
    expect(text()).toContain('Growth includes 250 slots on each standard platform.');
    expect(text()).toContain('In your plan');
    // The Extra slots header explains a slot on hover, from an (i) button.
    expect(document.querySelector('th button[aria-label="What is a slot?"]')).not.toBeNull();
    expect(text()).toContain('Extra tracking: $0 a month. Add $500 more a month for 5% off');

    const more = document.querySelector<HTMLElement>('[aria-label="100 more Claude slots"]')!;
    for (let i = 0; i < 9; i++) await click(more);
    // $540: 5% of the $40 above $500 is $2, 0.37%.
    expect(text()).toContain('0.37% off your extra tracking: $2 off $540 a month.');
    expect(text()).toContain('Add $460 more a month for 10% off the part above $1,000.');
    // The cart: what the plan will have, and the monthly total.
    const cart = document.querySelector('[data-slot="add-ons-cart"]')!.textContent ?? '';
    expect(cart).toContain('Growth planAlready in your subscription · no change$249/mo');
    expect(cart).toContain('Claude extra tracking900 slots');
    expect(cart).toContain('$538/mo');
    expect(cart).toContain('Monthly total from the next renewal $787/mo');

    api.preview.mockResolvedValue({
      ok: true,
      changed: true,
      limits: { prompts: 200, brands: 4 },
      slots: { 'chatgpt-web': 250, 'claude-web': 900 },
      slotsPrice: { listCents: 54000, percentOff: 0.37, discountCents: 200, next: null },
      slotsWaiting: [],
      dueTodayCents: 30000,
      totalCents: 78700,
      currency: 'usd',
      interval: 'month',
      prorationDate: 1_800_000_000,
    });
    await click(byText('Review and pay'));
    expect(api.preview).toHaveBeenCalledWith({
      trackingUnits: 0,
      extraBrands: 0,
      topUp: 0,
      slots: { 'chatgpt-web': 0, 'claude-web': 9 },
    });
    const dialog = document.body.textContent ?? '';
    expect(dialog).toContain('Claude slots900 (+900 added)');
    expect(dialog).toContain('Volume discount (0.37%)−$2 a month');
  });

  it('takes a platform out of the cart with ×, and undoes everything', async () => {
    await render({ slots: { ...SLOTS, platforms: [{ ...SLOTS.platforms[1], units: 3 }] } });
    const cart = () => document.querySelector('[data-slot="add-ons-cart"]')!.textContent ?? '';
    expect(cart()).toContain('Claude extra tracking300 slots');
    await click(
      document.querySelector<HTMLElement>('[aria-label="Remove Claude extra tracking"]')!,
    );
    expect(cart()).not.toContain('Claude extra tracking');
    expect(container.textContent).toContain('was 300');
    await click(byText('Undo all changes'));
    expect(cart()).toContain('Claude extra tracking300 slots');
  });

  it('hides the retired tracking tiers unless the workspace holds one', async () => {
    await render({ slots: SLOTS, tiers: [] });
    expect(container.querySelector('[aria-label="Extra tracking tiers"]')).toBeNull();
  });

  it('keeps showing a retired tier to a workspace that holds one', async () => {
    await render({ slots: SLOTS, tiers: [], current: { trackingUnits: 100, extraBrands: 0 } });
    expect(container.querySelector('[aria-label="Extra tracking tiers"]')).not.toBeNull();
  });

  it('lets Enterprise buy slots, extra brands and top-ups, not the retired tiers', async () => {
    await render({ state: 'enterprise', planId: 'enterprise', slots: SLOTS, tiers: [] });
    const text = container.textContent ?? '';
    expect(text).toContain('Buy extra tracking credits');
    expect(text).toContain('Enterprise plan');
    expect(text).toContain('Extra brands');
    expect(text).toContain('AI usage top-up');
    expect(container.querySelector('[aria-label="Extra tracking tiers"]')).toBeNull();
    expect(text).not.toContain('Your contract sets');
    await click(document.querySelector<HTMLElement>('[aria-label="100 more ChatGPT slots"]')!);
    expect(byText('Review and pay')?.hasAttribute('disabled')).toBe(false);
  });

  it('lets Enterprise buy an extra brand with no slots on sale', async () => {
    api.preview.mockResolvedValue({
      ok: true,
      changed: true,
      limits: { prompts: 3000, brands: 11 },
      slots: {},
      slotsPrice: SLOTS_PRICE,
      slotsWaiting: [],
      dueTodayCents: 1250,
      totalCents: 26400,
      currency: 'usd',
      interval: 'month',
      prorationDate: 1_800_000_000,
    });
    await render({
      state: 'enterprise',
      planId: 'enterprise',
      slots: null,
      tiers: [],
      base: { prompts: 3000, brands: 10 },
    });
    await click(document.querySelector<HTMLElement>('[aria-label="One brand more"]')!);
    const cart = document.querySelector('[data-slot="add-ons-cart"]')!.textContent ?? '';
    expect(cart).toContain('Extra brands');
    expect(cart).toContain('Monthly total from the next renewal $274/mo');
    await click(byText('Review and pay'));
    expect(api.preview).toHaveBeenCalledWith({ trackingUnits: 0, extraBrands: 1, topUp: 0 });
  });

  it('keeps Enterprise’s brands closed when it can’t buy now', async () => {
    await render({
      state: 'enterprise',
      buyState: 'not_admin',
      planId: 'enterprise',
      slots: null,
      tiers: [],
    });
    expect(container.textContent).toContain('Only admins change add-ons.');
    expect(document.querySelector('[aria-label="One brand more"]')?.hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('shows unlimited Enterprise top-ups and slots, no extra brands', async () => {
    await render({
      state: 'enterprise',
      planId: 'enterprise',
      slots: SLOTS,
      tiers: [],
      base: { prompts: -1, brands: -1 },
      brandPriceCents: null,
    });
    const text = container.textContent ?? '';
    expect(text).not.toContain('Extra brands');
    expect(text).toContain('AI usage top-up');
    expect(document.querySelector('[aria-label="One brand more"]')).toBeNull();
  });

  it('says on Review and pay how many locations will wait when slots go below use', async () => {
    api.preview.mockResolvedValue({
      ok: true,
      changed: true,
      limits: { prompts: 200, brands: 4 },
      slots: { 'claude-web': 200 },
      slotsPrice: { listCents: 12000, percentOff: 0, discountCents: 0, next: null },
      slotsWaiting: [{ platform: 'claude-web', inUse: 250, limit: 200 }],
      dueTodayCents: 0,
      totalCents: 36900,
      currency: 'usd',
      interval: 'month',
      prorationDate: 1_800_000_000,
    });
    await render({
      slots: { ...SLOTS, platforms: [{ ...SLOTS.platforms[1], units: 3, inUse: 250 }] },
    });
    await click(document.querySelector<HTMLElement>('[aria-label="100 fewer Claude slots"]')!);
    await click(byText('Review and pay'));
    expect(document.body.textContent).toContain(
      'Claude: the newest 50 prompt locations will wait for a slot.',
    );
  });

  it('shows Enterprise nothing while no slots are on sale', async () => {
    await render({
      state: 'enterprise',
      planId: 'enterprise',
      slots: null,
      brandPriceCents: null,
      topUps: [],
    });
    const text = container.textContent ?? '';
    expect(text).not.toContain('Your add-ons');
    expect(text).not.toContain('AI usage top-up');
    expect(text).not.toContain('Review and pay');
  });

  it('says when it can’t be read', async () => {
    await render(null);
    expect(container.textContent).toContain('Couldn’t read your add-ons.'.replace('’', "'"));
  });
});
