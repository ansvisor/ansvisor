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
 * The topics step asks for its suggestions once, whether it is resumed on or
 * reached from step 2, and not when topics are saved already.
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
  // The own brand is saved: the resume opens on it, past steps 1 and 2.
  ownBrand: true,
  // The organization's plan, as its row has it: none for a new account.
  org: null as {
    subscription_status: string | null;
    plan: string;
    name?: string;
    stripe_subscription_id?: string | null;
  } | null,
  // The person's organization: none yet for a new account.
  orgId: 'org-1' as string | null,
  // The own brand's competitors (saved by Finish) and runs (tracking_runs).
  competitors: [] as unknown[],
  runs: [] as unknown[],
  // The person's role.
  role: 'admin',
  // The organization's own brands, whatever this person sees (org_brand_count);
  // null: the count fails (a statement timeout).
  orgBrandCount: 1 as number | null,
  // What was written, in order: profile updates and brands created.
  log: [] as unknown[],
  // The person's profile can't be written (a network error).
  profileWriteFails: false,
  // The own brand's tracking code: none unless a test gives it one.
  trackingCode: null as string | null,
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
    q.maybeSingle = q.single;
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
    profiles: () => ({
      organization_id: db.orgId,
      onboarding_completed: db.onboarded,
      role: db.role,
    }),
    organizations: () => db.org,
    competitors: () => db.competitors,
    tracking_runs: () => db.runs,
    brands: () =>
      db.ownBrand
        ? [
            {
              id: 'b1',
              organization_id: 'org-1',
              name: 'Acme',
              slug: 'acme',
              tracking_code: db.trackingCode,
              brand_domains: [{ id: 'd1', brand_id: 'b1', domain: 'acme.com', is_primary: true }],
            },
          ]
        : [],
    prompt_sets: () => db.promptSets,
  };
  return {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      rpc: async (fn: string) =>
        fn === 'org_brand_count' && db.orgBrandCount !== null
          ? { data: db.orgBrandCount, error: null }
          : { data: null, error: { code: '57014', message: 'statement timeout' } },
      from: (table: string) => {
        const filters: [string, unknown][] = [];
        if (table === 'brands') db.brandFilters.push(filters);
        const q = query(
          () => (table === 'brands' ? demoRows(filters) : null) ?? rows[table]?.() ?? null,
          filters,
        );
        if (table === 'profiles') {
          q.update = (values: { organization_id?: string }) => {
            if (db.profileWriteFails) {
              return { eq: async () => ({ error: { message: 'Failed to fetch' } }) };
            }
            db.log.push({ profiles: values });
            if (values.organization_id) db.orgId = values.organization_id;
            return q;
          };
        }
        if (table === 'organizations') {
          q.insert = async (values: { id: string; name: string; slug: string }) => {
            db.log.push({ organizations: { insert: values } });
            return { error: null };
          };
          q.update = (values: unknown) => {
            db.log.push({ organizations: values });
            return q;
          };
        }
        return q;
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
// The demo's one explore action: the setup ahead (usePreloadDemo) stays real.
const exploreDemo = vi.hoisted(() => ({ explore: vi.fn(async () => {}), opening: false }));
vi.mock('@/hooks/use-explore-demo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-explore-demo')>()),
  useExploreDemo: () => ({
    explore: exploreDemo.explore,
    opening: exploreDemo.opening,
    setupDialog: { setup: null, onRetry: exploreDemo.explore, onClose: () => {} },
  }),
}));
vi.mock('@/lib/actions/topic', () => ({
  getTopics: vi.fn(async () => [{ id: 't1', name: 'Coffee' }]),
  createTopics: vi.fn(async () => undefined),
}));
const getCompetitors = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));
vi.mock('@/lib/actions/competitor', () => ({
  getCompetitors,
  addCompetitor: vi.fn(),
}));
const createBrand = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/brand', () => ({ createBrand, markBrandAsEcommerce: vi.fn() }));
const getTrackedPromptCount = vi.hoisted(() => vi.fn(async () => 10));
vi.mock('@/lib/actions/prompt', () => ({
  getPromptCapacity: vi.fn(async () => ({ maxPrompts: 50, used: 0 })),
  getTrackedPromptCount,
  savePromptSet: vi.fn(),
}));
vi.mock('@/lib/actions/tracking', () => ({ triggerTrackingCheck: vi.fn() }));
// The end of setup after purchase, on the server: its own tests.
const finishSetup = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown> => ({ ok: true, jobId: 'job1' })),
);
vi.mock('@/lib/actions/setup-after-purchase', () => ({ finishSetupAfterPurchase: finishSetup }));
vi.mock('@/lib/actions/volumes', () => ({ bootstrapBrandVolumes: vi.fn() }));
// AI Traffic's Check again, on "Connect your site": the server's read of the home page.
const checkTrackingSnippet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/traffic-snippet-client', () => ({ checkTrackingSnippet }));
const setup = vi.hoisted(() => ({
  suggestTopics: vi.fn(),
  generatePromptsFromTopics: vi.fn(),
  suggestCompetitors: vi.fn(),
  detectSiteType: vi.fn(async () => ({ siteType: null, industry: null })),
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
const { resetEnsureOrganization } = await import('@/lib/onboarding/organization');
const { track } = await import('@/lib/analytics');
const { toast } = await import('sonner');
const { SetupDailyLimitError } = await import('@/lib/ai-brand-setup');
// The brand's saved topics: Coffee, unless a test says none.
const getTopics = vi.mocked((await import('@/lib/actions/topic')).getTopics);

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.promptSets = [];
  db.ownBrand = true;
  db.onboarded = false;
  db.brandFilters = [];
  db.hasDemo = false;
  db.org = null;
  db.role = 'admin';
  db.orgBrandCount = 1;
  db.orgId = 'org-1';
  db.competitors = [];
  db.runs = [];
  db.log = [];
  db.profileWriteFails = false;
  db.trackingCode = null;
  exploreDemo.opening = false;
  resetEnsureOrganization();
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

  it('says so on the topics step, with no Try again', async () => {
    getTopics.mockResolvedValueOnce([]);
    setup.suggestTopics.mockRejectedValueOnce(new SetupDailyLimitError('limit'));
    await render();
    expect(setup.suggestTopics).toHaveBeenCalledOnce();
    expect(text()).toContain(
      'Setup suggestions are used up for today. Try again tomorrow, or add your own.',
    );
    expect(button('Try again')).toBeUndefined();
  });
});

describe('the prompts step', () => {
  it('offers the suggested prompts as a checklist, 15 ticked, and saves only the ticked ones', async () => {
    const topics = ['Beans', 'Brewing', 'Grinders', 'Gifts'];
    setup.generatePromptsFromTopics.mockResolvedValue({
      topicPrompts: topics.map((topic) => ({
        topic,
        prompts: [1, 2, 3, 4, 5].map((n) => `Best ${topic.toLowerCase()} question ${n}`),
      })),
    });
    await render();
    await act(async () => button('Looks good')!.click());
    expect(text()).toContain('Choose your prompts');
    expect(container.querySelector('[data-slot="prompt-count"]')?.textContent).toBe(
      '15 of 20 prompts ticked',
    );
    expect(text()).toContain('4 of 5 ticked');
    expect(text()).toContain('3 of 5 ticked');
    // The first topic is open: its first four ticked, its fifth not.
    const boxes = () => [...container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
    expect(boxes().map((b) => b.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
      'true',
      'true',
      'false',
    ]);
    await act(async () => boxes()[0].click());
    expect(container.querySelector('[data-slot="prompt-count"]')?.textContent).toBe(
      '14 of 20 prompts ticked',
    );
    const { savePromptSet } = await import('@/lib/actions/prompt');
    await act(async () => button('Continue')!.click());
    const saved = vi.mocked(savePromptSet).mock.calls[0][0].prompts.map((p) => p.text);
    expect(saved).toHaveLength(14);
    expect(saved).not.toContain('Best beans question 1');
    expect(saved).not.toContain('Best beans question 5');
    expect(saved).toContain('Best gifts question 3');
  });
  it('ticks no more than the plan has room for, so no note shows until more are ticked', async () => {
    const { getPromptCapacity } = await import('@/lib/actions/prompt');
    vi.mocked(getPromptCapacity).mockResolvedValueOnce({ maxPrompts: 50, used: 40 });
    setup.generatePromptsFromTopics.mockResolvedValue({
      topicPrompts: ['Beans', 'Brewing', 'Grinders', 'Gifts'].map((topic) => ({
        topic,
        prompts: [1, 2, 3, 4, 5].map((n) => `Best ${topic.toLowerCase()} question ${n}`),
      })),
    });
    await render();
    await act(async () => button('Looks good')!.click());
    expect(container.querySelector('[data-slot="prompt-count"]')?.textContent).toBe(
      '10 of 20 prompts ticked',
    );
    expect(text()).not.toContain('waiting for a spot');
    const unticked = container.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-checked="false"]',
    )!;
    await act(async () => unticked.click());
    expect(text()).toContain('Your plan has room for 10 more prompts: the other 1 will be saved');
  });
});

