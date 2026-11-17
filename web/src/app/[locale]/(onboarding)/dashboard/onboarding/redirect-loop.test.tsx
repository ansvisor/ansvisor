import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/**
 * No redirect loop between the dashboard's layout, the two onboarding
 * layouts and the onboarding page, whatever the workspace's plan, its setup
 * and the person's onboarding: a visit follows each redirect (the layouts'
 * redirect(), the page's router.push) until a page opens, and must settle
 * within a few hops. And an admin can always open Billing: with a plan that
 * lapsed, before setup was finished or after, it opens read-only.
 *
 * One workspace (`ws`) answers every read: the layouts' (server session) and
 * the page's (browser session).
 */

interface Workspace {
  profile: {
    organization_id: string | null;
    onboarding_completed: boolean;
    role: string;
    /** Menu access (00374): the person's own exceptions and work areas. */
    menu_hidden?: string[];
    work_areas?: string[];
    work_areas_asked_at?: string;
  } | null;
  org: {
    subscription_status: string | null;
    stripe_subscription_id: string | null;
    plan: string;
    name: string;
  } | null;
  /** The organization's own brands: each with its competitors and runs. */
  brands: { id: string; isActive: boolean; competitors: number; runs: number; prompts: boolean }[];
  /** The organization's demo brand. */
  demo: boolean;
  /** The setup-deferred cookie ("Manage your plan"). */
  deferred: boolean;
  /** The sections the person's role leaves off its menu (organization_menu_roles). */
  roleHidden?: string[];
}
const ws = vi.hoisted(() => ({ current: null as unknown as Workspace }));

/** A query that answers however it ends (single, maybeSingle, limit, or awaited). */
function query(answer: () => { data: unknown; error?: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'insert']) q[m] = () => q;
  q.single = async () => answer();
  q.maybeSingle = async () => answer();
  q.then = (resolve: (v: unknown) => unknown) => resolve(answer());
  return q;
}

/** Both sessions read the same workspace. Brand rows by the filter on is_demo. */
function client() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'ada@example.com' } } }) },
    rpc: async (fn: string) =>
      fn === 'org_brand_count'
        ? { data: ws.current.brands.length, error: null }
        : { data: null, error: null },
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const own = () => ws.current.brands;
      const answer = (): { data: unknown; error?: unknown } => {
        const w = ws.current;
        const brandId = filters.find(([c]) => c === 'brand_id')?.[1];
        const brand = own().find((b) => b.id === brandId);
        switch (table) {
          case 'profiles':
            return { data: w.profile, error: null };
          case 'organizations':
            return w.org
              ? { data: w.org, error: null }
              : { data: null, error: { message: 'none' } };
          case 'brands':
            if (filters.some(([c, v]) => c === 'is_demo' && v === true)) {
              return { data: w.demo ? [{ id: 'demo' }] : [], error: null };
            }
            return {
              data: own().map((b) => ({
                id: b.id,
                is_active: b.isActive,
                organization_id: 'org1',
                name: 'Acme',
                slug: 'acme',
                brand_domains: [],
              })),
              error: null,
            };
          case 'prompt_sets':
            return { data: brand?.prompts ? [{ id: 's1' }] : [], error: null };
          case 'competitors':
            return {
              data: Array.from({ length: brand?.competitors ?? 0 }, () => ({})),
              error: null,
            };
          case 'tracking_runs':
            return { data: Array.from({ length: brand?.runs ?? 0 }, () => ({})), error: null };
          case 'organization_menu_roles':
            return { data: { hidden_sections: w.roleHidden ?? [] }, error: null };
          default:
            return { data: null, error: null };
        }
      };
      const q = query(answer);
      q.eq = (column: string, value: unknown) => {
        filters.push([column, value]);
        return q;
      };
      return q;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => client() }));
