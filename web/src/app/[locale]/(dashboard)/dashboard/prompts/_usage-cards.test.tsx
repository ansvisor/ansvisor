import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PromptUsageSummary } from '@/lib/prompt-usage-summary';
import {
  PromptUsageCards,
  countByStatus,
  locationQuotaFromUsage,
  matchesStatusFilter,
  type PromptUsageState,
} from './_usage-cards';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const summary = (over: Partial<PromptUsageSummary> = {}): PromptUsageSummary => ({
  plan: { key: 'starter', name: 'Starter plan', locationLimit: 50, cta: 'upgrade_growth' },
  brand: { active: 44, paused: 2, total: 46 },
  account: { activePrompts: 44, brands: 1, locationsUsed: 46 },
  updatedAt: '2026-10-15T09:00:00.000Z',
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onFilter = vi.fn();
const onRetry = vi.fn();

function render(state: PromptUsageState) {
  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        timeZone="UTC"
        now={new Date('2026-10-15T09:00:10.000Z')}
      >
        <PromptUsageCards
          state={state}
          brandName="Acme Coffee"
          readOnly={false}
          filter="active"
          onFilter={onFilter}
          onRetry={onRetry}
        />
      </NextIntlClientProvider>,
    );
  });
}

const values = () =>
  [...container.querySelectorAll('.text-2xl')].map((el) => el.textContent?.trim());
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

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

describe('PromptUsageCards', () => {
  it('shows the five numbers with the plan, and turns amber from 90% of the limit', () => {
    render({ status: 'ready', usage: summary() });

    expect(values()).toEqual(['44', '46', '44', '46 / 50', '4']);
    expect(container.textContent).toContain('Starter plan');
    expect(container.textContent).toContain('of 50 on Starter');
    expect(container.textContent).toContain('Counts updated just now');
    expect(container.querySelectorAll('.text-2xl')[4].className).toContain('text-amber-600');
    const upgrade = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Upgrade to Growth',
    );
    expect(upgrade?.getAttribute('href')).toBe('/dashboard/settings?tab=billing');
  });

  it('marks an account over its limit after a downgrade, with no slots left', () => {
    render({
      status: 'ready',
      usage: summary({ account: { activePrompts: 60, brands: 1, locationsUsed: 64 } }),
    });

    expect(values().slice(3)).toEqual(['64 / 50', '0']);
    expect(container.textContent).toContain('over limit');
  });

  it('asks an Enterprise account to contact us, against the limit set for it', () => {
    render({
      status: 'ready',
      usage: summary({
        plan: { key: 'enterprise', name: 'Enterprise plan', locationLimit: 1000, cta: 'contact' },
        brand: { active: 702, paused: 7, total: 709 },
        account: { activePrompts: 1248, brands: 3, locationsUsed: 781 },
      }),
    });

    expect(values()).toEqual(['702', '709', '1,248', '781 / 1,000', '219']);
    expect(container.textContent).toContain('across 3 brands');
    const contact = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Contact us',
    );
    expect(contact?.getAttribute('target')).toBe('_blank');
  });

  it('says Unlimited on self-hosted, with no plan page to link to', () => {
    render({
      status: 'ready',
      usage: summary({
        plan: { key: 'self_hosted', name: 'Self-Hosted plan', locationLimit: null, cta: null },
        account: { activePrompts: 57, brands: 1, locationsUsed: 74 },
      }),
    });

    expect(values().slice(3)).toEqual(['74', 'Unlimited']);
    expect(container.querySelector('[role=progressbar]')).toBeNull();
    expect(container.textContent).not.toContain('Plan & usage');
  });

  it('filters the table from the brand cards', () => {
    render({ status: 'ready', usage: summary() });

    act(() => button('Total prompts').click());
    expect(onFilter).toHaveBeenLastCalledWith('all');
    act(() => button('2 paused').click());
    expect(onFilter).toHaveBeenLastCalledWith('paused');
    act(() => button('Active prompts').click());
    expect(onFilter).toHaveBeenLastCalledWith('active');
  });

  it('shows dashes and a retry when the counts fail to load', () => {
    render({ status: 'error' });

    expect(values()).toEqual(['–', '–', '–', '–', '–']);
    act(() => button("Couldn't load the counts · Retry").click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("falls back to the server's plan name for a plan this bundle doesn't know", () => {
    render({
      status: 'ready',
      usage: summary({
        plan: { key: 'team' as never, name: 'Team plan', locationLimit: 500, cta: 'contact' },
      }),
    });

    expect(container.textContent).toContain('Team plan');
    expect(container.textContent).toContain('of 500 on Team plan');
  });

  it('shows skeletons, not zeros, while loading', () => {
    render({ status: 'loading' });

    expect(values()).toEqual([]);
    expect(container.querySelectorAll('[data-slot=skeleton]').length).toBeGreaterThan(0);
  });
});

describe('locationQuotaFromUsage', () => {
  it('gives the Add Prompt dialog the same limit and usage as the cards', () => {
    expect(locationQuotaFromUsage(summary())).toEqual({
      maxPrompts: 50,
      used: 46,
      planId: 'starter',
      planName: 'Starter',
    });
    expect(
      locationQuotaFromUsage(
        summary({
          plan: { key: 'self_hosted', name: 'Self-Hosted plan', locationLimit: null, cta: null },
        }),
      ).maxPrompts,
    ).toBe(-1);
  });
});

describe('the table status filter', () => {
  const rows = [{ isActive: true }, { isActive: true }, { isActive: false }];

  it('opens on active rows and counts each filter for the title', () => {
    expect(rows.filter((r) => matchesStatusFilter(r, 'active'))).toHaveLength(2);
    expect(rows.filter((r) => matchesStatusFilter(r, 'paused'))).toHaveLength(1);
    expect(rows.filter((r) => matchesStatusFilter(r, 'all'))).toHaveLength(3);
    expect(countByStatus(rows)).toEqual({ active: 2, paused: 1, all: 3 });
  });
});
