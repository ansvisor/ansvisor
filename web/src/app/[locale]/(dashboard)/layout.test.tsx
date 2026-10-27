import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';

/**
 * The dashboard's subscription gate on Ansvisor Cloud: a workspace whose plan
 * isn't active opens read-only (the page, with the band across the top);
 * only an admin of a new account that never subscribed goes back to
 * onboarding's plan step.
 */

let profile: Record<string, unknown> | null;
let org: Record<string, unknown> | null;
let orgError: { message: string } | null;
let owner: { full_name: string | null } | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        single: async () =>
          table === 'profiles' ? { data: profile } : { data: org, error: orgError },
        maybeSingle: async () => ({ data: owner }),
      };
      return query;
    },
  }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/dashboard/insights',
}));

const pass = ({ children }: { children: ReactNode }) => <>{children}</>;
const none = () => null;
vi.mock('@/components/layout/sidebar', () => ({ Sidebar: none }));
vi.mock('@/components/layout/sidebar-error-boundary', () => ({ SidebarErrorBoundary: pass }));
vi.mock('@/components/layout/mobile-nav', () => ({ MobileNav: none }));
vi.mock('@/components/layout/tracking-job-handoff', () => ({ TrackingJobHandoff: none }));
vi.mock('@/components/providers/auth-provider', () => ({ AuthProvider: none }));
vi.mock('@/components/providers/ai-usage-provider', () => ({ AiUsageProvider: pass }));
vi.mock('@/components/providers/brand-loader', () => ({ BrandLoader: none }));
vi.mock('@/components/providers/brand-guard', () => ({ BrandGuard: pass }));
vi.mock('@/components/getting-started/page-opened', () => ({ GettingStartedPageOpened: none }));
vi.mock('@/lib/actions/brand', () => ({ getBrands: async () => [] }));

const { default: DashboardLayout } = await import('./layout');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

/** The layout around a page, drawn; or the address it redirected to. */
async function open(): Promise<string | null> {
  let tree: ReactNode;
  try {
    tree = await DashboardLayout({ children: <p>Page content</p> });
  } catch (err) {
    const match = /^NEXT_REDIRECT (.+)$/.exec((err as Error).message);
    if (match) return match[1];
    throw err;
  }
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {tree}
      </NextIntlClientProvider>,
    );
  });
  return null;
}

const band = () => container.querySelector('[role="status"]');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  profile = { organization_id: 'org1', onboarding_completed: true, role: 'admin' };
  org = {
    plan: 'starter',
    subscription_status: 'active',
    plan_overrides: null,
    stripe_subscription_id: 'sub_1',
  };
  orgError = null;
  owner = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe('the dashboard layout', () => {
  it('draws the page with no band while the plan is active', async () => {
    expect(await open()).toBeNull();
    expect(container.textContent).toContain('Page content');
    expect(band()).toBeNull();
  });

  it('opens read-only for an admin whose plan ended, with the band and See plans', async () => {
    org = { ...org, subscription_status: 'canceled' };
    expect(await open()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Page content');
    expect(band()?.textContent).toContain(
      'Your workspace is read-only. You can look around; adding, running and AI need a plan.',
    );
    expect(band()?.querySelector('button')?.textContent).toBe('See plans');
  });

  it('opens read-only for another member, naming the admin to ask', async () => {
    profile = { ...profile, role: 'analyst' };
    org = { ...org, subscription_status: 'past_due' };
    owner = { full_name: 'Jane Owner' };
    expect(await open()).toBeNull();
    expect(container.textContent).toContain('Page content');
    expect(band()?.textContent).toContain(
      'Ask Jane Owner, your workspace admin, to update the payment method.',
    );
    expect(band()?.textContent).toContain("Your last payment didn't go through");
    expect(band()?.querySelector('button')).toBeNull();
  });

  it("sends an admin of a new account that never subscribed to onboarding's plan step", async () => {
    org = { ...org, subscription_status: 'incomplete', stripe_subscription_id: null };
    expect(await open()).toBe('/dashboard/onboarding');
  });

  it('neither redirects nor locks when the organization could not be read', async () => {
    org = null;
    orgError = { message: 'canceling statement due to statement timeout' };
    expect(await open()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Page content');
    expect(band()).toBeNull();
  });

  it('sends anyone who has not finished onboarding to it', async () => {
    profile = { ...profile, onboarding_completed: false };
    expect(await open()).toBe('/dashboard/onboarding');
  });

  it('never locks self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    org = { ...org, subscription_status: 'canceled', stripe_subscription_id: null };
    expect(await open()).toBeNull();
    expect(container.textContent).toContain('Page content');
    expect(band()).toBeNull();
  });
});
