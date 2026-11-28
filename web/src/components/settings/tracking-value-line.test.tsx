import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { PlanAddOnsView } from '@/lib/actions/plan-add-ons';
// add-ons-card reaches Supabase on import; the line only needs its price format.
vi.mock('./add-ons-card', () => ({
  formatPackPrice: (cents: number, currency: string) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100),
}));

const { TrackingValueLine } = await import('./tracking-value-line');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const view = (over: Partial<PlanAddOnsView> = {}) =>
  ({
    currency: 'usd',
    interval: 'month',
    planPriceCents: 24900,
    current: { trackingUnits: 0, extraBrands: 0 },
    slots: {
      state: 'open',
      platforms: ['chatgpt-web', 'gemini-web', 'google-aio', 'google-aimode', 'copilot-web'].map(
        (id) => ({
          id,
          group: 'standard',
          unitCents: 1500,
          unitSlots: 100,
          included: 250,
          units: 0,
          inUse: 0,
        }),
      ),
    },
    ...over,
  }) as PlanAddOnsView;

async function text(addOns: PlanAddOnsView) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TrackingValueLine addOns={addOns} />
      </NextIntlClientProvider>,
    );
  });
  const out = container.textContent;
  act(() => root.unmount());
  return out;
}

describe('TrackingValueLine', () => {
  it('says what Growth’s tracking gives for its price', async () => {
    expect(await text(view())).toBe(
      'Up to 37,500 answers a month · $6.64 per 1,0001,250 slots a day × 30 days',
    );
  });

  it('shows nothing when the plan has no slots', async () => {
    expect(await text(view({ slots: null }))).toBe('');
  });
});
