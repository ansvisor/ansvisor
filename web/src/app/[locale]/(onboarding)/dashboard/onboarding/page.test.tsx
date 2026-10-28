import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/**
 * Onboarding's suggestions once the day's setup suggestions are used up
 * (429 onboarding_daily_limit): each step says so, and says how to go on,
 * with no Try again; any other failure keeps Try again. The wizard resumes on
 * a brand already created, so the steps are reached without walking them.
 */

/** The brand's rows the resume reads; prompt sets decide step 3 or step 5. */
const db = vi.hoisted(() => ({
  promptSets: [] as { id: string }[],
  // Onboarded already, with no active plan: the resume opens the plan step.
  onboarded: false,
  // The filters each brands read was made with.
  brandFilters: [] as [string, unknown][][],
  // The organization has its demo brand already.
  hasDemo: false,
}));
vi.mock('@/lib/supabase/client', () => {
  /** A query that answers `data` however it ends (single, limit, or awaited). */
  const query = (read: () => unknown, filters?: [string, unknown][]) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'limit', 'order', 'update']) q[m] = () => q;
    q.eq = (column: string, value: unknown) => {
      filters?.push([column, value]);
      return q;
    };
    q.single = async () => ({ data: read() });
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: read() });
    return q;
  };
  /** The demo brand, for a read that asks for it. */
  const demoRows = (filters: [string, unknown][]) =>
    filters.some(([column, value]) => column === 'is_demo' && value === true)
      ? db.hasDemo
        ? [{ id: 'demo' }]
        : []
      : null;
  const rows: Record<string, () => unknown> = {
    profiles: () => ({ organization_id: 'org-1', onboarding_completed: db.onboarded }),
    brands: () => [
      {
        id: 'b1',
        organization_id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        brand_domains: [{ id: 'd1', brand_id: 'b1', domain: 'acme.com', is_primary: true }],
      },
    ],
    prompt_sets: () => db.promptSets,
  };
  return {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (table: string) => {
        const filters: [string, unknown][] = [];
        if (table === 'brands') db.brandFilters.push(filters);
        return query(
          () => (table === 'brands' ? demoRows(filters) : null) ?? rows[table]?.() ?? null,
          filters,
        );
      },
    }),
  };
});
const prepareDemoBrand = vi.hoisted(() => vi.fn(async () => ({ ok: false, status: 0 })));
vi.mock('@/lib/demo/demo-client', () => ({
  prepareDemoBrand,
  demoPreparation: () => null,
  setDemoHidden: vi.fn(),
}));
vi.mock('@/lib/actions/topic', () => ({
  getTopics: vi.fn(async () => [{ id: 't1', name: 'Coffee' }]),
  createTopics: vi.fn(async () => undefined),
}));
vi.mock('@/lib/actions/competitor', () => ({
  getCompetitors: vi.fn(async () => []),
  addCompetitor: vi.fn(),
}));
vi.mock('@/lib/actions/brand', () => ({ createBrand: vi.fn(), markBrandAsEcommerce: vi.fn() }));
vi.mock('@/lib/actions/prompt', () => ({
  getPromptCapacity: vi.fn(async () => ({ maxPrompts: 50, used: 0 })),
  savePromptSet: vi.fn(),
}));
vi.mock('@/lib/actions/tracking', () => ({ triggerTrackingCheck: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ bootstrapBrandVolumes: vi.fn() }));
const setup = vi.hoisted(() => ({
  suggestTopics: vi.fn(),
  generatePromptsFromTopics: vi.fn(),
  suggestCompetitors: vi.fn(),
}));
vi.mock('@/lib/ai-brand-setup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai-brand-setup')>()),
  ...setup,
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), setPersonProperties: vi.fn() }));
// The effects depend on these: the same ones every render.
const stable = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, refresh: () => {} },
  store: { addBrand: () => {}, setActiveBrand: () => {}, updateBrand: () => {} },
}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => stable.router }));
vi.mock('@/stores/use-brand-store', () => ({ useBrandStore: () => stable.store }));
vi.mock('@/components/onboarding/onboarding-frame', () => ({
  OnboardingFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/onboarding/dashboard-preview', () => ({ DashboardPreview: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: OnboardingPage } = await import('./page');
const { SetupDailyLimitError } = await import('@/lib/ai-brand-setup');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.promptSets = [];
  db.onboarded = false;
  db.brandFilters = [];
  db.hasDemo = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <OnboardingPage />
      </NextIntlClientProvider>,
    );
  });
  // The resume reads, then the step's own suggestions.
  await act(async () => {});
  await act(async () => {});
}

const text = () => container.textContent ?? '';
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);

describe('setup suggestions used up for the day', () => {
  it('says so on the competitors step, with no Try again', async () => {
    db.promptSets = [{ id: 's1' }];
    setup.suggestCompetitors.mockRejectedValue(new SetupDailyLimitError('limit'));
    await render();
    expect(setup.suggestCompetitors).toHaveBeenCalledOnce();
    expect(text()).toContain(
      'Setup suggestions are used up for today. Try again tomorrow, or add your own.',
    );
    expect(text()).not.toContain("Couldn't fetch competitor suggestions");
    expect(button('Try again')).toBeUndefined();
  });

  it('keeps Try again for any other failure', async () => {
    db.promptSets = [{ id: 's1' }];
    setup.suggestCompetitors.mockRejectedValue(new Error('Server error: 500'));
    await render();
    expect(text()).toContain("Couldn't fetch competitor suggestions right now");
    expect(button('Try again')).toBeDefined();
  });

  it('says on the prompts step to add your own to each topic to continue', async () => {
    setup.generatePromptsFromTopics.mockRejectedValue(new SetupDailyLimitError('limit'));
    await render();
    await act(async () => button('Looks good')!.click());
    expect(setup.generatePromptsFromTopics).toHaveBeenCalledOnce();
    expect(text()).toContain(
      'Setup suggestions are used up for today. Add your own prompts to each topic below to continue.',
    );
    expect(text()).not.toContain("Couldn't generate prompt suggestions");
  });
});