describe('topic suggestions', () => {
  async function type(id: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  /** The topic rows: the checkable buttons above "Add custom topic". */
  const topicRows = () =>
    ['Espresso', 'Cold brew', 'Coffee'].filter((topic) => button(topic) !== undefined);
  /** Holds the suggestions back, so the step shows while they load, as it does for real. */
  function suggestLater() {
    let answer!: () => void;
    setup.suggestTopics.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = () => resolve({ topics: ['Espresso', 'Cold brew'] });
      }),
    );
    return () => act(async () => answer());
  }

  it('are fetched once on coming back to the topics step with no topics saved', async () => {
    getTopics.mockResolvedValueOnce([]);
    const answer = suggestLater();
    await render();
    expect(text()).toContain('Choose topics to monitor');
    expect(text()).toContain('Researching topics for your brand...');
    await answer();
    expect(setup.suggestTopics).toHaveBeenCalledOnce();
    expect(setup.suggestTopics).toHaveBeenCalledWith({
      brandName: 'Acme',
      description: '',
      website: 'acme.com',
      language: 'en',
    });
    expect(topicRows()).toEqual(['Espresso', 'Cold brew']);
    expect(button('Looks good')!.disabled).toBe(false);
  });

  it('are fetched once on the way from the target market to the topics step', async () => {
    db.ownBrand = false;
    createBrand.mockResolvedValueOnce({
      brand: {
        id: 'b1',
        organizationId: 'org-1',
        name: 'Acme',
        slug: 'acme',
        region: 'US',
        language: 'en',
        domains: [{ id: 'd1', brandId: 'b1', domain: 'acme.com', isPrimary: true }],
      },
    });
    const answer = suggestLater();
    await render();
    expect(text()).toContain('Set up your brand');
    await type('brandName', 'Acme');
    await type('website', 'acme.com');
    await act(async () => button('Continue')!.click());
    expect(text()).toContain('Select your target market');
    await act(async () => button('Continue')!.click());
    await act(async () => {});
    expect(text()).toContain('Choose topics to monitor');
    expect(text()).toContain('Researching topics for your brand...');
    await answer();
    expect(createBrand).toHaveBeenCalledOnce();
    expect(setup.suggestTopics).toHaveBeenCalledOnce();
    expect(topicRows()).toEqual(['Espresso', 'Cold brew']);
  });

  it('are not fetched on coming back with topics saved', async () => {
    await render();
    await act(async () => {});
    expect(text()).toContain('Choose topics to monitor');
    expect(setup.suggestTopics).not.toHaveBeenCalled();
    expect(topicRows()).toEqual(['Coffee']);
  });
});

