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
    expect(text).toContain('Add more to your plan');
    expect(text).toContain('+100 prompt locations$75/mo');
    expect(text).toContain('None');
    expect(byText('+5,000 prompt locations')?.getAttribute('href')).toContain('contact');
    expect(text).toContain('$25 a month per brand');
    expect(text).toContain('until your plan renews on Nov 29, 2026');
    expect(text).toContain('+10x');
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
    });
    api.apply.mockResolvedValue({ ok: true, changed: true, limits: { prompts: 1200, brands: 7 } });
    await render();
    await click(byText('+1,000 prompt locations'));
    for (let i = 0; i < 3; i++)
      await click(document.querySelector<HTMLElement>('[aria-label="One brand more"]')!);
    await click(byText('+10x'));
    expect(container.textContent).toContain('1,200 prompt locations · 7 brands');

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

  it('sells tracking slots per platform, with the volume discount worked out as you pick', async () => {
    await render({ slots: SLOTS });
    const text = () => container.textContent ?? '';
    expect(text()).toContain('Tracking slots');
    expect(text()).toContain('Standard · $15 per 100 a month');
    expect(text()).toContain('120 of 250 used · 250 included');
    expect(text()).toContain('Add slots to see your price.');

    const more = document.querySelector<HTMLElement>('[aria-label="100 more Claude slots"]')!;
    for (let i = 0; i < 9; i++) await click(more);
    // $540: 5% of the $40 above $500 is $2, 0.37%.
    expect(text()).toContain('$540 − 0.37% ($2) = $538/mo');
    expect(text()).toContain('Add $460 more for 10% on the part above $1,000.');
    expect(text()).toContain('0 of 900 used · 0 included');

    api.preview.mockResolvedValue({
      ok: true,
      changed: true,
      limits: { prompts: 200, brands: 4 },
      slots: { 'chatgpt-web': 250, 'claude-web': 900 },
      slotsPrice: { listCents: 54000, percentOff: 0.37, discountCents: 200, next: null },
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

  it('hides the retired tracking tiers unless the workspace holds one', async () => {
    await render({ slots: SLOTS, tiers: [] });
    expect(container.textContent).not.toContain('Extra tracking');
  });

  it('keeps showing a retired tier to a workspace that holds one', async () => {
    await render({ slots: SLOTS, tiers: [], current: { trackingUnits: 100, extraBrands: 0 } });
    expect(container.textContent).toContain('Extra tracking');
  });

  it('lets Enterprise buy slots alone', async () => {
    await render({ state: 'enterprise', slots: SLOTS, tiers: [] });
    const text = container.textContent ?? '';
    expect(text).toContain('Add tracking slots on any platform.');
    expect(text).not.toContain('Extra brands');
    expect(text).not.toContain('AI usage top-up');
    expect(text).not.toContain('Your contract sets');
    await click(document.querySelector<HTMLElement>('[aria-label="100 more ChatGPT slots"]')!);
    expect(byText('Review and pay')?.hasAttribute('disabled')).toBe(false);
  });

  it('says which platform can’t go below its use', async () => {
    api.preview.mockResolvedValue({
      ok: false,
      failure: 'below_usage',
      slotsOver: [{ platform: 'claude-web', inUse: 250, limit: 200 }],
    });
    const holding = {
      ...SLOTS,
      platforms: [{ ...SLOTS.platforms[1], units: 3, inUse: 250 }],
    };
    await render({ slots: holding });
    await click(document.querySelector<HTMLElement>('[aria-label="100 fewer Claude slots"]')!);
    await click(byText('Review and pay'));
    expect(container.textContent).toContain("Claude uses 250 slots; it can't go down to 200.");
  });

  it('says when it can’t be read', async () => {
    await render(null);
    expect(container.textContent).toContain('Couldn’t read your add-ons.'.replace('’', "'"));
  });
});
