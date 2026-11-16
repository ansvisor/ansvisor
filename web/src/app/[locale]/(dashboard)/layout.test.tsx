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

// An in-memory localStorage for the brand store: the test environment has none.
vi.hoisted(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, String(value)),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
});

let profile: Record<string, unknown> | null;
let org: Record<string, unknown> | null;
let orgError: { message: string } | null;
let owner: { full_name: string | null } | null;
let chatSettings: { full_auto_for_members: boolean } | null;
let chatPrefs: Record<string, unknown> | null;
const reads: string[] = [];

// The signed-in account, as the Auth server has it: what getUser() and the
// admin API read, and where the sign-up event's claim is written.
const auth = vi.hoisted(() => ({
  account: null as Record<string, unknown> | null,
  admin: { getUserById: vi.fn(), updateUserById: vi.fn() },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { auth: { admin: auth.admin } } }));
// The work a page leaves for after its response (next/server's after()).
const later = vi.hoisted(() => ({ tasks: [] as (() => Promise<unknown>)[] }));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    later.tasks.push(task);
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: structuredClone(auth.account) } }) },
    from: (table: string) => {
      reads.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        single: async () =>
          table === 'profiles' ? { data: profile } : { data: org, error: orgError },
        maybeSingle: async () =>
          table === 'chat_settings'
            ? { data: chatSettings, error: null }
            : table === 'chat_user_prefs'
              ? { data: chatPrefs, error: null }
              : { data: owner },
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
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/demo/demo-client', () => ({
  ensureDemoBrand: vi.fn(),
  prepareDemoBrand: vi.fn(async () => ({ ok: false, status: 0 })),
  demoPreparation: () => null,
  setDemoHidden: vi.fn(),
}));

const pass = ({ children }: { children: ReactNode }) => <>{children}</>;
const none = () => null;
vi.mock('@/components/layout/sidebar', () => ({ Sidebar: none }));
vi.mock('@/components/layout/sidebar-error-boundary', () => ({ SidebarErrorBoundary: pass }));
vi.mock('@/components/layout/mobile-nav', () => ({ MobileNav: none }));
vi.mock('@/components/layout/tracking-job-handoff', () => ({ TrackingJobHandoff: none }));
vi.mock('@/components/layout/first-run-ready', () => ({ FirstRunReady: none }));
// Chat's side panel has its own tests; here, only where the layout puts it,
// the setup the layout hands it, and that its code isn't loaded with the page.
const panel = vi.hoisted(() => ({
  setup: null as Record<string, unknown> | null,
  codeLoaded: false,
}));
vi.mock('@/components/chat/panel/chat-side-panel', () => {
  panel.codeLoaded = true;
  return { ChatSidePanel: none };
});
vi.mock('@/components/chat/panel/chat-side-panel-slot', async () => {
  const { useChatPanel } = await import('@/components/chat/panel/chat-panel-context');
  return {
    ChatSidePanelSlot: () => {
      panel.setup = (useChatPanel()?.setup as unknown as Record<string, unknown>) ?? null;
      return null;
    },
  };
});
const legacy = vi.hoisted(() => ({ importLegacyChats: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/chat/legacy-import', () => legacy);
// The product tour's server actions (00486): their own tests.
vi.mock('@/lib/actions/chat-tour', () => ({
  showTourTopic: vi.fn(async () => ({ ok: false })),
  endChatTour: vi.fn(async () => ({ ok: false })),
  prepareChatTour: vi.fn(async () => undefined),
}));
vi.mock('@/lib/actions/chat-prefs', () => ({ saveChatPanelSize: vi.fn() }));
const ownKey = vi.hoisted(() => ({ chatRunsOnOwnKey: vi.fn(async () => false) }));
vi.mock('@/lib/chat/key', () => ownKey);
vi.mock('@/lib/chat/key-health', () => ({ failingKeyFor: vi.fn(async () => null) }));
vi.mock('@/lib/chat/skills/store', () => ({ skillMenuFor: vi.fn(async () => []) }));
vi.mock('@/components/providers/auth-provider', () => ({ AuthProvider: none }));
// The layout's plan dialog asks the AI usage whether the new Chat is on.
vi.mock('@/components/providers/ai-usage-provider', () => ({
  AiUsageProvider: pass,
  useAiUsage: () => ({ usage: null, refresh: () => {} }),
}));
vi.mock('@/components/ai-usage/get-more', () => ({ GetMoreProvider: pass }));
// The brands the layout hands the brand store (the store is marked loaded
// in beforeEach, as BrandLoader leaves it).
let loaded: { id: string }[] = [];
vi.mock('@/components/providers/brand-loader', () => ({
  BrandLoader: ({ brands }: { brands: { id: string }[] }) => {
    loaded = brands;
    return null;
  },
}));
vi.mock('@/components/providers/brand-guard', () => ({ BrandGuard: pass }));
vi.mock('@/components/getting-started/page-opened', () => ({ GettingStartedPageOpened: none }));
let orgBrands: { id: string; isDemo?: boolean; demoHiddenAt?: string | null }[] = [];
vi.mock('@/lib/actions/brand', () => ({
  getBrands: async () => orgBrands,
  getBrandById: vi.fn(),
}));

// The theme provider, as KeepCurrentTheme reads it: what it saves.
const themes = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => themes }));