vi.mock('next/headers', async (original) => ({
  ...(await original<typeof import('next/headers')>()),
  cookies: async () => ({
    get: (name: string) =>
      name === 'ansvisor_setup_deferred' && ws.current.deferred ? { name, value: '1' } : undefined,
  }),
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));
const stable = vi.hoisted(() => ({
  router: { push: (to: string) => void to, replace: () => {}, refresh: () => {} },
  store: { addBrand: () => {}, setActiveBrand: () => {}, updateBrand: () => {} },
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => stable.router,
  usePathname: () => '/dashboard',
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/stores/use-brand-store', () => ({ useBrandStore: () => stable.store }));
vi.mock('@/lib/signup-event', () => ({ sendSignupEventOnce: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

// The dashboard's own parts: what the layout draws is not under test here.
const none = () => null;
const pass = ({ children }: { children: ReactNode }) => <>{children}</>;
vi.mock('@/components/layout/sidebar', () => ({ Sidebar: none }));
vi.mock('@/components/layout/sidebar-error-boundary', () => ({ SidebarErrorBoundary: pass }));
vi.mock('@/components/layout/mobile-nav', () => ({ MobileNav: none }));
vi.mock('@/components/layout/tracking-job-handoff', () => ({ TrackingJobHandoff: none }));
vi.mock('@/components/layout/first-run-ready', () => ({ FirstRunReady: none }));
vi.mock('@/components/chat/panel/chat-side-panel', () => ({ ChatSidePanel: none }));
vi.mock('@/components/chat/panel/chat-side-panel-slot', () => ({ ChatSidePanelSlot: none }));
vi.mock('@/lib/chat/legacy-import', () => ({ importLegacyChats: vi.fn() }));
vi.mock('@/lib/actions/chat-tour', () => ({
  showTourTopic: vi.fn(),
  endChatTour: vi.fn(),
  prepareChatTour: vi.fn(),
}));
vi.mock('@/lib/actions/chat-prefs', () => ({ saveChatPanelSize: vi.fn() }));
vi.mock('@/lib/chat/key', () => ({ chatRunsOnOwnKey: vi.fn(async () => false) }));
vi.mock('@/lib/chat/key-health', () => ({ failingKeyFor: vi.fn(async () => null) }));
vi.mock('@/lib/chat/skills/store', () => ({ skillMenuFor: vi.fn(async () => []) }));
vi.mock('@/components/providers/auth-provider', () => ({ AuthProvider: none }));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  AiUsageProvider: pass,
  useAiUsage: () => ({ usage: null, refresh: () => {} }),
}));
vi.mock('@/components/ai-usage/get-more', () => ({ GetMoreProvider: pass }));
vi.mock('@/components/providers/brand-loader', () => ({ BrandLoader: none }));
vi.mock('@/components/providers/brand-guard', () => ({ BrandGuard: pass }));
vi.mock('@/components/getting-started/page-opened', () => ({ GettingStartedPageOpened: none }));
vi.mock('@/components/auth/onboarding-sign-out-button', () => ({
  OnboardingSignOutButton: none,
}));
vi.mock('@/components/theme/new-user-theme', () => ({ NewUserTheme: none }));

// The page's server actions and setup suggestions: their own tests.
vi.mock('@/lib/actions/brand', () => ({
  getBrands: async () =>
    ws.current.brands
      .map((b) => ({ id: b.id, isActive: b.isActive, isDemo: false }))
      .concat(ws.current.demo ? [{ id: 'demo', isActive: true, isDemo: true }] : []),
  getBrandById: vi.fn(),
  createBrand: vi.fn(),
  markBrandAsEcommerce: vi.fn(),
}));
vi.mock('@/lib/actions/topic', () => ({
  getTopics: vi.fn(async () => [{ id: 't1', name: 'Coffee' }]),
  createTopics: vi.fn(),
}));
vi.mock('@/lib/actions/competitor', () => ({
  getCompetitors: vi.fn(async () => []),
  addCompetitor: vi.fn(),
}));
vi.mock('@/lib/actions/prompt', () => ({
  getPromptCapacity: vi.fn(async () => ({ maxPrompts: 50, used: 0 })),
  getTrackedPromptCount: vi.fn(async () => 10),
  savePromptSet: vi.fn(),
}));
vi.mock('@/lib/actions/tracking', () => ({ triggerTrackingCheck: vi.fn() }));
vi.mock('@/lib/actions/setup-after-purchase', () => ({ finishSetupAfterPurchase: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ bootstrapBrandVolumes: vi.fn() }));
vi.mock('@/lib/demo/demo-client', () => ({
  prepareDemoBrand: vi.fn(async () => ({ ok: false, status: 0 })),
  demoPreparation: () => null,
  setDemoHidden: vi.fn(),
}));
vi.mock('@/lib/ai-brand-setup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai-brand-setup')>()),
  suggestTopics: vi.fn(() => new Promise(() => {})),
  generatePromptsFromTopics: vi.fn(() => new Promise(() => {})),
  suggestCompetitors: vi.fn(() => new Promise(() => {})),
  detectSiteType: vi.fn(async () => ({ siteType: null, industry: null })),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), setPersonProperties: vi.fn() }));
