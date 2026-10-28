import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { PlanProvider } from '@/components/providers/plan-provider';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import { UpgradeDialogProvider } from '@/components/providers/upgrade-dialog-provider';
import { ReadOnlyBanner } from './read-only-banner';

let pathname = '/dashboard/insights';
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => pathname,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render({
  active = false,
  status = 'canceled',
  role = 'admin',
  adminName = null,
}: { active?: boolean; status?: string; role?: TeamRole; adminName?: string | null } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanProvider planId="starter" subscriptionActive={active} subscriptionStatus={status}>
          <RoleProvider role={role}>
            <UpgradeDialogProvider adminName={adminName}>
              <ReadOnlyBanner />
            </UpgradeDialogProvider>
          </RoleProvider>
        </PlanProvider>
      </NextIntlClientProvider>,
    );
  });
}

const link = () => container.querySelector('a');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  pathname = '/dashboard/insights';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe('ReadOnlyBanner', () => {
  const seePlans = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'See plans');

  it('says the workspace is read-only, and See plans opens the dialog', async () => {
    await render({ status: 'canceled' });
    expect(container.textContent).toContain(
      'Your workspace is read-only. You can look around; adding, running and AI need a plan.',
    );
    expect(link()).toBeNull();
    await act(async () => {
      seePlans()!.click();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Choose a plan to keep going',
    );
  });

  it('leaves See plans out on Billing itself', async () => {
    pathname = '/dashboard/settings/billing';
    await render();
    expect(container.textContent).toContain('Your workspace is read-only.');
    expect(seePlans()).toBeUndefined();
  });

  it('offers an admin Update payment method while a payment is being retried, on Billing too', async () => {
    pathname = '/dashboard/settings/billing';
    await render({ status: 'past_due' });
    expect(container.textContent).toContain(
      "Your last payment didn't go through, so your workspace is read-only.",
    );
    expect(container.querySelector('button')?.textContent).toBe('Update payment method');
    expect(seePlans()).toBeUndefined();
  });

  it('asks another member to have the admin update the payment method', async () => {
    await render({ status: 'unpaid', role: 'analyst', adminName: 'Jane Owner' });
    expect(container.textContent).toContain(
      'Ask Jane Owner, your workspace admin, to update the payment method.',
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('offers every member See plans once the plan ended', async () => {
    await render({ role: 'analyst' });
    expect(seePlans()).toBeDefined();
  });

  it('shows nothing while the plan is active', async () => {
    await render({ active: true, status: 'active' });
    expect(container.textContent).toBe('');
  });
});
