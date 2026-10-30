import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { DemoBrandProvider } from '@/components/providers/demo-brand-provider';
import { PlanProvider } from '@/components/providers/plan-provider';
import { BillingSection } from './billing-section';

/**
 * Billing's current plan: a workspace that never started a plan has none to
 * name ("No plan yet", not "Starter incomplete"), and its cards offer the
 * free trial beside Buy now; a plan that ended keeps its name and status.
 */

/** The organization's row, as Billing reads it. */
let org: { plan: string | null; subscription_status: string | null };

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data:
              table === 'profiles'
                ? { organization_id: 'org1' }
                : { ...org, subscription_ends_at: null },
          }),
        }),
      }),
    }),
  }),
}));

// The cards, as Billing hands them the subscription; their own test covers them.
const switcher = vi.hoisted(() => vi.fn());
vi.mock('@/components/settings/plan-switcher', () => ({
  PlanSwitcher: (props: { trialOffered?: boolean }) => {
    switcher(props);
    return <div data-slot="plan-switcher" />;
  },
}));
vi.mock('@/components/settings/ai-usage-card', () => ({ AiUsageCard: () => null }));
vi.mock('@/components/settings/add-ons-card', () => ({ AddOnsCard: () => null }));
vi.mock('@/components/settings/invoice-list', () => ({ InvoiceList: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render(everSubscribed: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanProvider planId="starter" subscriptionActive={false}>
          <DemoBrandProvider everSubscribed={everSubscribed}>
            <BillingSection />
          </DemoBrandProvider>
        </PlanProvider>
      </NextIntlClientProvider>,
    );
  });
  await vi.waitFor(() =>
    expect(container.querySelector('[data-slot="plan-switcher"]')).not.toBeNull(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  // Stripe has no subscription to add: the organization's row stands.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'none' }, { status: 404 })),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('BillingSection', () => {
  it('says a workspace that never started a plan has none yet, and offers the trial', async () => {
    org = { plan: 'free', subscription_status: 'incomplete' };
    await render(false);
    expect(container.textContent).toContain('No plan yet');
    expect(container.textContent).toContain(
      'Your brands are saved. Tracking starts once you choose a plan below.',
    );
    expect(container.textContent).not.toContain('Starter');
    expect(container.textContent).not.toContain('incomplete');
    expect(container.textContent).not.toContain('$49/');
    expect(container.textContent).toContain('Choose how to start');
    expect(switcher).toHaveBeenLastCalledWith(expect.objectContaining({ trialOffered: true }));
  });

  it('names the plan that ended, with Buy now alone on its cards', async () => {
    org = { plan: 'growth', subscription_status: 'canceled' };
    await render(true);
    expect(container.textContent).toContain('Growth');
    expect(container.textContent).toContain('Canceled');
    expect(container.textContent).not.toContain('No plan yet');
    expect(container.textContent).toContain('Choose a plan');
    expect(switcher).toHaveBeenLastCalledWith(expect.objectContaining({ trialOffered: false }));
  });
});