describe('the plan step', () => {
  // The trial check, the first-month code's check, and Checkout's answer.
  const trialAvailable = { value: true };
  const promo = { status: 200 };
  const answer = async (url: string) =>
    url === '/api/stripe/trial'
      ? Response.json({ trialAvailable: trialAvailable.value, trialDays: 14 })
      : url === '/api/stripe/promo-code'
        ? Response.json(
            promo.status === 200
              ? {
                  valid: true,
                  code: 'SAVE50',
                  percentOff: 50,
                  amountOff: null,
                  duration: 'once',
                  durationInMonths: null,
                }
              : { error: 'Internal error' },
            { status: promo.status },
          )
        : Response.json({ url: '#checkout' });
  const fetchMock = vi.fn(answer);
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
  const choices = () =>
    [...container.querySelectorAll('[data-choice]')].map((el) => el.textContent);
  async function choose(choice: 'trial' | 'month' | 'year' | 'demo') {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)!.click();
    });
  }

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    trialAvailable.value = true;
    promo.status = 200;
    fetchMock.mockClear();
    fetchMock.mockImplementation(answer);
    vi.stubGlobal('fetch', fetchMock);
    db.onboarded = true;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    getCompetitors.mockResolvedValue([]);
  });

  it('comes straight after the competitors, the last of six steps, with no "What do you work on?"', async () => {
    db.onboarded = false;
    db.promptSets = [{ id: 's1' }];
    setup.suggestCompetitors.mockResolvedValue({
      competitors: [{ name: 'Rival', domain: 'rival.com' }],
      isEcommerce: false,
    });
    await render();
    // Tracking starts with the plan step's Checkout, so the button only goes on.
    expect(button('Start tracking with 1 competitor')).toBeUndefined();
    expect(container.querySelector('[data-slot="tracking-starts"]')?.textContent).toBe(
      'Next, choose how to start. Tracking starts when you start the free trial or buy a plan.',
    );
    await act(async () => button('Continue with 1 competitor')!.click());
    await act(async () => {});
    expect(text()).toContain('Choose how to start');
    expect(text()).not.toContain('What do you work on?');
    // The step dots: six, the plan's the current one.
    const dots = [...container.querySelector('.w-6.bg-foreground')!.parentElement!.children];
    expect(dots).toHaveLength(6);
    expect(dots.findIndex((dot) => dot.classList.contains('w-6'))).toBe(5);
    // Today's flow: no setup after purchase, and its events as they were.
    expect(finishSetup).not.toHaveBeenCalled();
    expect(container.querySelector('[data-slot="manage-plan"]')).toBeNull();
    expect(db.log).toEqual([{ profiles: { onboarding_completed: true } }]);
    expect(
      vi.mocked(track).mock.calls.some(([, props]) => props && 'setup_after_purchase' in props),
    ).toBe(false);
  });

  it('offers the demo brand in one line under the plans, for someone not ready to add a card', async () => {
    db.onboarded = true;
    await render();
    expect(text()).toContain('Choose how to start');
    const line = container.querySelector('[data-slot="explore-demo"]')!;
    expect(line.textContent).toBe('Not ready for a card? Explore a sample brand first →');
    // The old box is gone.
    expect(text()).not.toContain('Explore a demo brand');
    // The own brand, read without the demo brand.
    expect(db.brandFilters).toContainEqual([
      ['organization_id', 'org-1'],
      ['is_demo', false],
    ]);
    await act(async () => button('Explore a sample brand first →')!.click());
    expect(exploreDemo.explore).toHaveBeenCalledTimes(1);
  });

  it('offers the demo as the last choice: its card in place of the plans, the same action', async () => {
    await render();
    expect(container.querySelector('[data-slot="start-choice-divider"]')).not.toBeNull();
    expect(container.querySelector('[data-choice="demo"]')?.textContent).toBe('Demo · no card');
    expect(container.querySelector('[data-slot="demo-choice"]')).toBeNull();

    await choose('demo');
    const pressed = () =>
      [...container.querySelectorAll('[data-choice][aria-pressed="true"]')].map(
        (el) => (el as HTMLElement).dataset.choice,
      );
    expect(pressed()).toEqual(['demo']);
    const card = container.querySelector('[data-slot="demo-choice"]')!;
    expect(card.querySelector('h3')?.textContent).toBe('Look around a sample brand');
    expect(card.textContent).toContain('Brewline Coffee · sample data');
    // A made-up brand, not the own one, which stays saved.
    expect(card.textContent).toContain(
      "You'll explore Brewline Coffee, a made-up brand with sample data, not Acme. You can open every page, but nothing runs or changes there. Acme stays saved, and tracking starts when you pick a plan. No card needed.",
    );
    // In place of the plans, their note and the line under them.
    expect(container.querySelector('[data-plan]')).toBeNull();
    expect(container.querySelector('[data-slot="card-note"]')).toBeNull();
    expect(container.querySelector('[data-slot="explore-demo"]')).toBeNull();
    const explore = [...card.querySelectorAll('button')].find(
      (b) => b.textContent === 'Explore the sample brand',
    )!;
    await act(async () => explore.click());
    expect(exploreDemo.explore).toHaveBeenCalledTimes(1);
    // No Checkout for the demo.
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/stripe/checkout');

    // Monthly again: the plans are back, as they were.
    await choose('month');
    expect(pressed()).toEqual(['month']);
    expect(container.querySelector('[data-slot="demo-choice"]')).toBeNull();
    expect(slots('due-amount')).toEqual(['$24.50', '$124.50']);
    expect(container.querySelector('[data-slot="explore-demo"]')).not.toBeNull();
  });

  it('waits while the demo opens, on its card and on the line', async () => {
    exploreDemo.opening = true;
    await render();
    const line = container.querySelector<HTMLButtonElement>('[data-slot="explore-demo"] button')!;
    expect(line.disabled).toBe(true);
    expect(line.textContent).toBe('Setting up the demo…');
    await choose('demo');
    const cardButton = container.querySelector<HTMLButtonElement>(
      '[data-slot="demo-choice"] button',
    )!;
    expect(cardButton.disabled).toBe(true);
    expect(cardButton.textContent).toBe('Setting up the demo…');
  });

  it('opens on the free trial, while the workspace may have one', async () => {
    await render();
    const pressed = container.querySelector('[data-choice][aria-pressed="true"]');
    expect(pressed?.getAttribute('data-choice')).toBe('trial');
    expect(modeButtons('trial').map((b) => b.textContent)).toEqual([
      'Start 14-day free trial',
      'Start 14-day free trial',
    ]);
    expect(modeButtons('buy')).toEqual([]);
  });

  it('offers one choice of how to start, then one button on each plan, a card for both', async () => {
    await render();
    await choose('month');
    expect(text()).toContain('Choose how to start');
    expect(text()).not.toContain('Start Your 14-Day Free Trial');
    expect(text()).not.toContain('No charge today');
    // The first-month offer is on the cards, not by Monthly; the demo comes last.
    expect(choices()).toEqual(['14-day trial', 'Monthly', 'YearlySave 20%', 'Demo · no card']);
    expect(text()).not.toContain('50% off the first month');
    // Monthly, with the first-month offer: its price large on the card.
    expect(modeButtons('buy').map((b) => b.textContent)).toEqual(['Buy now', 'Buy now']);
    expect(modeButtons('trial')).toEqual([]);
    expect(slots('plan-price')[0]).toContain('$24.50first month');
    expect(slots('due-amount')).toEqual(['$24.50', '$124.50']);
    expect(slots('start-terms')).toEqual(['Full plan from day one', 'Full plan from day one']);
    expect(slots('limited-offer')).toEqual(['Limited offer', 'Limited offer']);
    expect(slots('trust-line')).toEqual([
      'Secure checkout with Stripe · Cancel any time',
      'Secure checkout with Stripe · Cancel any time',
    ]);
    expect(container.querySelector('[data-slot="card-note"]')?.textContent).toBe(
      'Card required for both.',
    );
    // Billing's own taglines and features, not onboarding's copy of them.
    expect(text()).toContain('For small teams getting started with AI visibility');
    expect(text()).toContain('50 prompts tracked');
    expect(text()).not.toContain('Core Platform Features');
    // The demo's line stays below the plans.
    expect(container.querySelector('[data-slot="explore-demo"]')).not.toBeNull();
  });

  it("says what is ready to track, from the own brand's real setup", async () => {
    getCompetitors.mockResolvedValue([
      { id: 'c1', name: 'Crema Club' },
      { id: 'c2', name: 'Origin Box' },
    ]);
    await render();
    await act(async () => {});
    expect(getTrackedPromptCount).toHaveBeenCalledWith('b1');
    expect(container.querySelector('[data-slot="ready-to-track"]')?.textContent).toBe(
      'Ready to track for Acme: 10 prompts · 1 topic · 2 competitors',
    );
    expect(container.querySelector('[data-slot="ready-to-track"] strong')?.textContent).toBe(
      'Acme',
    );
  });

  it('says nothing of it when the setup could not be read', async () => {
    getTrackedPromptCount.mockRejectedValueOnce(new Error('offline'));
    await render();
    await act(async () => {});
    expect(container.querySelector('[data-slot="ready-to-track"]')).toBeNull();
  });

  it('shows the trial with nothing due today, when it ends and what follows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    await render();
    await choose('trial');
    expect(modeButtons('trial').map((b) => b.textContent)).toEqual([
      'Start 14-day free trial',
      'Start 14-day free trial',
    ]);
    expect(slots('due-amount')).toEqual(['$0', '$0']);
    expect(slots('start-terms')).toEqual([
      'Free until Nov 11, then $49/monthLimited AI usage for 14 days',
      'Free until Nov 11, then $249/monthLimited AI usage for 14 days',
    ]);
    // No offer with the trial: the plain price.
    expect(text()).not.toContain('Limited offer');
  });

  it('buys now with the first-month offer, and starts the trial without it', async () => {
    await render();
    await choose('month');
    await act(async () => modeButtons('buy')[0].click());
    expect(checkoutBody()).toEqual({
      planId: 'starter',
      organizationId: 'org-1',
      interval: 'month',
      mode: 'buy',
      promotionCode: 'SAVE50',
    });

    act(() => root.unmount());
    root = createRoot(container);
    fetchMock.mockClear();
    await render();
    await act(async () => modeButtons('trial')[1].click());
    expect(checkoutBody()).toEqual({
      planId: 'growth',
      organizationId: 'org-1',
      interval: 'month',
      mode: 'trial',
    });
  });

  it('buys a year at its price, without the code', async () => {
    await render();
    await choose('year');
    expect(slots('due-amount')).toEqual(['$470', '$2,390']);
    expect(modeButtons('buy').map((b) => b.textContent)).toEqual([
      'Choose Starter',
      'Choose Growth',
    ]);
    await act(async () => modeButtons('buy')[1].click());
    expect(checkoutBody()).toEqual({
      planId: 'growth',
      organizationId: 'org-1',
      interval: 'year',
      mode: 'buy',
    });
  });

  it('says by the button when Checkout would not open, and stops waiting', async () => {
    await render();
    await choose('month');
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/stripe/checkout'
        ? Response.json({ error: 'Price not configured for this plan' }, { status: 400 })
        : answer(url),
    );
    await act(async () => modeButtons('buy')[1].click());
    const growth = container.querySelector('[data-plan="growth"]')!;
    expect(growth.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't open the checkout. Try again.",
    );
    expect(modeButtons('buy').map((b) => b.textContent)).toEqual(['Buy now', 'Buy now']);
    expect(modeButtons('buy').every((b) => !b.disabled)).toBe(true);
  });

  it('turns to buying once Checkout finds the trial used', async () => {
    await render();
    await choose('trial');
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/stripe/checkout'
        ? Response.json({ error: 'Trial used', code: 'trial_unavailable' }, { status: 409 })
        : answer(url),
    );
    await act(async () => modeButtons('trial')[0].click());
    expect(choices()).toEqual(['Monthly', 'YearlySave 20%', 'Demo · no card']);
    expect(container.querySelector('[data-plan="starter"] [role="alert"]')?.textContent).toBe(
      "This workspace's free trial has been used. Buy now to start the plan.",
    );
    expect(text()).toContain('Choose Your Plan');
  });

  it('keeps the offer as configured when its code could not be checked', async () => {
    promo.status = 500;
    await render();
    await choose('month');
    await act(async () => {});
    expect(slots('due-amount')).toEqual(['$24.50', '$124.50']);
    await act(async () => modeButtons('buy')[0].click());
    expect(checkoutBody()).toMatchObject({ promotionCode: 'SAVE50' });
  });

  it('offers only buying once the trial was used', async () => {
    trialAvailable.value = false;
    await render();
    expect(text()).toContain('Choose Your Plan');
    expect(choices()).toEqual(['Monthly', 'YearlySave 20%', 'Demo · no card']);
    expect(modeButtons('trial')).toEqual([]);
    expect(slots('start-terms')).toEqual([]);
    expect(container.querySelector('[data-slot="card-note"]')?.textContent).toBe('Card required.');
  });

  it('shows the plain price with the first-month offer off', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIRST_MONTH_OFFER', 'off');
    await render();
    await choose('month');
    expect(choices()).toEqual(['14-day trial', 'Monthly', 'YearlySave 20%', 'Demo · no card']);
    expect(modeButtons('buy').map((b) => b.textContent)).toEqual([
      'Choose Starter',
      'Choose Growth',
    ]);
    expect(slots('due-amount')).toEqual(['$49', '$249']);
    expect(text()).not.toContain('Limited offer');
    expect(text()).not.toContain('50%');
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/stripe/promo-code');
    await act(async () => modeButtons('buy')[0].click());
    expect(checkoutBody()).toEqual({
      planId: 'starter',
      organizationId: 'org-1',
      interval: 'month',
      mode: 'buy',
    });
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

  it('names the choice on its events, where it comes last, with no position', async () => {
    await render();
    await act(async () => modeButtons('trial')[0].click());
    expect(track).toHaveBeenCalledWith('onboarding_step_completed', {
      step: 6,
      step_name: 'plan',
      plan_id: 'starter',
      choice: 'trial',
    });
    expect(track).toHaveBeenCalledWith('onboarding_plan_selected', {
      plan_id: 'starter',
      checkout_mode: 'trial',
      choice: 'trial',
    });
    expect(track).toHaveBeenCalledWith('onboarding_step_viewed', { step: 6, step_name: 'plan' });
    expect(vi.mocked(track).mock.calls.some(([, props]) => props && 'position' in props)).toBe(
      false,
    );
  });

  it('keeps the plan step, with the brand, for a brand set up under the old order', async () => {
    getCompetitors.mockResolvedValue([{ id: 'c1', name: 'Crema Club' }]);
    await render();
    await act(async () => {});
    expect(text()).toContain('Choose how to start');
    expect(text()).not.toContain('How do you want to start?');
    expect(container.querySelector('[data-slot="start-intro"]')).toBeNull();
    expect(container.querySelector('[data-slot="ready-to-track"]')?.textContent).toBe(
      'Ready to track for Acme: 10 prompts · 1 topic · 1 competitor',
    );
    expect(button('Back')).toBeDefined();
    await choose('demo');
    expect(container.querySelector('[data-slot="demo-choice"]')?.textContent).toContain(
      'not Acme. You can open every page, but nothing runs or changes there. Acme stays saved',
    );
    // Its demo opens as before: onboarding is marked completed already.
    await act(async () => button('Explore the sample brand')!.click());
    expect(exploreDemo.explore).toHaveBeenCalledTimes(1);
    expect(db.log).toEqual([]);
  });

  describe('as the first screen (the choice)', () => {
    const inserted = () =>
      db.log.filter(
        (row) => (row as { organizations?: { insert?: unknown } }).organizations?.insert,
      );

    beforeEach(() => {
      // A new admin: no organization, no brand, onboarding not finished.
      db.onboarded = false;
      db.orgId = null;
      db.ownBrand = false;
      db.orgBrandCount = 0;
    });

    it('opens a new admin on the choice, with no organization made until a choice is', async () => {
      await render();
      expect(text()).toContain('How do you want to start?');
      // A new person may have the free trial: no organization needed to say so.
      expect(container.querySelector('[data-slot="start-intro"]')?.textContent).toBe(
        'With the 14-day free trial, you add a card and nothing is charged until it ends. Cancel any time. Then set up your brand, and its tracking starts.',
      );
      expect(choices()).toEqual(['14-day trial', 'Monthly', 'YearlySave 20%', 'Demo · no card']);
      expect(modeButtons('trial').map((b) => b.textContent)).toEqual([
        'Start 14-day free trial',
        'Start 14-day free trial',
      ]);
      expect(modeButtons('trial').every((b) => !b.disabled)).toBe(true);
      // Nothing before it, and no brand yet: no Back, no step dots, no brand line.
      expect(button('Back')).toBeUndefined();
      expect(container.querySelector('.w-6.bg-foreground')).toBeNull();
      expect(container.querySelector('[data-slot="ready-to-track"]')).toBeNull();
      expect(text()).not.toContain('Set up your brand');
      // Opening it makes no organization (someone with an invitation leaves
      // none behind), and nothing reads one: the demo is built ahead once it exists.
      expect(inserted()).toEqual([]);
      expect(db.log).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prepareDemoBrand).not.toHaveBeenCalled();
      // The plan step's event, first.
      expect(
        vi.mocked(track).mock.calls.filter(([event]) => event === 'onboarding_step_viewed'),
      ).toEqual([['onboarding_step_viewed', { step: 6, step_name: 'plan', position: 'first' }]]);

      // A reload makes none either.
      act(() => root.unmount());
      root = createRoot(container);
      await render();
      expect(text()).toContain('How do you want to start?');
      expect(db.log).toEqual([]);
    });

    it('makes one organization when asked twice at once', async () => {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      const { ensureOrganization } = await import('@/lib/onboarding/organization');
      const [first, second] = await Promise.all([
        ensureOrganization(supabase as never, 'u1', 'My workspace'),
        ensureOrganization(supabase as never, 'u1', 'My workspace'),
      ]);
      expect(second).toEqual(first);
      expect(first.created).toBe(true);
      expect(inserted()).toHaveLength(1);
      expect(await ensureOrganization(supabase as never, 'u1', 'My workspace')).toEqual({
        id: first.id,
        created: false,
      });
    });

    it('starts the trial in Checkout with the organization made on the click, then setup after it', async () => {
      await render();
      await act(async () => modeButtons('trial')[1].click());
      // The organization, named for now, and the person in it: once.
      expect(inserted()).toEqual([
        { organizations: { insert: { id: db.orgId, name: 'My workspace', slug: 'my-workspace' } } },
      ]);
      expect(db.log).toEqual([...inserted(), { profiles: { organization_id: db.orgId } }]);
      expect(checkoutBody()).toEqual({
        planId: 'growth',
        organizationId: db.orgId,
        interval: 'month',
        mode: 'trial',
      });
      expect(track).toHaveBeenCalledWith('onboarding_step_completed', {
        step: 6,
        step_name: 'plan',
        plan_id: 'growth',
        choice: 'trial',
        position: 'first',
      });
      expect(track).toHaveBeenCalledWith('onboarding_plan_selected', {
        plan_id: 'growth',
        checkout_mode: 'trial',
        choice: 'trial',
        position: 'first',
      });
      // Nothing about onboarding is marked: setup comes after Checkout.
      expect(
        db.log.some(
          (row) => 'onboarding_completed' in ((row as { profiles?: object }).profiles ?? {}),
        ),
      ).toBe(false);
    });

    it.each([
      ['month', 'monthly', 0, { mode: 'buy', interval: 'month', promotionCode: 'SAVE50' }],
      ['year', 'yearly', 1, { mode: 'buy', interval: 'year' }],
    ] as const)('buys %s now, its event naming it %s', async (pick, name, card, sent) => {
      await render();
      await choose(pick);
      await act(async () => modeButtons('buy')[card].click());
      expect(checkoutBody()).toMatchObject({ organizationId: db.orgId, ...sent });
      expect(track).toHaveBeenCalledWith(
        'onboarding_plan_selected',
        expect.objectContaining({ checkout_mode: 'buy', choice: name, position: 'first' }),
      );
    });

    it('opens the sample brand with no setup: onboarding marked completed, then the demo', async () => {
      exploreDemo.explore.mockImplementationOnce(async () => {
        db.log.push('explore');
      });
      await render();
      await choose('demo');
      const card = container.querySelector('[data-slot="demo-choice"]')!;
      // No brand of the person's own to name: it is set up after buying.
      expect(card.textContent).toContain(
        "You'll explore Brewline Coffee, a made-up brand with sample data. You can open every page, but nothing runs or changes there. When you pick a plan, you set up your own brand and its tracking starts. No card needed.",
      );
      expect(card.textContent).not.toContain('stays saved');
      expect([...card.querySelectorAll('strong')].map((b) => b.textContent)).toEqual([
        'Brewline Coffee',
      ]);
      await act(async () => button('Explore the sample brand')!.click());
      // The organization first, then onboarding marked completed, then the demo.
      expect(db.log).toEqual([
        ...inserted(),
        { profiles: { organization_id: db.orgId } },
        { profiles: { onboarding_completed: true } },
        'explore',
      ]);
      expect(inserted()).toHaveLength(1);
      expect(exploreDemo.explore).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenCalledWith('onboarding_step_completed', {
        step: 6,
        step_name: 'plan',
        choice: 'demo',
        position: 'first',
      });
      expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/stripe/checkout');
      expect(createBrand).not.toHaveBeenCalled();
    });

    it('opens it from the line under the plans too', async () => {
      await render();
      await act(async () => button('Explore a sample brand first →')!.click());
      expect(db.log.at(-1)).toEqual({ profiles: { onboarding_completed: true } });
      expect(exploreDemo.explore).toHaveBeenCalledTimes(1);
    });

    it('stays on the choice, saying so, when onboarding could not be marked completed', async () => {
      // Back on the choice with its organization (a canceled Checkout).
      db.orgId = 'org-1';
      db.org = { subscription_status: null, plan: 'starter', stripe_subscription_id: null };
      await render();
      db.profileWriteFails = true;
      await act(async () => button('Explore a sample brand first →')!.click());
      expect(exploreDemo.explore).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith("Couldn't open the demo brand. Try again.");
      expect(text()).toContain('How do you want to start?');
    });

    it('says so when the organization could not be made: no Checkout, and the choice stays', async () => {
      db.profileWriteFails = true;
      await render();
      expect(toast.error).not.toHaveBeenCalled();
      await act(async () => modeButtons('trial')[0].click());
      expect(toast.error).toHaveBeenCalledWith(
        "We couldn't set up your workspace. Please try again.",
      );
      expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/stripe/checkout');
      expect(text()).toContain('How do you want to start?');
      // Asked again, it tries again.
      expect(modeButtons('trial').every((b) => !b.disabled)).toBe(true);
    });

    it('never marks onboarding completed for the sample brand without an organization: no loop', async () => {
      // The organization can't be made: /api/demo would fail, and onboarding
      // marked completed with no organization would bounce between the
      // dashboard and here.
      db.profileWriteFails = true;
      await render();
      await act(async () => button('Explore a sample brand first →')!.click());
      expect(toast.error).toHaveBeenCalledWith(
        "We couldn't set up your workspace. Please try again.",
      );
      expect(exploreDemo.explore).not.toHaveBeenCalled();
      // Nothing written to the profile: onboarding stays open.
      expect(db.log).toEqual(inserted());
      expect(text()).toContain('How do you want to start?');
    });

    it('falls through to the choice for someone onboarded with no organization, never to the dashboard', async () => {
      db.onboarded = true;
      const push = vi.spyOn(stable.router, 'push');
      await render();
      expect(push).not.toHaveBeenCalled();
      expect(text()).toContain('How do you want to start?');
    });

    it('comes back to the choice after a canceled Checkout, with no other organization', async () => {
      db.orgId = 'org-1';
      db.org = { subscription_status: null, plan: 'starter', stripe_subscription_id: null };
      await render();
      expect(text()).toContain('How do you want to start?');
      expect(inserted()).toEqual([]);
      await act(async () => modeButtons('trial')[0].click());
      expect(checkoutBody()).toMatchObject({ organizationId: 'org-1', mode: 'trial' });
    });

    it('comes back to the choice from the sample brand, with no brand of its own yet', async () => {
      db.orgId = 'org-1';
      db.onboarded = true;
      db.hasDemo = true;
      await render();
      expect(text()).toContain('How do you want to start?');
      expect(button('Back')).toBeUndefined();
      expect(inserted()).toEqual([]);
      await choose('demo');
      expect(container.querySelector('[data-slot="demo-choice"]')?.textContent).toContain(
        'When you pick a plan, you set up your own brand',
      );
    });

    it.each(['canceled', 'past_due', 'unpaid', 'incomplete_expired'])(
      'opens the read-only dashboard for a new admin whose trial is %s before setup is finished',
      async (status) => {
        // The trial started from the choice; no brand yet, onboarding open.
        db.orgId = 'org-1';
        db.org = { subscription_status: status, plan: 'starter', stripe_subscription_id: 'sub_1' };
        const push = vi.spyOn(stable.router, 'push');
        await render();
        // Billing is reachable there; the choice and setup's writes are not offered.
        expect(push).toHaveBeenCalledWith('/dashboard');
        expect(text()).not.toContain('How do you want to start?');
        expect(createBrand).not.toHaveBeenCalled();
      },
    );

    it('keeps the old order for a member who is no admin', async () => {
      db.orgId = 'org-1';
      root = createRoot(container);
      db.org = null;
      db.role = 'manager';
      await render();
      expect(text()).not.toContain('How do you want to start?');
      expect(text()).toContain('Set up your brand');
    });

    it('resumes a brand set up under the old order where it stopped, not on the choice', async () => {
      db.orgId = 'org-1';
      db.ownBrand = true;
      db.orgBrandCount = 1;
      db.promptSets = [{ id: 's1' }];
      setup.suggestCompetitors.mockResolvedValue({
        competitors: [{ name: 'Rival', domain: 'rival.com' }],
        isEcommerce: false,
      });
      await render();
      expect(text()).toContain('Add your competitors');
      expect(button('Continue with 1 competitor')).toBeDefined();
      expect(text()).not.toContain('How do you want to start?');
    });

    it('never opens on a self-hosted install: setup, its organization made with the brand', async () => {
      vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
      createBrand.mockResolvedValueOnce({
        brand: { id: 'b1', organizationId: 'x', name: 'Acme', slug: 'acme', domains: [] },
      });
      setup.suggestTopics.mockResolvedValue({ topics: ['Espresso'] });
      await render();
      expect(text()).toContain('Set up your brand');
      expect(text()).not.toContain('How do you want to start?');
      expect(db.log).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();

      const input = (id: string, value: string) => {
        const el = container.querySelector<HTMLInputElement>(`#${id}`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      await act(async () => input('brandName', 'Acme'));
      await act(async () => input('website', 'acme.com'));
      await act(async () => button('Continue')!.click());
      await act(async () => button('Continue')!.click());
      expect(inserted()).toEqual([
        { organizations: { insert: { id: db.orgId, name: 'Acme', slug: 'acme' } } },
      ]);
      expect(createBrand).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: db.orgId }),
      );
    });
  });
});

