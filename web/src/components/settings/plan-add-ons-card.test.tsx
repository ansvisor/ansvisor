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
};

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

  it('says when it can’t be read', async () => {
    await render(null);
    expect(container.textContent).toContain('Couldn’t read your add-ons.'.replace('’', "'"));
  });
});