vi.mock('@/components/onboarding/onboarding-frame', () => ({
  OnboardingFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/onboarding/dashboard-preview', () => ({ DashboardPreview: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: DashboardLayout } = await import('../../../(dashboard)/layout');
const { default: OnboardingLayout } = await import('../../layout');
const { default: OnboardingWizardLayout } = await import('./layout');
const { default: OnboardingPage } = await import('./page');
const { default: DashboardIndexPage } = await import('../../../(dashboard)/dashboard/page');
const { default: ActionCenterPage } =
  await import('../../../(dashboard)/dashboard/action-center/page');
const { setupLanding } = await import('@/lib/onboarding/setup-after-purchase');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ trialAvailable: true, trialDays: 14 })),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A server layout's redirect, or null when it lets the page through. */
async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    const match = /^NEXT_REDIRECT (.+)$/.exec((err as Error).message);
    if (match) return match[1];
    throw err;
  }
}

/** The onboarding page drawn: where it sends the person on, or null when it opens a step. */
async function pageGoesTo(): Promise<string | null> {
  const pushed: string[] = [];
  vi.spyOn(stable.router, 'push').mockImplementation((to: string) => {
    pushed.push(to);
  });
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <OnboardingPage />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
  await act(async () => {});
  return pushed[0] ?? null;
}

type Settled = { at: 'dashboard'; hops: string[] } | { at: 'onboarding'; hops: string[] };

/** Follows a visit to `path` through every redirect until a page opens; throws on a loop. */
async function visit(path: string): Promise<Settled> {
  const hops: string[] = [];
  let at = path;
  for (let i = 0; i < 6; i += 1) {
    hops.push(at);
    if (at === '/dashboard/onboarding') {
      const to =
        (await redirectOf(() => OnboardingLayout({ children: null }))) ??
        (await redirectOf(() => OnboardingWizardLayout({ children: null }))) ??
        (await pageGoesTo());
      if (!to) return { at: 'onboarding', hops };
      at = to;
    } else {
      const to = await redirectOf(() => DashboardLayout({ children: <p>Page</p> }));
      if (!to) return { at: 'dashboard', hops };
      at = to;
    }
  }
  throw new Error(`Redirect loop: ${hops.join(' → ')}`);
}

const BILLING = '/dashboard/settings/billing';
const text = () => container.textContent ?? '';

/** A workspace, as the cases set it up. */
function workspace(over: Partial<Workspace> & { status?: string | null; subscribed?: boolean }) {
  const { status = 'active', subscribed = true, ...rest } = over;
  ws.current = {
    profile: { organization_id: 'org1', onboarding_completed: true, role: 'admin' },
    org: {
      subscription_status: status,
      stripe_subscription_id: subscribed ? 'sub_1' : null,
      plan: 'growth',
      name: 'Acme',
    },
    brands: [],
    demo: false,
    deferred: false,
    ...rest,
  };
}

// Where setup stands: due (no brand of its own), left part-way at its
// competitors (the brand and its prompts saved), or finished (tracked).
const SETUPS = {
  due: [],
  unfinished: [{ id: 'b1', isActive: true, competitors: 0, runs: 0, prompts: true }],
  finished: [{ id: 'b1', isActive: true, competitors: 2, runs: 3, prompts: true }],
} as const;
const LAPSED = ['past_due', 'unpaid', 'canceled', 'incomplete_expired', 'incomplete', 'paused'];