const { default: DashboardLayout } = await import('./layout');
const { useBrandStore } = await import('@/stores/use-brand-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

/** The layout around a page, drawn; or the address it redirected to. */
async function open(page: ReactNode = <p>Page content</p>): Promise<string | null> {
  let tree: ReactNode;
  try {
    tree = await DashboardLayout({ children: page });
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
  // An account from before the welcome e-mail: no sign-up event.
  auth.account = {
    id: 'u1',
    email: 'ada@example.com',
    created_at: '2026-10-01T09:00:00Z',
    app_metadata: { provider: 'email' },
    user_metadata: { full_name: 'Ada Lovelace' },
  };
  auth.admin.getUserById.mockImplementation(async () => ({
    data: { user: structuredClone(auth.account) },
    error: null,
  }));
  auth.admin.updateUserById.mockImplementation(
    // As the Auth server does: app_metadata's keys merged, a null one removed.
    async (_id: string, { app_metadata }: { app_metadata: Record<string, unknown> }) => {
      const meta: Record<string, unknown> = { ...(auth.account!.app_metadata as object) };
      for (const [key, value] of Object.entries(app_metadata)) {
        if (value === null) delete meta[key];
        else meta[key] = value;
      }
      auth.account = { ...auth.account, app_metadata: meta };
      return { data: { user: auth.account }, error: null };
    },
  );
  later.tasks.length = 0;
  profile = { organization_id: 'org1', onboarding_completed: true, role: 'admin' };
  org = {
    plan: 'starter',
    subscription_status: 'active',
    plan_overrides: null,
    stripe_subscription_id: 'sub_1',
  };
  orgError = null;
  owner = null;
  chatSettings = null;
  chatPrefs = null;
  panel.setup = null;
  reads.length = 0;
  orgBrands = [];
  loaded = [];
  useBrandStore.setState({ loaded: true });
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

  it('scrolls a page in its main area only, which holds what the page places absolutely (2026-11-14)', async () => {
    await open();
    // jsdom lays nothing out: the classes that keep the window from scrolling.
    const shell = container.querySelector('.h-screen')!;
    expect(shell.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'overflow-hidden']));
    const main = container.querySelector('main')!;
    expect(main.getAttribute('data-slot')).toBe('dashboard-main');
    expect(main.className.split(' ')).toEqual(
      expect.arrayContaining(['relative', 'flex-1', 'overflow-y-auto']),
    );
    expect(shell.contains(main)).toBe(true);
    expect(main.textContent).toContain('Page content');
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

  it('brings Agent Chat conversations over on the first visit with the new Chat, as Chat does', async () => {
    legacy.importLegacyChats.mockClear();
    expect(await open()).toBeNull();
    expect(legacy.importLegacyChats).not.toHaveBeenCalled();
    vi.stubEnv('CHAT_AGENTIC', 'true');
    expect(await open()).toBeNull();
    expect(legacy.importLegacyChats).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', organizationId: profile!.organization_id }),
    );
  });

  it("offers the panel's composer Full auto only where the server runs it", async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    org = { ...org, plan: 'growth' };
    chatPrefs = { default_mode: 'full_auto', legacy_imported_at: '2026-10-30T09:00:00.000Z' };
    // A member, with the Admin's "Full auto for members" off: closed, and said why.
    profile = { ...profile, role: 'manager' };
    chatSettings = { full_auto_for_members: false };
    expect(await open()).toBeNull();
    expect(panel.setup).toMatchObject({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: true,
    });
    // The Admin, whatever the switch says.
    profile = { ...profile, role: 'admin' };
    expect(await open()).toBeNull();
    expect(panel.setup).toMatchObject({
      defaultMode: 'full_auto',
      fullAutoOpen: true,
      fullAutoOffByAdmin: false,
    });
    // A member with no settings row: the default, open.
    profile = { ...profile, role: 'manager' };
    chatSettings = null;
    expect(await open()).toBeNull();
    expect(panel.setup).toMatchObject({ fullAutoOpen: true, fullAutoOffByAdmin: false });
  });

  it("keeps the panel's composer on at the AI limit when Chat runs on the workspace's own key", async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    chatPrefs = { legacy_imported_at: '2026-10-30T09:00:00.000Z' };
    ownKey.chatRunsOnOwnKey.mockResolvedValueOnce(true);
    expect(await open()).toBeNull();
    expect(panel.setup).toMatchObject({ onOwnKey: true });
    expect(ownKey.chatRunsOnOwnKey).toHaveBeenCalledWith('org1');
  });

  it('reads nothing of Chat and draws no panel while the new Chat is off', async () => {
    expect(await open()).toBeNull();
    expect(panel.setup).toBeNull();
    expect(reads.filter((table) => table.startsWith('chat_'))).toEqual([]);
    expect(ownKey.chatRunsOnOwnKey).not.toHaveBeenCalled();
    // The panel's own code (thread, composer, runs) isn't part of the layout's.
    expect(panel.codeLoaded).toBe(false);
    expect(container.querySelector('[data-action="panel.open"]')).toBeNull();
  });

  it('never locks self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    org = { ...org, subscription_status: 'canceled', stripe_subscription_id: null };
    expect(await open()).toBeNull();
    expect(container.textContent).toContain('Page content');
    expect(band()).toBeNull();
  });
});