describe('setup after purchase', () => {
  const stepDots = () => [
    ...container.querySelector('.w-6.bg-foreground')!.parentElement!.children,
  ];
  async function type(id: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  /** The events sent with the setup-after-purchase property. */
  const flowEvents = () =>
    vi
      .mocked(track)
      .mock.calls.filter(([, props]) => props?.setup_after_purchase === true)
      .map(([event, props]) => [event, props?.step]);

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ trialAvailable: false, trialDays: 14 })),
    );
    // A trial started, and no brand of the organization's own yet.
    db.onboarded = true;
    db.org = { subscription_status: 'trialing', plan: 'growth' };
    db.ownBrand = false;
    db.orgBrandCount = 0;
    finishSetup.mockResolvedValue({ ok: true, jobId: 'job1' });
    setup.suggestCompetitors.mockResolvedValue({
      competitors: [{ name: 'Rival', domain: 'rival.com' }],
      isEcommerce: false,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('opens at the website step, never the plan step, with six steps, "Connect your site" the last', async () => {
    const push = vi.spyOn(stable.router, 'push');
    await render();
    expect(push).not.toHaveBeenCalled();
    expect(text()).toContain('Set up your brand');
    expect(text()).not.toContain('Choose how to start');
    expect(stepDots()).toHaveLength(6);
    expect(track).toHaveBeenCalledWith('onboarding_step_viewed', {
      step: 1,
      step_name: 'brand_setup',
      setup_after_purchase: true,
    });
  });

  it('walks the setup, then starts tracking at once and lands on the dashboard with the run', async () => {
    createBrand.mockImplementationOnce(async () => {
      db.log.push('createBrand');
      return {
        brand: {
          id: 'b1',
          organizationId: 'org-1',
          name: 'Acme',
          slug: 'acme',
          region: 'US',
          language: 'en',
          domains: [{ id: 'd1', brandId: 'b1', domain: 'acme.com', isPrimary: true }],
        },
      };
    });
    setup.suggestTopics.mockResolvedValue({ topics: ['Espresso'] });
    setup.generatePromptsFromTopics.mockResolvedValue({
      topicPrompts: [{ topic: 'Espresso', prompts: ['Best espresso beans?'] }],
    });
    const { savePromptSet } = await import('@/lib/actions/prompt');
    vi.mocked(savePromptSet).mockResolvedValueOnce({} as never);
    await render();

    await type('brandName', 'Acme');
    await type('website', 'acme.com');
    await act(async () => button('Continue')!.click());
    await act(async () => button('Continue')!.click());
    await act(async () => {});
    // Onboarding stays as it is: left half-way, setup resumes from the brand's own data.
    expect(db.log).toEqual(['createBrand']);
    expect(text()).toContain('Choose topics to monitor');
    await act(async () => button('Looks good')!.click());
    expect(text()).toContain('Choose your prompts');
    // The prompts are made for the plan's engines (Growth's), as the alignment leaves them.
    await act(async () => button('Continue')!.click());
    await act(async () => {});
    expect(vi.mocked(savePromptSet).mock.calls[0][0].prompts[0].platforms.length).toBeGreaterThan(
      2,
    );
    expect(text()).toContain('Add your competitors');
    expect(stepDots()).toHaveLength(5);
    expect(container.querySelector('[data-slot="tracking-starts"]')?.textContent).toBe(
      'Your plan is active. Tracking starts as soon as you finish.',
    );
    expect(button('Continue with 1 competitor')).toBeUndefined();

    vi.stubGlobal('location', { href: '' });
    await act(async () => button('Start tracking with 1 competitor')!.click());
    expect(finishSetup).toHaveBeenCalledTimes(1);
    expect(finishSetup).toHaveBeenCalledWith('b1');
    expect(window.location.href).toBe('/dashboard?jobId=job1');
    expect(toast.success).toHaveBeenCalledWith('Setup complete! Your first tracking is starting.');
    expect(text()).not.toContain('Choose how to start');
    // The page writes nothing to the profile: the server marks onboarding completed.
    expect(db.log).toEqual(['createBrand']);
    // Today's events and step names, with the property.
    expect(flowEvents()).toEqual(
      expect.arrayContaining([
        ['onboarding_step_viewed', 1],
        ['onboarding_step_completed', 1],
        ['onboarding_step_completed', 2],
        ['onboarding_step_completed', 3],
        ['onboarding_step_completed', 4],
        ['onboarding_step_viewed', 5],
        ['onboarding_step_completed', 5],
        ['onboarding_finished', undefined],
      ]),
    );
    expect(track).toHaveBeenCalledWith('onboarding_finished', {
      paid: true,
      setup_after_purchase: true,
    });
  });

  it('follows Checkout from the choice: setup with the plan, the workspace named after the brand', async () => {
    // Back from Checkout: the plan is on, onboarding still open (the choice
    // marked nothing), and the workspace keeps the name it was made with.
    db.onboarded = false;
    db.org = { subscription_status: 'trialing', plan: 'growth', name: 'My workspace' };
    createBrand.mockImplementationOnce(async () => {
      db.log.push('createBrand');
      return {
        brand: {
          id: 'b1',
          organizationId: 'org-1',
          name: 'Acme',
          slug: 'acme',
          region: 'US',
          language: 'en',
          domains: [{ id: 'd1', brandId: 'b1', domain: 'acme.com', isPrimary: true }],
        },
      };
    });
    setup.suggestTopics.mockResolvedValue({ topics: ['Espresso'] });
    setup.generatePromptsFromTopics.mockResolvedValue({
      topicPrompts: [{ topic: 'Espresso', prompts: ['Best espresso beans?'] }],
    });
    const { savePromptSet } = await import('@/lib/actions/prompt');
    vi.mocked(savePromptSet).mockResolvedValueOnce({} as never);
    await render();
    expect(text()).toContain('Set up your brand');
    expect(text()).not.toContain('How do you want to start?');
    expect(stepDots()).toHaveLength(6);

    await type('brandName', 'Acme');
    await type('website', 'acme.com');
    await act(async () => button('Continue')!.click());
    await act(async () => button('Continue')!.click());
    await act(async () => {});
    // The workspace takes the brand's name, once the brand is there.
    // Onboarding stays open as it was: nothing written to the profile before Finish.
    expect(db.log).toEqual(['createBrand', { organizations: { name: 'Acme' } }]);
    await act(async () => button('Looks good')!.click());
    await act(async () => button('Continue')!.click());
    await act(async () => {});
    // The prompts on the plan bought (Growth's engines), not Starter's.
    expect(vi.mocked(savePromptSet).mock.calls[0][0].prompts[0].platforms.length).toBeGreaterThan(
      2,
    );
    vi.stubGlobal('location', { href: '' });
    await act(async () => button('Start tracking with 1 competitor')!.click());
    expect(finishSetup).toHaveBeenCalledWith('b1');
    expect(window.location.href).toBe('/dashboard?jobId=job1');
  });

  it('keeps a workspace renamed since, or named after a brand, as it is', async () => {
    db.onboarded = false;
    db.org = { subscription_status: 'trialing', plan: 'growth', name: 'Acme Group' };
    createBrand.mockResolvedValueOnce({
      brand: { id: 'b1', organizationId: 'org-1', name: 'Acme', slug: 'acme', domains: [] },
    });
    setup.suggestTopics.mockResolvedValue({ topics: ['Espresso'] });
    await render();
    await type('brandName', 'Acme');
    await type('website', 'acme.com');
    await act(async () => button('Continue')!.click());
    await act(async () => button('Continue')!.click());
    expect(db.log).toEqual([]);
  });

  it('resumes a setup left half-way, and its Finish still skips the plan step', async () => {
    // Onboarded, the brand and its prompts saved, no competitor yet and never
    // tracked: the brand's own data says setup was left, as the dashboard reads it.
    db.ownBrand = true;
    db.orgBrandCount = 1;
    db.promptSets = [{ id: 's1' }];
    const push = vi.spyOn(stable.router, 'push');
    await render();
    expect(push).not.toHaveBeenCalled();
    expect(text()).toContain('Add your competitors');
    expect(stepDots()).toHaveLength(5);
    expect(track).toHaveBeenCalledWith('onboarding_step_viewed', {
      step: 5,
      step_name: 'competitors',
      setup_after_purchase: true,
    });
    vi.stubGlobal('location', { href: '' });
    await act(async () => button('Start tracking with 1 competitor')!.click());
    expect(finishSetup).toHaveBeenCalledWith('b1');
    expect(window.location.href).toBe('/dashboard?jobId=job1');
  });

  it('lands the sample brand’s explorer, back from buying, on the dashboard with the run too', async () => {
    // The sample brand explored, then a plan bought from it, and the own
    // brand's setup stopped at its competitors.
    db.hasDemo = true;
    db.ownBrand = true;
    db.orgBrandCount = 1;
    db.promptSets = [{ id: 's1' }];
    await render();
    expect(text()).toContain('Add your competitors');
    vi.stubGlobal('location', { href: '' });
    await act(async () => button('Start tracking with 1 competitor')!.click());
    expect(finishSetup).toHaveBeenCalledWith('b1');
    expect(window.location.href).toBe('/dashboard?jobId=job1');
  });

  it('resumes it the same for an onboarding not finished (a new account back from Checkout)', async () => {
    db.onboarded = false;
    db.ownBrand = true;
    db.promptSets = [{ id: 's1' }];
    await render();
    expect(text()).toContain('Add your competitors');
    expect(stepDots()).toHaveLength(5);
  });

  it.each([
    ['its competitors are saved (Finish pressed)', () => (db.competitors = [{ id: 'c1' }])],
    ['it was tracked already', () => (db.runs = [{ id: 'r1' }])],
    ['the organization has another brand', () => (db.orgBrandCount = 2)],
  ])('sends someone onboarded with a brand to the dashboard when %s', async (_, given) => {
    db.ownBrand = true;
    db.orgBrandCount = 1;
    db.promptSets = [{ id: 's1' }];
    given();
    const push = vi.spyOn(stable.router, 'push');
    await render();
    expect(push).toHaveBeenCalledWith('/dashboard');
  });

  describe('a plan that lapsed after the subscription', () => {
    const lapse = () => {
      db.org = { subscription_status: 'canceled', plan: 'growth', stripe_subscription_id: 'sub_1' };
    };

    it('opens the read-only dashboard instead of setup, for an onboarding not finished', async () => {
      db.onboarded = false;
      db.ownBrand = true;
      db.promptSets = [{ id: 's1' }];
      lapse();
      const push = vi.spyOn(stable.router, 'push');
      await render();
      expect(push).toHaveBeenCalledWith('/dashboard');
      expect(text()).not.toContain('Add your competitors');
    });

    it('writes nothing at Finish: Billing opens for its admin, saying why', async () => {
      db.ownBrand = true;
      db.orgBrandCount = 1;
      db.promptSets = [{ id: 's1' }];
      await render();
      expect(text()).toContain('Add your competitors');
      lapse();
      vi.stubGlobal('location', { href: '' });
      await act(async () => button('Start tracking with 1 competitor')!.click());
      const { addCompetitor } = await import('@/lib/actions/competitor');
      expect(addCompetitor).not.toHaveBeenCalled();
      expect(finishSetup).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        "Your plan isn't active any more, so setup is paused. Choose a plan in Billing, then set up your brand.",
      );
      expect(window.location.href).toBe('/dashboard/settings/billing');
    });

    it('makes no brand: the read-only dashboard for a manager', async () => {
      db.role = 'manager';
      await render();
      expect(text()).toContain('Set up your brand');
      await type('brandName', 'Acme');
      await type('website', 'acme.com');
      await act(async () => button('Continue')!.click());
      lapse();
      vi.stubGlobal('location', { href: '' });
      await act(async () => button('Continue')!.click());
      expect(createBrand).not.toHaveBeenCalled();
      expect(window.location.href).toBe('/dashboard');
    });

    it('saves no topics or prompts', async () => {
      db.ownBrand = true;
      db.orgBrandCount = 1;
      await render();
      expect(text()).toContain('Choose topics to monitor');
      lapse();
      vi.stubGlobal('location', { href: '' });
      await act(async () => button('Looks good')!.click());
      const { createTopics } = await import('@/lib/actions/topic');
      expect(createTopics).not.toHaveBeenCalled();
      expect(window.location.href).toBe('/dashboard/settings/billing');
    });
  });

  it('falls through to the choice for an admin onboarded with no organization, never to the dashboard', async () => {
    // The dashboard sends anyone with no organization here: pushing it back would loop.
    db.orgId = null;
    db.org = null;
    const push = vi.spyOn(stable.router, 'push');
    await render();
    expect(push).not.toHaveBeenCalled();
    expect(text()).toContain('How do you want to start?');
  });

  it('lands on the dashboard without a job when no run could be started', async () => {
    db.onboarded = false;
    db.ownBrand = true;
    db.promptSets = [{ id: 's1' }];
    finishSetup.mockResolvedValueOnce({ ok: true, jobId: null });
    await render();
    vi.stubGlobal('location', { href: '' });
    await act(async () => button('Start tracking with 1 competitor')!.click());
    expect(window.location.href).toBe('/dashboard');
  });

  it('goes to the plan step, as before, when the plan is no longer active at the end', async () => {
    db.onboarded = false;
    db.ownBrand = true;
    db.promptSets = [{ id: 's1' }];
    finishSetup.mockResolvedValueOnce({ ok: false, reason: 'no_plan' });
    await render();
    await act(async () => button('Start tracking with 1 competitor')!.click());
    await act(async () => {});
    expect(text()).toContain('Choose Your Plan');
    expect(stepDots()).toHaveLength(6);
    expect(db.log).toEqual([{ profiles: { onboarding_completed: true } }]);
  });

  it('stays on the competitors, to try again, when setup could not be finished', async () => {
    db.onboarded = false;
    db.ownBrand = true;
    db.promptSets = [{ id: 's1' }];
    finishSetup.mockResolvedValueOnce({ ok: false, reason: 'failed' });
    await render();
    await act(async () => button('Start tracking with 1 competitor')!.click());
    expect(toast.error).toHaveBeenCalledWith("We couldn't finish setup. Please try again.");
    expect(text()).toContain('Add your competitors');
    expect(button('Start tracking with 1 competitor')!.disabled).toBe(false);
    expect(db.log).toEqual([]);

    finishSetup.mockRejectedValueOnce(new Error('An error occurred in the Server Components'));
    await act(async () => button('Start tracking with 1 competitor')!.click());
    expect(toast.error).toHaveBeenLastCalledWith("We couldn't finish setup. Please try again.");
  });

  describe('"Manage your plan"', () => {
    const link = () => container.querySelector<HTMLAnchorElement>('[data-slot="manage-plan"]');
    afterEach(() => {
      document.cookie = 'ansvisor_setup_deferred=; path=/; max-age=0';
    });

    it('offers its admin Billing first: setup put off for half an hour, then Billing opens', async () => {
      await render();
      expect(text()).toContain('Set up your brand');
      expect(link()?.textContent).toBe('Manage your plan');
      expect(link()?.getAttribute('href')).toBe('/dashboard/settings/billing');
      expect(document.cookie).not.toContain('ansvisor_setup_deferred');

      vi.stubGlobal('location', { href: '', protocol: 'http:' });
      await act(async () => link()!.click());
      expect(document.cookie).toContain('ansvisor_setup_deferred=1');
      expect(window.location.href).toBe('/dashboard/settings/billing');
      expect(track).toHaveBeenCalledWith('onboarding_manage_plan_opened', {
        step: 1,
        setup_after_purchase: true,
      });
    });

    it('stays on every setup step, a resumed one too', async () => {
      db.onboarded = false;
      db.ownBrand = true;
      db.promptSets = [{ id: 's1' }];
      await render();
      expect(text()).toContain('Add your competitors');
      expect(link()?.textContent).toBe('Manage your plan');
    });

    it('is not offered to a manager, who cannot change the plan', async () => {
      db.role = 'manager';
      await render();
      expect(text()).toContain('Set up your brand');
      expect(link()).toBeNull();
    });
  });

  describe('"Connect your site", after Finish', () => {
    const TAG = '<script src="https://api.ansvisor.com/t.js" data-t="abc123" defer></script>';
    const snippetBox = () => container.querySelector('[data-slot="connect-site"] pre');
    const clipboard = { writeText: vi.fn(async () => {}) };
    /** Setup resumed on the competitors, with a tracking code, then Finish. */
    async function finish() {
      await render();
      vi.stubGlobal('location', { href: '' });
      await act(async () => button('Start tracking with 1 competitor')!.click());
    }

    beforeEach(() => {
      db.onboarded = false;
      db.ownBrand = true;
      db.orgBrandCount = 1;
      db.promptSets = [{ id: 's1' }];
      db.trackingCode = 'abc123';
      clipboard.writeText.mockClear();
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    });

    it("starts tracking, then shows the brand's snippet as the last of six steps", async () => {
      await render();
      expect(text()).toContain('Add your competitors');
      expect(stepDots()).toHaveLength(6);
      vi.stubGlobal('location', { href: '' });
      await act(async () => button('Start tracking with 1 competitor')!.click());

      // Finish ran first: tracking has started, and the page stays.
      expect(finishSetup).toHaveBeenCalledWith('b1');
      expect(track).toHaveBeenCalledWith('onboarding_finished', {
        paid: true,
        setup_after_purchase: true,
      });
      expect(window.location.href).toBe('');
      expect(toast.success).not.toHaveBeenCalled();
      expect(text()).toContain('Your first tracking run has started.');
      expect(text()).toContain('Connect your site');
      expect(snippetBox()?.textContent).toBe(TAG);
      expect(button('Done, go to my dashboard')).toBeDefined();
      expect(button("I'll do it later")).toBeDefined();
      // The sixth of six dots, the current one; no way back, and no "Manage your plan".
      expect(stepDots()).toHaveLength(6);
      expect(stepDots().findIndex((dot) => dot.classList.contains('w-6'))).toBe(5);
      expect(button('Back')).toBeUndefined();
      expect(container.querySelector('[data-slot="manage-plan"]')).toBeNull();
      expect(track).toHaveBeenCalledWith('onboarding_step_viewed', {
        step: 7,
        step_name: 'connect_site',
        setup_after_purchase: true,
      });
    });

    it('copies the snippet, and counts the copy', async () => {
      await finish();
      const copy = container.querySelector<HTMLButtonElement>(
        '[aria-label="Copy tracking script"]',
      )!;
      await act(async () => copy.click());
      expect(clipboard.writeText).toHaveBeenCalledWith(TAG);
      expect(track).toHaveBeenCalledWith('onboarding_snippet_copied', {
        setup_after_purchase: true,
      });
    });

    it('offers the message for the developer, by email or copied, and counts each', async () => {
      await finish();
      const email = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(
        (a) => a.textContent === 'Email this to my developer',
      )!;
      const mail = new URL(email.href);
      expect(mail.pathname).toBe('');
      expect(mail.searchParams.get('subject')).toBe(
        'Please add the Ansvisor tracking code to acme.com',
      );
      expect(mail.searchParams.get('body')).toContain(`\r\n\r\n${TAG}\r\n\r\n`);
      email.addEventListener('click', (e) => e.preventDefault());
      await act(async () => email.click());
      expect(track).toHaveBeenCalledWith('onboarding_snippet_emailed', {
        setup_after_purchase: true,
      });

      await act(async () => button('Copy message')!.click());
      expect(clipboard.writeText).toHaveBeenCalledWith(
        mail.searchParams.get('body')!.replace(/\r\n/g, '\n'),
      );
      expect(track).toHaveBeenCalledWith('onboarding_snippet_message_copied', {
        setup_after_purchase: true,
      });
      // The snippet's own copy is counted apart.
      expect(track).not.toHaveBeenCalledWith('onboarding_snippet_copied', expect.anything());
    });

    it("checks the brand's home page, saying what it found", async () => {
      await finish();
      checkTrackingSnippet.mockResolvedValueOnce({
        ok: true,
        status: 'not_found',
        domain: 'acme.com',
        checkedAt: new Date().toISOString(),
      });
      await act(async () => button('Check again')!.click());
      expect(checkTrackingSnippet).toHaveBeenCalledWith('b1');
      expect(text()).toContain("Not found on acme.com's home page yet.");
      expect(track).toHaveBeenCalledWith('onboarding_snippet_checked', {
        outcome: 'not_found',
        setup_after_purchase: true,
      });

      checkTrackingSnippet.mockResolvedValueOnce({
        ok: true,
        status: 'found',
        domain: 'acme.com',
        checkedAt: new Date().toISOString(),
      });
      await act(async () => button('Check again')!.click());
      expect(container.querySelector('[data-slot="snippet-found"]')?.textContent).toBe(
        'Found on acme.com. AI visits show in AI Traffic as they arrive.',
      );
      expect(track).toHaveBeenCalledWith('onboarding_snippet_checked', {
        outcome: 'found',
        setup_after_purchase: true,
      });
    });

    it('lands on the dashboard with the run on Done', async () => {
      await finish();
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[aria-label="Copy tracking script"]')!.click(),
      );
      await act(async () => button('Done, go to my dashboard')!.click());
      expect(window.location.href).toBe('/dashboard?jobId=job1');
      expect(track).toHaveBeenCalledWith('onboarding_connect_site_done', {
        copied: true,
        setup_after_purchase: true,
      });
      expect(button("I'll do it later")!.disabled).toBe(true);
    });

    it('lands the same way on Later, without a job when no run could be started', async () => {
      finishSetup.mockResolvedValueOnce({ ok: true, jobId: null });
      await finish();
      expect(text()).toContain('Connect your site');
      await act(async () => button("I'll do it later")!.click());
      expect(window.location.href).toBe('/dashboard');
      expect(track).toHaveBeenCalledWith('onboarding_connect_site_skipped', {
        copied: false,
        setup_after_purchase: true,
      });
      expect(track).not.toHaveBeenCalledWith('onboarding_connect_site_done', expect.anything());
    });

    it('is skipped when the brand has no tracking code: Finish lands at once, as before', async () => {
      db.trackingCode = null;
      await render();
      expect(stepDots()).toHaveLength(5);
      vi.stubGlobal('location', { href: '' });
      await act(async () => button('Start tracking with 1 competitor')!.click());
      expect(window.location.href).toBe('/dashboard?jobId=job1');
      expect(toast.success).toHaveBeenCalledWith(
        'Setup complete! Your first tracking is starting.',
      );
      expect(text()).not.toContain('Connect your site');
      expect(
        vi.mocked(track).mock.calls.some(([, props]) => props?.step_name === 'connect_site'),
      ).toBe(false);
    });

    it('is not shown when the plan is no longer active at the end: the plan step, as before', async () => {
      finishSetup.mockResolvedValueOnce({ ok: false, reason: 'no_plan' });
      await finish();
      await act(async () => {});
      expect(text()).toContain('Choose Your Plan');
      expect(text()).not.toContain('Connect your site');
      expect(stepDots()).toHaveLength(6);
    });

    it('is not part of the old order, where the plan step follows the competitors', async () => {
      // No plan yet, a brand set up under the old order.
      db.org = null;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ trialAvailable: true, trialDays: 14 })),
      );
      await render();
      await act(async () => button('Continue with 1 competitor')!.click());
      await act(async () => {});
      expect(text()).toContain('Choose how to start');
      expect(text()).not.toContain('Connect your site');
      expect(finishSetup).not.toHaveBeenCalled();
    });

    it('is not part of a self-hosted setup, which lands on the dashboard', async () => {
      vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://aeo.example.test');
      db.org = null;
      await render();
      expect(stepDots()).toHaveLength(5);
      vi.stubGlobal('location', { href: '' });
      await act(async () => button('Start tracking with 1 competitor')!.click());
      expect(finishSetup).not.toHaveBeenCalled();
      expect(window.location.href).toBe('/dashboard');
      expect(text()).not.toContain('Connect your site');
    });
  });

  it.each([
    ['the organization has a brand of its own', () => (db.orgBrandCount = 1)],
    ['the person is an analyst', () => (db.role = 'analyst')],
    ['the brands could not be counted', () => (db.orgBrandCount = null)],
  ])('sends someone onboarded to the dashboard, as before, when %s', async (_, given) => {
    given();
    const push = vi.spyOn(stable.router, 'push');
    await render();
    expect(push).toHaveBeenCalledWith('/dashboard');
    expect(
      vi.mocked(track).mock.calls.some(([, props]) => props && 'setup_after_purchase' in props),
    ).toBe(false);
  });
});
