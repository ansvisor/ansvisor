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
    brands: () =>
      db.ownBrand
        ? [
            {
              id: 'b1',
              organization_id: 'org-1',
              name: 'Acme',
              slug: 'acme',
              brand_domains: [{ id: 'd1', brand_id: 'b1', domain: 'acme.com', is_primary: true }],
            },
          ]
        : [],
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
vi.mock('@/lib/actions/volumes', () => ({ bootstrapBrandVolumes: vi.fn() }));
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
  exploreDemo.opening = false;
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
    await act(async () => button('Start tracking with 1 competitor')!.click());
    await act(async () => {});
    expect(text()).toContain('Choose how to start');
    expect(text()).not.toContain('What do you work on?');
    // The step dots: six, the plan's the current one.
    const dots = [...container.querySelector('.w-6.bg-foreground')!.parentElement!.children];
    expect(dots).toHaveLength(6);
    expect(dots.findIndex((dot) => dot.classList.contains('w-6'))).toBe(5);
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

  it('offers one choice of how to start, then one button on each plan, a card for both', async () => {
    await render();
    expect(text()).toContain('Choose how to start');
    expect(text()).not.toContain('Start Your 14-Day Free Trial');
    expect(text()).not.toContain('No charge today');
    // The first-month offer is on the cards, not by Monthly; the demo comes last.
    expect(choices()).toEqual(['14-day trial', 'Monthly', 'YearlySave 20%', 'Demo · no card']);
    expect(text()).not.toContain('50% off the first month');
    // Monthly first, with the first-month offer: its price large on the card.
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
    await choose('trial');
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
});