describe('the dashboard layout and the demo brand', () => {
  it('lists the demo brand with the others', async () => {
    orgBrands = [{ id: 'b1' }, { id: 'demo', isDemo: true, demoHiddenAt: null }];
    expect(await open()).toBeNull();
    expect(loaded.map((b) => b.id)).toEqual(['b1', 'demo']);
  });

  it('leaves a hidden demo brand out of the brand list', async () => {
    orgBrands = [{ id: 'b1' }, { id: 'demo', isDemo: true, demoHiddenAt: '2026-10-28T00:00:00Z' }];
    expect(await open()).toBeNull();
    expect(loaded.map((b) => b.id)).toEqual(['b1']);
  });

  it('lets an admin who never subscribed explore the demo brand instead of the plan step', async () => {
    org = { ...org, subscription_status: null, stripe_subscription_id: null };
    orgBrands = [{ id: 'b1' }, { id: 'demo', isDemo: true, demoHiddenAt: null }];
    expect(await open()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Page content');
    // Read-only on the own brand, with its free trial and the way to the demo.
    expect(band()?.textContent).toContain(
      "Your brand isn't tracked yet. Start a 14-day free trial, or get 50% off your first month.",
    );
    expect([...band()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'See plans',
      'See the demo',
    ]);
  });
});

describe('the dashboard layout and the theme', () => {
  beforeEach(() => window.localStorage.removeItem('theme'));
  afterEach(() => window.localStorage.removeItem('theme'));

  it('keeps someone who already uses Ansvisor on light, the theme they see, on Cloud', async () => {
    expect(await open()).toBeNull();
    expect(themes.setTheme).toHaveBeenCalledTimes(1);
    expect(themes.setTheme).toHaveBeenCalledWith('light');
  });

  // Dark: what a new person got on sign-up, sign-in or onboarding. Either: a picked one.
  it.each(['dark', 'light'])('keeps a saved theme (%s)', async (saved) => {
    window.localStorage.setItem('theme', saved);
    expect(await open()).toBeNull();
    expect(themes.setTheme).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('theme')).toBe(saved);
  });

  it('saves nothing on the way to onboarding, where a new person starts on dark', async () => {
    profile = { ...profile, onboarding_completed: false };
    expect(await open()).toBe('/dashboard/onboarding');
    expect(themes.setTheme).not.toHaveBeenCalled();
  });

  it('saves nothing self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await open()).toBeNull();
    expect(themes.setTheme).not.toHaveBeenCalled();
  });
});

