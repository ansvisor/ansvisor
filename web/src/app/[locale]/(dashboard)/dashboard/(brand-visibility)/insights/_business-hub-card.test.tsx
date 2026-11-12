import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { BusinessHubCard as CardData } from '@/lib/actions/business-hub';
import type { BusinessHubEntry } from '@/lib/business-hub/numbers';

/**
 * Visibility's ChatGPT Business Hub card: hidden until there is something to
 * show, Business Hub's numbers beside Ansvisor's with their changes, "Not
 * shown" for a number Business Hub doesn't show, a failed read hiding it,
 * the link's ?businessHub=enter opening the dialog, and the dialog checking
 * an entry before it is saved.
 */

const actions = vi.hoisted(() => ({
  getBusinessHubCard: vi.fn(),
  saveBusinessHubSnapshot: vi.fn(),
  deleteBusinessHubSnapshot: vi.fn(),
}));
vi.mock('@/lib/actions/business-hub', () => actions);
const role = vi.hoisted(() => ({ canManage: false }));
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ role: role.canManage ? 'manager' : 'analyst', ...role }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { BusinessHubCard } = await import('./_business-hub-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '33333333-3333-3333-3333-333333333333';

const entry = (over: Partial<BusinessHubEntry> = {}): BusinessHubEntry => ({
  id: 'e2',
  periodDays: 7,
  periodEnd: '2026-11-10',
  mentions: 53,
  websiteClicks: 19,
  profileViews: null,
  topics: ['Coffee subscriptions', 'Decaf coffee'],
  source: 'manual',
  updatedAt: null,
  ...over,
});
const ours = { visibility: 41.5, answers: 120, named: 34, cited: 9, visits: 42 };
const card = (over: Partial<CardData> = {}): CardData => ({
  show: true,
  entries: [entry()],
  latest: entry(),
  previous: null,
  ours,
  oursPrevious: null,
  trackedTopics: ['Coffee subscriptions'],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <BusinessHubCard brandId={BRAND} />
      </NextIntlClientProvider>,
    );
  });
}

const text = () => document.body.textContent ?? '';
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  );

