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
const db = vi.hoisted(() => ({ promptSets: [] as { id: string }[] }));
vi.mock('@/lib/supabase/client', () => {
  /** A query that answers `data` however it ends (single, limit, or awaited). */
  const query = (data: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit', 'order', 'update']) q[m] = () => q;
    q.single = async () => ({ data });
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data });
    return q;
  };
  const rows: Record<string, () => unknown> = {
    profiles: () => ({ organization_id: 'org-1', onboarding_completed: false }),
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
      from: (table: string) => query(rows[table]?.() ?? null),
    }),
  };
});
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
vi.mock('@/lib/actions/menu-access', () => ({ setMyWorkAreas: vi.fn() }));
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