describe('the plan step', () => {
  // The trial check, and Checkout's answer.
  const trialAvailable = { value: true };
  const fetchMock = vi.fn(async (url: string) =>
    url === '/api/stripe/trial'
      ? Response.json({ trialAvailable: trialAvailable.value, trialDays: 14 })
      : Response.json({ url: '#checkout' }),
  );
  /** What was sent to Checkout. */
  const checkoutBody = () =>
    JSON.parse(
      (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(
        ([url]) => url === '/api/stripe/checkout',
      )![1].body as string,
    );
  const modeButtons = (mode: 'buy' | 'trial') => [
    ...container.querySelectorAll<HTMLButtonElement>(`[data-mode="${mode}"]`),
  ];
  const slots = (slot: string) =>
    [...container.querySelectorAll(`[data-slot="${slot}"]`)].map((el) => el.textContent);

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    trialAvailable.value = true;
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    db.onboarded = true;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('offers the demo brand under the plans, for someone not ready to add a card', async () => {
    db.onboarded = true;
    await render();
    expect(text()).toContain('One last step');
    const card = container.querySelector('[data-slot="explore-demo"]')!;
    expect(card.textContent).toContain('Not ready to add a card? Explore a demo brand');
    // The own brand, read without the demo brand.
    expect(card.textContent).toContain('Acme stays saved');
    expect(db.brandFilters).toContainEqual([
      ['organization_id', 'org-1'],
      ['is_demo', false],
    ]);
    expect(button('Explore the demo')).toBeDefined();
  });

  it('offers two ways to start on each plan, a card for both', async () => {
    await render();
    expect(text()).toContain('Choose how to start');
    expect(text()).not.toContain('Start Your 14-Day Free Trial');
    expect(text()).not.toContain('No charge today');
    expect(container.querySelector('[data-slot="offer-line"]')?.textContent).toBe(
      'Start a 14-day free trial, or get 50% off your first month.',
    );
    expect(modeButtons('buy').map((b) => b.textContent)).toEqual(['Buy now', 'Buy now']);
    expect(modeButtons('trial').map((b) => b.textContent)).toEqual([
      'Start 14-day free trial',
      'Start 14-day free trial',
    ]);
    expect(slots('buy-terms')).toEqual([
      'Limited offer$24.50 first month, then $49/monthFull plan from day one',
      'Limited offer$124.50 first month, then $249/monthFull plan from day one',
    ]);
    expect(slots('trial-terms')).toEqual([
      'Free for 14 days, then $49/monthLimited AI usage for 14 days',
      'Free for 14 days, then $249/monthLimited AI usage for 14 days',
    ]);
    expect(container.querySelector('[data-slot="card-note"]')?.textContent).toBe(
      'Card required for both. Cancel any time.',
    );
    // The demo card stays below the plans.
    expect(container.querySelector('[data-slot="explore-demo"]')).not.toBeNull();
  });

  it('buys now with the first-month offer, and starts the trial without it', async () => {
    await render();
    await act(async () => modeButtons('buy')[0].click());
    expect(checkoutBody()).toEqual({
      planId: 'starter',
      organizationId: 'org-1',
      mode: 'buy',
      promotionCode: 'SAVE50',
    });

    act(() => root.unmount());
    root = createRoot(container);
    fetchMock.mockClear();
    await render();
    await act(async () => modeButtons('trial')[1].click());
    expect(checkoutBody()).toEqual({ planId: 'growth', organizationId: 'org-1', mode: 'trial' });
  });

  it('offers only Buy now once the trial was used', async () => {
    trialAvailable.value = false;
    await render();
    expect(text()).toContain('Choose Your Plan');
    expect(modeButtons('trial')).toEqual([]);
    expect(container.querySelector('[data-slot="offer-line"]')?.textContent).toBe(
      'Get 50% off your first month.',
    );
    expect(container.querySelector('[data-slot="card-note"]')?.textContent).toBe(
      'Card required. Cancel any time.',
    );
  });

  it('shows the plain price with the first-month offer off', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIRST_MONTH_OFFER', 'off');
    await render();
    expect(modeButtons('buy').map((b) => b.textContent)).toEqual([
      'Choose Starter',
      'Choose Growth',
    ]);
    expect(text()).not.toContain('Limited offer');
    expect(text()).not.toContain('50%');
    expect(container.querySelector('[data-slot="offer-line"]')?.textContent).toBe(
      'Start a 14-day free trial.',
    );
    await act(async () => modeButtons('buy')[0].click());
    expect(checkoutBody()).toEqual({ planId: 'starter', organizationId: 'org-1', mode: 'buy' });
  });

  it('starts the demo brand setup ahead for an organization with none yet', async () => {
    await render();
    await act(async () => {});
    expect(prepareDemoBrand).toHaveBeenCalledTimes(1);
  });

  it('starts nothing ahead when the demo brand is there already', async () => {
    db.hasDemo = true;
    await render();
    await act(async () => {});
    expect(prepareDemoBrand).not.toHaveBeenCalled();
  });
});