beforeEach(() => {
  vi.clearAllMocks();
  role.canManage = false;
  window.history.replaceState(null, '', '/dashboard/insights');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BusinessHubCard', () => {
  it('shows nothing when hidden, and nothing when its read fails', async () => {
    actions.getBusinessHubCard.mockResolvedValue(card({ show: false }));
    await render();
    expect(container.innerHTML).toBe('');
    act(() => root.unmount());
    root = createRoot(container);
    actions.getBusinessHubCard.mockRejectedValue(new Error('timeout'));
    await render();
    expect(container.innerHTML).toBe('');
  });

  it('puts one entry’s numbers beside Ansvisor’s, with Not shown and the note on how they differ', async () => {
    actions.getBusinessHubCard.mockResolvedValue(card());
    await render();
    expect(actions.getBusinessHubCard).toHaveBeenCalledWith(BRAND, { asked: false });
    const shown = text();
    expect(shown).toContain('ChatGPT Business Hub');
    expect(shown).toContain('7 days to Nov 10');
    expect(shown).toContain('Mentions');
    expect(shown).toContain('53');
    expect(shown).toContain('Not shown');
    expect(shown).toContain('ChatGPT visibility');
    expect(shown).toContain('41.5');
    expect(shown).toContain('Answers naming you');
    expect(shown).toContain('of 120');
    expect(shown).toContain('Visits from ChatGPT');
    expect(shown).toContain('compare their direction, not their size');
    expect(shown).toContain('Some clicks arrive without a referrer.');
    // No entry before: no changes.
    expect(shown).not.toMatch(/\+\d/);
    // The tracked topic says so; the other has no Suggest prompts for an analyst.
    expect(shown).toContain('Tracked');
    expect(shown).not.toContain('Suggest prompts');
  });

  it('shows each number’s change against the entry before of the same length', async () => {
    const before = entry({ id: 'e1', periodEnd: '2026-11-03', mentions: 44, websiteClicks: 21 });
    actions.getBusinessHubCard.mockResolvedValue(
      card({
        entries: [entry(), before],
        previous: before,
        oursPrevious: { visibility: 38, answers: 110, named: 30, cited: 9, visits: 35 },
      }),
    );
    await render();
    const shown = text();
    expect(shown).toContain('+9');
    expect(shown).toContain('−2');
    expect(shown).toContain('+3.5');
    expect(shown).toContain('+4');
    expect(shown).toContain('+7');
    expect(shown).toContain('±0');
  });

  it('says so when Business Hub showed no numbers, and when ChatGPT had no answers', async () => {
    const topicsOnly = entry({ mentions: null, websiteClicks: null, profileViews: null });
    actions.getBusinessHubCard.mockResolvedValue(
      card({
        entries: [topicsOnly],
        latest: topicsOnly,
        ours: { ...ours, answers: 0, named: 0, cited: 0, visibility: null, visits: null },
      }),
    );
    await render();
    expect(text()).toContain('Business Hub showed no numbers for these days.');
    expect(text()).toContain('No ChatGPT answers tracked on these days.');
    expect(text()).toContain("Couldn't read");
  });

  it('offers Suggest prompts on an untracked topic to an admin or a manager', async () => {
    role.canManage = true;
    actions.getBusinessHubCard.mockResolvedValue(card());
    await render();
    const link = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Suggest prompts',
    );
    expect(link?.getAttribute('href')).toBe(
      '/dashboard/prompts/suggestions?source=business_hub&hub=1',
    );
  });

  it('opens the dialog from the setup action’s link, before any entry', async () => {
    window.history.replaceState(null, '', '/dashboard/insights?businessHub=enter');
    actions.getBusinessHubCard.mockResolvedValue(card({ entries: [], latest: null, ours: null }));
    await render();
    expect(actions.getBusinessHubCard).toHaveBeenCalledWith(BRAND, { asked: true });
    expect(text()).toContain('No numbers yet.');
    expect(text()).toContain('Enter Business Hub numbers');
    expect(window.location.search).toBe('');
  });
});

describe('Enter numbers', () => {
  const type = async (label: string, value: string) => {
    const input = document.getElementById(label) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const open = async () => {
    actions.getBusinessHubCard.mockResolvedValue(card());
    await render();
    await act(async () => button('Enter numbers')!.click());
  };

  it('refuses an empty entry and a number that isn’t whole, saying why beside it', async () => {
    await open();
    await act(async () => button('Save')!.click());
    expect(text()).toContain('Enter at least one number or topic.');
    await type('bh-mentions', '12.5');
    await act(async () => button('Save')!.click());
    expect(text()).toContain('Enter a whole number, or leave it empty.');
    expect(actions.saveBusinessHubSnapshot).not.toHaveBeenCalled();
  });

  it('saves the entry, reads the card again and says so', async () => {
    actions.saveBusinessHubSnapshot.mockResolvedValue({ saved: true, replaced: false });
    await open();
    await type('bh-last-day', '2026-11-03');
    await type('bh-mentions', '1.240');
    await act(async () => button('Save')!.click());
    expect(actions.saveBusinessHubSnapshot).toHaveBeenCalledWith(BRAND, {
      periodDays: 7,
      periodEnd: '2026-11-03',
      mentions: 1240,
      websiteClicks: null,
      profileViews: null,
      topics: [],
    });
    expect(toast.success).toHaveBeenCalledWith('Business Hub numbers saved');
    expect(actions.getBusinessHubCard).toHaveBeenCalledTimes(2);
  });

  it('says a save replaces the entry for the same days', async () => {
    await open();
    await type('bh-last-day', '2026-11-10');
    expect(text()).toContain('This replaces your entry for the same days.');
  });
});