describe('the dashboard layout and the sign-up event', () => {
  const resend = vi.fn();
  /** The sign-up events sent to Resend. */
  const sent = () =>
    resend.mock.calls
      .filter(([url]) => url === 'https://api.resend.com/events/send')
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
  /** The events sent to PostHog. */
  const captured = () =>
    resend.mock.calls
      .filter(([url]) => url === 'https://eu.i.posthog.com/capture/')
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
  /**
   * The page's after() work, as Next runs it once the response is sent, with
   * the claim's wait (lib/signup-event.ts) run through.
   */
  async function runLater(tasks = later.tasks.splice(0)) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const done = Promise.all(tasks.map((task) => task()));
      await vi.runAllTimersAsync();
      await done;
    } finally {
      vi.useRealTimers();
    }
  }

  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    resend.mockReset().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', resend);
    // A new account: e-mail and password, made after the welcome e-mail started.
    auth.account = { ...auth.account, created_at: '2026-11-13T09:00:00Z' };
    profile = { organization_id: null, onboarding_completed: false, role: 'admin' };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends an e-mail sign-up's event once, from its first page, on the way to onboarding", async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
    expect(await open()).toBe('/dashboard/onboarding');
    // Queued before the redirect: Next runs after() work once that response
    // closes (lib/signup-event.ts).
    expect(later.tasks).toHaveLength(1);
    expect(sent()).toEqual([]);
    await runLater();
    expect(sent()).toEqual([
      { event: 'user.signed_up', email: 'ada@example.com', payload: { first_name: 'Ada' } },
    ]);
    // PostHog's signed_up from the same claim.
    expect(captured()).toEqual([
      expect.objectContaining({
        event: 'signed_up',
        distinct_id: 'u1',
        properties: expect.objectContaining({ source: 'email' }),
      }),
    ]);
    expect(auth.account!.app_metadata).toMatchObject({
      signup_event_at: expect.any(String),
      signup_posthog_at: expect.any(String),
    });

    // The next page, onboarded or not: nothing more, and no read for it.
    auth.admin.getUserById.mockClear();
    expect(await open()).toBe('/dashboard/onboarding');
    profile = { organization_id: 'org1', onboarding_completed: true, role: 'admin' };
    expect(await open()).toBeNull();
    await runLater();
    expect(sent()).toHaveLength(1);
    expect(captured()).toHaveLength(1);
    expect(auth.admin.getUserById).not.toHaveBeenCalled();
  });

  it('sends it once for pages drawn at the same time, or with a session read before the claim', async () => {
    await open();
    await open();
    await runLater();
    expect(sent()).toHaveLength(1);

    // Another server's page, its session read before this one claimed it.
    auth.account = { ...auth.account, app_metadata: { provider: 'email' } };
    await open();
    const first = later.tasks.splice(0);
    await open();
    await runLater(first);
    await runLater();
    expect(sent()).toHaveLength(2);
  });

  it('tries again from a later page when Resend refuses it (a 4xx), up to 3 tries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resend.mockResolvedValueOnce({ ok: false, status: 422 });
    await open();
    await runLater();
    expect(auth.account!.app_metadata).toMatchObject({ signup_event_tries: 1 });
    expect(auth.account!.app_metadata).not.toHaveProperty('signup_event_at');

    resend.mockResolvedValueOnce({ ok: false, status: 429 });
    await open();
    await runLater();
    await open();
    await runLater();
    expect(sent()).toHaveLength(3);
    expect(auth.account!.app_metadata).toMatchObject({
      signup_event_at: expect.any(String),
      signup_event_tries: 3,
    });
    await open();
    await runLater();
    expect(sent()).toHaveLength(3);
    vi.mocked(console.error).mockRestore();
  });

  it('keeps the claim when Resend may have the event: a timeout, a network error or a 5xx', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const answers = [
      () =>
        resend.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError')),
      () => resend.mockRejectedValueOnce(new TypeError('fetch failed')),
      () => resend.mockResolvedValueOnce({ ok: false, status: 500 }),
      () => resend.mockResolvedValueOnce({ ok: false, status: 503 }),
    ];
    for (const [n, answer] of answers.entries()) {
      // A new account each time.
      auth.account = { ...auth.account, app_metadata: { provider: 'email' } };
      answer();
      await open();
      await runLater();
      expect(sent()).toHaveLength(n + 1);
      expect(auth.account!.app_metadata).toMatchObject({
        signup_event_at: expect.any(String),
        signup_event_tries: 1,
      });
      // The next page sends no second welcome.
      await open();
      await runLater();
      expect(sent()).toHaveLength(n + 1);
    }
    vi.mocked(console.warn).mockRestore();
  });

  it('claims nothing for the welcome where the web has no RESEND_API_KEY', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    await open();
    await runLater();
    expect(sent()).toEqual([]);
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('never sends it for an account made before the welcome e-mail started', async () => {
    auth.account = { ...auth.account, created_at: '2026-11-12T20:59:59Z' };
    expect(await open()).toBe('/dashboard/onboarding');
    await runLater();
    expect(sent()).toEqual([]);
    expect(auth.admin.getUserById).not.toHaveBeenCalled();
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("sends a Google or GitHub sign-up's event once too", async () => {
    auth.account = {
      ...auth.account,
      created_at: new Date(Date.now() - 5_000).toISOString(),
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { name: 'Grace Hopper' },
    };
    await open();
    await runLater();
    await open();
    await runLater();
    expect(sent()).toEqual([
      { event: 'user.signed_up', email: 'ada@example.com', payload: { first_name: 'Grace' } },
    ]);
  });

  it('draws the page whatever the send does', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    profile = { organization_id: 'org1', onboarding_completed: true, role: 'admin' };
    resend.mockRejectedValueOnce(new Error('Resend down'));
    expect(await open()).toBeNull();
    expect(container.textContent).toContain('Page content');
    await expect(runLater()).resolves.toBeUndefined();

    auth.account = { ...auth.account, app_metadata: { provider: 'email' } };
    auth.admin.getUserById.mockRejectedValueOnce(new Error('Auth down'));
    expect(await open()).toBeNull();
    expect(container.textContent).toContain('Page content');
    await expect(runLater()).resolves.toBeUndefined();
    vi.mocked(console.error).mockRestore();
    vi.mocked(console.warn).mockRestore();
  });
});