describe('no redirect loop, and Billing always opens', () => {
  const lapsedCases = LAPSED.flatMap((status) =>
    (Object.keys(SETUPS) as (keyof typeof SETUPS)[]).flatMap((setup) =>
      [true, false].map((onboarded) => ({ status, setup, onboarded })),
    ),
  );

  it.each(lapsedCases)(
    'a plan $status after a subscription, setup $setup, onboarded $onboarded: read-only dashboard, Billing included',
    async ({ status, setup, onboarded }) => {
      workspace({
        status,
        brands: [...SETUPS[setup]],
        profile: { organization_id: 'org1', onboarding_completed: onboarded, role: 'admin' },
      });
      expect(await visit(BILLING)).toEqual({ at: 'dashboard', hops: [BILLING] });
      expect((await visit('/dashboard')).at).toBe('dashboard');
      // Onboarding opened by hand sends them back to the dashboard, once.
      const fromOnboarding = await visit('/dashboard/onboarding');
      expect(fromOnboarding.at).toBe('dashboard');
      expect(fromOnboarding.hops).toHaveLength(2);
    },
  );

  it.each(['manager', 'analyst'])(
    'a %s of a workspace whose plan lapsed before setup was finished: read-only dashboard',
    async (role) => {
      workspace({
        status: 'canceled',
        brands: [...SETUPS.unfinished],
        profile: { organization_id: 'org1', onboarding_completed: false, role },
      });
      expect((await visit('/dashboard')).at).toBe('dashboard');
      expect((await visit('/dashboard/onboarding')).at).toBe('dashboard');
    },
  );

  it.each([true, false])(
    'a plan on with setup due (onboarded %s): setup, at its first step, and it stays there',
    async (onboarded) => {
      workspace({
        status: 'trialing',
        profile: { organization_id: 'org1', onboarding_completed: onboarded, role: 'admin' },
      });
      const settled = await visit('/dashboard');
      expect(settled).toEqual({ at: 'onboarding', hops: ['/dashboard', '/dashboard/onboarding'] });
      expect(text()).toContain('Set up your brand');
    },
  );

  it.each([true, false])(
    'a plan on with setup left part-way (onboarded %s): setup resumes where it stopped',
    async (onboarded) => {
      workspace({
        status: 'active',
        brands: [...SETUPS.unfinished],
        profile: { organization_id: 'org1', onboarding_completed: onboarded, role: 'admin' },
      });
      expect((await visit('/dashboard')).at).toBe('onboarding');
      expect(text()).toContain('Add your competitors');
      // Billing too, until setup is put off.
      expect((await visit(BILLING)).at).toBe('onboarding');
    },
  );

  it('a plan on with setup put off by its admin: Billing opens, and setup again once the cookie is gone', async () => {
    workspace({ status: 'trialing', deferred: true });
    expect(await visit(BILLING)).toEqual({ at: 'dashboard', hops: [BILLING] });
    // Onboarding opened by hand still opens setup.
    expect((await visit('/dashboard/onboarding')).at).toBe('onboarding');
    ws.current.deferred = false;
    expect((await visit(BILLING)).at).toBe('onboarding');
  });

  it('a plan on with setup finished: the dashboard; onboarding sends back to it', async () => {
    workspace({ status: 'active', brands: [...SETUPS.finished] });
    expect(await visit('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard'] });
    expect((await visit('/dashboard/onboarding')).at).toBe('dashboard');
  });

  it('a manager with setup due: setup; an analyst: the dashboard', async () => {
    workspace({
      status: 'active',
      profile: { organization_id: 'org1', onboarding_completed: true, role: 'manager' },
    });
    expect((await visit('/dashboard')).at).toBe('onboarding');
    ws.current.profile = { organization_id: 'org1', onboarding_completed: true, role: 'analyst' };
    expect((await visit('/dashboard')).at).toBe('dashboard');
  });

  it('never subscribed, onboarding not finished: onboarding', async () => {
    workspace({
      status: 'incomplete',
      subscribed: false,
      brands: [...SETUPS.unfinished],
      profile: { organization_id: 'org1', onboarding_completed: false, role: 'admin' },
    });
    expect((await visit('/dashboard')).at).toBe('onboarding');
    expect((await visit(BILLING)).at).toBe('onboarding');
  });

  it('never subscribed, onboarded, with its brand: the plan step', async () => {
    workspace({ status: 'incomplete', subscribed: false, brands: [...SETUPS.unfinished] });
    expect((await visit('/dashboard')).at).toBe('onboarding');
    expect(text()).toContain('Choose how to start');
    expect(text()).toContain('Ready to track for Acme');
  });

  it('never subscribed, onboarded, with the demo brand: the read-only dashboard', async () => {
    workspace({ status: 'incomplete', subscribed: false, demo: true });
    expect((await visit(BILLING)).at).toBe('dashboard');
  });

  it.each([true, false])(
    'no organization (onboarded %s): the choice, never back to the dashboard',
    async (onboarded) => {
      workspace({
        org: null,
        profile: { organization_id: null, onboarding_completed: onboarded, role: 'admin' },
      });
      expect(await visit('/dashboard')).toEqual({
        at: 'onboarding',
        hops: ['/dashboard', '/dashboard/onboarding'],
      });
      expect(text()).toContain('How do you want to start?');
    },
  );

  it('the choice made, Checkout canceled (never subscribed, no brand): the choice again', async () => {
    workspace({
      status: 'incomplete',
      subscribed: false,
      profile: { organization_id: 'org1', onboarding_completed: false, role: 'admin' },
    });
    expect((await visit(BILLING)).at).toBe('onboarding');
    expect(text()).toContain('How do you want to start?');
  });

  it('the sample brand explored from the choice: its read-only dashboard; the choice by hand', async () => {
    workspace({ status: 'incomplete', subscribed: false, demo: true });
    expect((await visit('/dashboard')).at).toBe('dashboard');
    expect((await visit('/dashboard/onboarding')).at).toBe('onboarding');
    expect(text()).toContain('How do you want to start?');
  });

  it.each(['canceled', 'past_due'])(
    'the trial from the choice %s before Finish, with no brand: read-only dashboard, Billing included',
    async (status) => {
      workspace({
        status,
        profile: { organization_id: 'org1', onboarding_completed: false, role: 'admin' },
      });
      expect(await visit(BILLING)).toEqual({ at: 'dashboard', hops: [BILLING] });
      expect((await visit('/dashboard/onboarding')).at).toBe('dashboard');
    },
  );

  it('an organization that could not be read: no loop', async () => {
    workspace({ org: null });
    expect((await visit('/dashboard')).at).toBe('dashboard');
    ws.current.profile = { organization_id: 'org1', onboarding_completed: false, role: 'admin' };
    expect((await visit('/dashboard')).at).toBe('onboarding');
  });

  it('self-hosted: onboarding until it is finished, then the dashboard', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    workspace({
      status: 'canceled',
      brands: [...SETUPS.unfinished],
      profile: { organization_id: 'org1', onboarding_completed: false, role: 'admin' },
    });
    expect((await visit('/dashboard')).at).toBe('onboarding');
    ws.current.profile = { organization_id: 'org1', onboarding_completed: true, role: 'admin' };
    expect((await visit('/dashboard')).at).toBe('dashboard');
  });
});

