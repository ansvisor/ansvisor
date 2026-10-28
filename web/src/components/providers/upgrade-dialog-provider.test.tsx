import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { PlanProvider } from './plan-provider';
import { RoleProvider, type TeamRole } from './role-provider';
import { UpgradeDialogProvider, useUpgradeGate } from './upgrade-dialog-provider';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const action = vi.fn((label: string) => `ran ${label}`);
let returned: unknown;
// What a guarded button says it does, for the dialog's label; none unless a test says.
let label: string | undefined;

/** A button whose click is guarded, as a page's action button would be. */
function Probe() {
  const { guard, isLocked } = useUpgradeGate();
  return (
    <button
      type="button"
      data-locked={String(isLocked)}
      onClick={() => {
        returned = guard(action, { action: label })('Run all');
      }}
    >
      Run all
    </button>
  );
}

async function render({
  active,
  status = 'canceled',
  role = 'admin',
  adminName = null,
  provider = true,
}: {
  active: boolean;
  status?: string | null;
  role?: TeamRole;
  adminName?: string | null;
  provider?: boolean;
}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanProvider planId="starter" subscriptionActive={active} subscriptionStatus={status}>
          <RoleProvider role={role}>
            {provider ? (
              <UpgradeDialogProvider adminName={adminName}>
                <Probe />
              </UpgradeDialogProvider>
            ) : (
              <Probe />
            )}
          </RoleProvider>
        </PlanProvider>
      </NextIntlClientProvider>,
    );
  });
}

const probe = () => container.querySelector<HTMLButtonElement>('button[data-locked]')!;
const dialog = () => document.querySelector('[role="dialog"]');
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

async function runAll() {
  await act(async () => {
    probe().click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  returned = undefined;
  label = undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe('useUpgradeGate', () => {
  it('runs the action while the plan is active', async () => {
    await render({ active: true, status: 'active' });
    expect(probe().dataset.locked).toBe('false');
    await runAll();
    expect(action).toHaveBeenCalledWith('Run all');
    expect(returned).toBe('ran Run all');
    expect(dialog()).toBeNull();
  });

  it('opens the upgrade dialog instead, without running it, while read-only', async () => {
    await render({ active: false });
    expect(probe().dataset.locked).toBe('true');
    await runAll();
    expect(action).not.toHaveBeenCalled();
    expect(returned).toBeUndefined();
    expect(dialog()?.textContent).toContain('Choose a plan to keep going');
    expect(dialog()?.textContent).toContain(
      "Your workspace has no active plan, so it\'s read-only. Everything you set up is still here: pick a plan to track, write and run your agents again.",
    );
    // The workspace's state when the button didn't say what it does.
    expect(document.querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Your workspace is read-only',
    );
  });

  it('closes with its ×, and opens again on the next action', async () => {
    await render({ active: false });
    await runAll();
    await act(async () => {
      button('Close')!.click();
    });
    await vi.waitFor(() => expect(dialog()).toBeNull());

    await runAll();
    expect(dialog()?.textContent).toContain('Choose a plan to keep going');
    expect(action).not.toHaveBeenCalled();
  });

  it('labels the dialog with what was clicked, when the button says', async () => {
    label = 'Adding prompts needs a plan';
    await render({ active: false });
    await runAll();
    expect(document.querySelector('[data-slot="upgrade-action"]')?.textContent).toBe(
      'Adding prompts needs a plan',
    );
  });

  it('offers an admin the plans, to choose one right there', async () => {
    await render({ active: false, status: 'canceled' });
    await runAll();
    expect(button('Choose Starter')).toBeDefined();
    expect(button('Choose Growth')).toBeDefined();
    expect(dialog()?.textContent).toContain("You'll pay by card on Stripe's checkout.");
    expect(button('Update payment method')).toBeUndefined();
  });

  it('takes an admin to Stripe’s billing page while a payment is being retried', async () => {
    // Stripe's billing page; a hash, which jsdom can navigate to.
    const fetchMock = vi.fn(async () => Response.json({ url: '#portal' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await render({ active: false, status: 'past_due' });
      await runAll();
      expect(dialog()?.textContent).toContain('Update your payment method to keep going');
      expect(dialog()?.textContent).toContain("Your last payment didn't go through");
      // No new plan beside the one being retried.
      expect(
        [...document.querySelectorAll('a')].some((a) => a.textContent === 'Choose a plan'),
      ).toBe(false);
      await act(async () => {
        button('Update payment method')!.click();
      });
      expect(fetchMock).toHaveBeenCalledWith('/api/stripe/portal', { method: 'POST' });
      await vi.waitFor(() => expect(window.location.hash).toBe('#portal'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks another member to turn to the admin, by name when known', async () => {
    await render({ active: false, status: null, role: 'manager', adminName: 'Jane Owner' });
    await runAll();
    expect(dialog()?.textContent).toContain('Your workspace has no active plan');
    expect(dialog()?.textContent).toContain(
      'Only an admin can choose a plan for your workspace. Ask Jane Owner, your workspace admin, to choose a plan.',
    );
    expect(button('Choose Starter')).toBeUndefined();
  });

  it('asks another member to have the admin update the payment method', async () => {
    await render({ active: false, status: 'unpaid', role: 'analyst' });
    await runAll();
    expect(dialog()?.textContent).toContain(
      'Ask your workspace admin to update the payment method.',
    );
    expect(button('Update payment method')).toBeUndefined();
  });

  it('asks for the workspace admin without a name', async () => {
    await render({ active: false, role: 'analyst' });
    await runAll();
    expect(dialog()?.textContent).toContain(
      'Only an admin can choose a plan for your workspace. Ask your admin to choose a plan.',
    );
  });

  it('never locks self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await render({ active: false });
    await runAll();
    expect(action).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('runs the action outside the dashboard’s provider', async () => {
    await render({ active: false, provider: false });
    await runAll();
    expect(action).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
});