/** The pages that only send on: the dashboard's index and the Action Center's. */
const SENDS_ON: Record<string, (query: URLSearchParams) => unknown> = {
  '/dashboard': (query) =>
    DashboardIndexPage({ searchParams: Promise.resolve(Object.fromEntries(query)) }),
  '/dashboard/action-center': () => ActionCenterPage(),
};

/** As `visit`, then the page that opens: the index and the Action Center send on. */
async function land(path: string): Promise<Settled> {
  const hops: string[] = [];
  let at = path;
  for (let i = 0; i < 6; i += 1) {
    const settled = await visit(at);
    hops.push(...settled.hops);
    const url = new URL(settled.hops.at(-1)!, 'http://localhost');
    const page = settled.at === 'dashboard' ? SENDS_ON[url.pathname] : undefined;
    const to = page ? await redirectOf(async () => page(url.searchParams)) : null;
    if (!to) return { at: settled.at, hops };
    at = to;
  }
  throw new Error(`Redirect loop: ${hops.join(' → ')}`);
}

/**
 * Everyone lands on Prompts › Tracked Prompts (the owner's decision of
 * 2026-11-17), and it stays put: no layout sends anyone who just finished
 * setup back to onboarding from it. The Action Center keeps its own address.
 */
describe('the home, Prompts › Tracked Prompts', () => {
  const HOME = '/dashboard/prompts/tracked';
  // Setup just finished: competitors saved, onboarding marked completed, the
  // first run started but not in the ledger yet.
  const JUST_SET_UP = [{ id: 'b1', isActive: true, competitors: 1, runs: 0, prompts: true }];

  it('opens /dashboard on Tracked Prompts, and the Action Center on its Today tab', async () => {
    workspace({ status: 'active', brands: [...SETUPS.finished] });
    expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', HOME] });
    expect(await land('/dashboard/action-center')).toEqual({
      at: 'dashboard',
      hops: ['/dashboard/action-center', '/dashboard/action-center/today'],
    });
  });

  it.each([
    ['the trial from the choice', false],
    ['the sample brand, then a purchase', true],
  ])('%s, setup finished: Tracked Prompts with the run, and it stays there', async (_, demo) => {
    workspace({ status: 'trialing', brands: [...JUST_SET_UP], demo });
    const landing = setupLanding('job1');
    expect(landing).toBe('/dashboard?jobId=job1');
    expect(await land(landing)).toEqual({
      at: 'dashboard',
      hops: [landing, `${HOME}?jobId=job1`],
    });
    expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', HOME] });
    // Onboarding opened again sends them home, once.
    expect(await land('/dashboard/onboarding')).toEqual({
      at: 'dashboard',
      hops: ['/dashboard/onboarding', '/dashboard', HOME],
    });
  });

  it('a brand set up before the plan, back from Checkout: Tracked Prompts with the run', async () => {
    workspace({ status: 'trialing', brands: [...JUST_SET_UP] });
    expect(await land(`${HOME}?jobId=job-s`)).toEqual({
      at: 'dashboard',
      hops: [`${HOME}?jobId=job-s`],
    });
  });

  it('the sample brand explored, never subscribed: its Tracked Prompts, read-only', async () => {
    workspace({ status: 'incomplete', subscribed: false, demo: true });
    expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', HOME] });
  });

  it('a plan lapsed after a subscription: the read-only Tracked Prompts', async () => {
    workspace({ status: 'canceled', brands: [...SETUPS.finished] });
    expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', HOME] });
  });

  it('a plan on with setup due: setup first, never Tracked Prompts', async () => {
    workspace({ status: 'trialing' });
    expect(await land('/dashboard')).toEqual({
      at: 'onboarding',
      hops: ['/dashboard', '/dashboard/onboarding'],
    });
  });

  it('self-hosted, onboarding finished: Tracked Prompts', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    workspace({ status: null, brands: [...JUST_SET_UP] });
    expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', HOME] });
  });

  // Menu access: nobody lands on a page their menu doesn't show.
  describe('with Prompts off the person’s menu', () => {
    const TODAY = '/dashboard/action-center/today';
    const analyst = { organization_id: 'org1', onboarding_completed: true, role: 'analyst' };

    it('a role whose menu hides Prompts: Action Center › Today, and it stays there', async () => {
      workspace({ status: 'active', brands: [...SETUPS.finished], profile: analyst });
      ws.current.roleHidden = ['prompts', 'content'];
      expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', TODAY] });
      expect((await land('/dashboard/onboarding')).hops.at(-1)).toBe(TODAY);
    });

    it('a role whose menu keeps Prompts, or hides something else: Tracked Prompts', async () => {
      workspace({ status: 'active', brands: [...SETUPS.finished], profile: analyst });
      expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', HOME] });
      ws.current.roleHidden = ['content', 'audit'];
      expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', HOME] });
    });

    it('a person’s own exception, or an admin’s own work areas, without Prompts: Today', async () => {
      workspace({
        status: 'active',
        brands: [...SETUPS.finished],
        profile: { ...analyst, menu_hidden: ['prompts'] },
      });
      expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', TODAY] });
      // Nobody takes Prompts off an admin's menu, but their own work areas can.
      workspace({
        status: 'active',
        brands: [...SETUPS.finished],
        profile: {
          organization_id: 'org1',
          onboarding_completed: true,
          role: 'admin',
          work_areas: ['leaders'],
          work_areas_asked_at: '2026-11-12T09:00:00Z',
        },
      });
      ws.current.roleHidden = ['prompts'];
      expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', TODAY] });
      ws.current.profile!.work_areas = ['growth'];
      expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', HOME] });
    });

    it('a manager whose role hides Prompts, setup finished: Today with the run', async () => {
      workspace({
        status: 'trialing',
        brands: [...JUST_SET_UP],
        profile: { organization_id: 'org1', onboarding_completed: true, role: 'manager' },
      });
      ws.current.roleHidden = ['prompts'];
      expect(await land(setupLanding('job1'))).toEqual({
        at: 'dashboard',
        hops: ['/dashboard?jobId=job1', `${TODAY}?jobId=job1`],
      });
    });

    it('a plan lapsed: the read-only Today, no loop', async () => {
      workspace({ status: 'canceled', brands: [...SETUPS.finished], profile: analyst });
      ws.current.roleHidden = ['prompts'];
      expect(await land('/dashboard')).toEqual({ at: 'dashboard', hops: ['/dashboard', TODAY] });
    });
  });
});
