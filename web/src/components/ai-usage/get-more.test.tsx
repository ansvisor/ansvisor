import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { GetMoreRead, GetMoreWindow } from '@/lib/actions/get-more';
import type { AddOnPackView } from '@/lib/billing/add-on-view';
import type { AiUsage } from '@/lib/billing/ai-usage';
import type { PlanCard } from '@/lib/chat/access';
import { GB } from '@/lib/chat/files';

/**
 * The Get more window (CHAT-18 §B item 6, §C; mockup #s-limits #more): one
 * window on AI credits or Storage, "Your plan" on top, where the limit
 * stands, the packs, what a pack covers roughly, and Continue to payment
 * through Billing's purchase. Admins buy; others Ask your Admin; the trial
 * can't buy; Use your own key on Enterprise only. No window with Chat off.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
const read = vi.hoisted(() => ({ getGetMore: vi.fn() }));
vi.mock('@/lib/actions/get-more', () => read);
const addOnActions = vi.hoisted(() => ({ getBillingAddOns: vi.fn(), startAddOnPurchase: vi.fn() }));
vi.mock('@/lib/actions/add-ons', () => addOnActions);
// Growth's AI usage top-ups (00546/00547), on the AI tab.
const topUps = vi.hoisted(() => ({ readPlanAddOns: vi.fn(), applyAddOnChange: vi.fn() }));
vi.mock('@/lib/actions/plan-add-ons', () => topUps);
const planAddOns = (state = 'open') => ({
  ok: true,
  addOns: {
    state,
    interval: 'month',
    currency: 'usd',
    base: { prompts: 200, brands: 4 },
    current: { trackingUnits: 100, extraBrands: 1 },
    tiers: [],
    brandPriceCents: 2500,
    topUps: [
      { multiplier: 5, priceCents: 3900, briefs: 50, opportunities: 50 },
      { multiplier: 10, priceCents: 6900, briefs: 100, opportunities: 100 },
      { multiplier: 20, priceCents: 12900, briefs: 200, opportunities: 200 },
    ],
    renewsOn: '2026-11-29T10:00:00.000Z',
  },
});
const ai = vi.hoisted(() => ({ usage: null as AiUsage | null, refresh: vi.fn() }));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: ai.usage, refresh: ai.refresh }),
}));
const chat = vi.hoisted(() => ({ on: true }));
vi.mock('@/components/providers/chat-agentic-provider', () => ({ useChatAgentic: () => chat.on }));
const role = vi.hoisted(() => ({ canAdmin: true }));
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ role: role.canAdmin ? 'admin' : 'manager', canAdmin: role.canAdmin }),
}));
const asked = vi.hoisted(() => ({ text: '' }));
vi.mock('@/components/chat-access/ask-admin-button', () => ({
  AskAdminButton: ({ asked: text }: { asked: string }) => {
    asked.text = text;
    return <button type="button">Ask your Admin</button>;
  },
}));

const { GetMoreProvider } = await import('./get-more');
const { useGetMore } = await import('./get-more-context');
const { AiUsageGetMore } = await import('./ai-usage-get-more');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const pack = (over: Partial<AddOnPackView> & Pick<AddOnPackView, 'id'>): AddOnPackView => ({
  kind: 'ai',
  priceCents: 5000,
  currency: 'usd',
  monthly: false,
  validMonths: 12,
  mostPicked: false,
  available: true,
  adds: { kind: 'limits', count: 2 },
  ...over,
});

const PACKS: AddOnPackView[] = [
  pack({ id: 'ai_10', priceCents: 1000, adds: { kind: 'share', percent: 40 } }),
  pack({ id: 'ai_50', mostPicked: true }),
  pack({ id: 'ai_250', priceCents: 25000, adds: { kind: 'limits', count: 10 } }),
  pack({ id: 'ai_1000', priceCents: 100000, adds: { kind: 'limits', count: 40 } }),
  pack({
    id: 'storage_25',
    kind: 'storage',
    priceCents: 500,
    monthly: true,
    validMonths: null,
    mostPicked: true,
    adds: { kind: 'storage', gb: 25 },
  }),
];

const PLAN: PlanCard = {
  planId: 'growth',
  planName: 'Growth',
  priceMonthly: 249,
  isTrial: false,
  chips: [{ key: 'platforms', count: 4, locked: null }],
  next: {
    planId: 'enterprise',
    planName: 'Enterprise',
    priceMonthly: null,
    priceDiff: null,
    afterTrial: false,
    benefits: [{ key: 'contract' }],
  },
};

const windowRead = (over: Partial<GetMoreWindow> = {}, addOns = {}): GetMoreRead => ({
  ok: true,
  window: {
    addOns: { isAdmin: true, buy: 'open', packs: PACKS, credit: null, purchases: null, ...addOns },
    plan: PLAN,
    storage: { usedBytes: 2.1 * GB, limitBytes: 25 * GB, fileCount: 12 },
    ...over,
  },
});

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  plan: 'growth',
  planName: 'Growth',
  trial: false,
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  unlimited: false,
  percentUsed: 18,
  features: [],
  chatMetered: true,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

/** Opens the window from a test button, as a limit's button does. */
function Opener({ tab }: { tab?: 'ai' | 'storage' }) {
  const open = useGetMore();
  return (
    <button type="button" data-test="open" onClick={() => open?.(tab)}>
      {open ? 'open' : 'none'}
    </button>
  );
}

async function render(children: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <GetMoreProvider>{children}</GetMoreProvider>
      </NextIntlClientProvider>,
    );
  });
}
async function click(el: Element | null | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await act(async () => {});
}
async function openWindow(tab?: 'ai' | 'storage') {
  await render(<Opener tab={tab} />);
  await click(container.querySelector('[data-test="open"]'));
}
const dialog = () => document.querySelector('[data-slot="get-more"]') as HTMLElement | null;
const text = () => dialog()?.textContent ?? '';
const button = (label: string) =>
  [...document.querySelectorAll('button, a')].find((b) => b.textContent?.trim() === label) as
    | HTMLElement
    | undefined;
const cards = () => [...(dialog()?.querySelectorAll('[role="radio"]') ?? [])] as HTMLElement[];

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  chat.on = true;
  role.canAdmin = true;
  ai.usage = usage();
  ai.refresh.mockReset();
  read.getGetMore.mockReset().mockResolvedValue(windowRead());
  addOnActions.startAddOnPurchase.mockReset();
  topUps.readPlanAddOns.mockReset().mockResolvedValue(planAddOns());
  topUps.applyAddOnChange.mockReset();
  window.location.hash = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('the Get more window', () => {
  it('shows the plan, the AI limit and the AI usage top-ups, +10x picked', async () => {
    await openWindow();
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Get more AI credits');
    expect(text()).toContain('Your plan');
    expect(dialog()?.querySelector('[data-slot="get-more-limit"]')?.textContent).toBe(
      'AI usage this month: 18% · Growth · resets Nov 1',
    );
    expect(cards().map((c) => c.textContent)).toEqual([
      '+5x$395× this month’s AI usage · +50 briefs · +50 opportunities',
      '+10x$6910× this month’s AI usage · +100 briefs · +100 opportunities',
      '+20x$12920× this month’s AI usage · +200 briefs · +200 opportunities',
    ]);
    expect(cards()[1].getAttribute('aria-checked')).toBe('true');
    expect(text()).toContain('until your plan renews on Nov 29, 2026');
    // The retired credit packs and their estimates are gone.
    expect(dialog()?.querySelector('[data-slot="pack-estimates"]')).toBeNull();
    expect(button('Continue to payment')).toBeUndefined();
    // Growth: no own key (Enterprise only while Chat draws on the AI budget).
    expect(button('Use your own key')).toBeUndefined();
  });

  it('buys a top-up at once, the plan’s tracking and brands left as they are', async () => {
    topUps.applyAddOnChange.mockResolvedValue({
      ok: true,
      changed: true,
      limits: { prompts: 300, brands: 5 },
    });
    await openWindow();
    await click(cards()[2]);
    await click(button('Buy +20x · $129'));
    expect(text()).toContain('Pay $129 now, from the card on file?');
    await click(button('Pay $129'));
    expect(topUps.applyAddOnChange).toHaveBeenCalledWith({
      trackingUnits: 100,
      extraBrands: 1,
      topUp: 20,
      topUpOnly: true,
    });
    expect(text()).toContain('Top-up bought. It counts as soon as the payment is confirmed.');
  });

  it('says why a top-up wasn’t bought', async () => {
    topUps.applyAddOnChange.mockResolvedValue({
      ok: false,
      failure: 'payment_failed',
      message: 'Your card was declined.',
    });
    await openWindow();
    await click(button('Buy +10x · $69'));
    await click(button('Pay $69'));
    expect(text()).toContain("The payment didn't go through. Your card was declined.");
  });

  it('tells Starter that Growth comes with more AI usage', async () => {
    topUps.readPlanAddOns.mockResolvedValue(planAddOns('starter'));
    await openWindow();
    expect(text()).toContain('Growth comes with 5× the AI usage');
    expect(button('See Growth')?.getAttribute('href')).toBe('/dashboard/settings/billing');
    expect(cards()).toHaveLength(0);
  });

  it('opens on Storage with its meter, and adds storage once confirmed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    addOnActions.startAddOnPurchase.mockResolvedValue({ ok: true, next: 'added' });
    await openWindow('storage');
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Get more storage');
    expect(dialog()?.querySelector('[data-slot="get-more-limit"]')?.textContent).toBe(
      'Storage 2.1 of 25 GB · Growth',
    );
    expect(dialog()?.querySelector('[data-slot="pack-estimates"]')).toBeNull();
    await click(button('Continue to payment'));
    expect(dialog()?.querySelector('[data-slot="get-more-confirm"]')?.textContent).toContain(
      'Add 25 GB to your plan?',
    );
    await click(button('Add to plan'));
    expect(addOnActions.startAddOnPurchase).toHaveBeenCalledWith('storage_25');
    // It counts once Stripe's webhook hears of the payment: said so, read again a moment later.
    expect(text()).toContain(
      'Added to your plan. The storage counts as soon as the payment goes through.',
    );
    expect(ai.refresh).not.toHaveBeenCalled();
    const reads = read.getGetMore.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(5_000));
    await act(async () => {});
    expect(ai.refresh).toHaveBeenCalled();
    expect(read.getGetMore.mock.calls.length).toBe(reads + 1);
  });

  it('says a read that failed, never a window left on its skeleton', async () => {
    read.getGetMore.mockRejectedValue(new Error('502'));
    await openWindow();
    expect(text()).toContain("Couldn't read your plan and packs.");
  });

  it('says a purchase that failed to start, never a button left at Opening…', async () => {
    addOnActions.startAddOnPurchase.mockRejectedValue(new TypeError('Failed to fetch'));
    await openWindow('storage');
    await click(button('Continue to payment'));
    await click(button('Add to plan'));
    expect(text()).toContain("Couldn't start the purchase. Try again.");
    expect(button('Continue to payment')).toBeDefined();
    expect((button('Continue to payment') as HTMLButtonElement).disabled).toBe(false);
  });

  it('switches tabs in place, the picked one marked', async () => {
    await openWindow();
    const tab = (label: string) =>
      [...(dialog()?.querySelectorAll('[data-action="getMore.tab"]') ?? [])].find(
        (b) => b.textContent === label,
      )!;
    expect(tab('AI credits').getAttribute('aria-pressed')).toBe('true');
    expect(tab('AI credits').className).toContain('bg-primary');
    expect(tab('Storage').getAttribute('aria-pressed')).toBe('false');
    await click(tab('Storage'));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Get more storage');
    expect(cards()).toHaveLength(1);
    expect(tab('Storage').getAttribute('aria-pressed')).toBe('true');
    expect(tab('Storage').className).toContain('text-primary-foreground');
    expect(tab('AI credits').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the top-ups to other members, with Ask your Admin instead of payment', async () => {
    role.canAdmin = false;
    read.getGetMore.mockResolvedValue(windowRead({}, { isAdmin: false }));
    topUps.readPlanAddOns.mockResolvedValue(planAddOns('not_admin'));
    await openWindow();
    expect(cards()).toHaveLength(3);
    expect(cards().every((c) => (c as HTMLButtonElement).disabled)).toBe(true);
    expect(button('Buy +10x · $69')).toBeUndefined();
    expect(button('Ask your Admin')).toBeDefined();
    expect(asked.text).toBe('Buy an AI usage top-up');
  });

  it('lets the trial see the top-ups but not buy them', async () => {
    read.getGetMore.mockResolvedValue(
      windowRead({ plan: { ...PLAN, isTrial: true } }, { buy: 'trial' }),
    );
    topUps.readPlanAddOns.mockResolvedValue(planAddOns('trial'));
    await openWindow();
    expect(button('Buy +10x · $69')).toBeUndefined();
    expect(text()).toContain('Add-ons can be bought once your plan has started.');
    expect(text()).toContain("Trials can't buy packs. Choose a plan to buy them.");
    expect(dialog()?.querySelector('[data-slot="get-more-limit"]')?.textContent).toContain(
      'Trial · Growth',
    );
  });

  it('offers your own key on Enterprise', async () => {
    read.getGetMore.mockResolvedValue(
      windowRead({ plan: { ...PLAN, planId: 'enterprise', planName: 'Enterprise', next: null } }),
    );
    await openWindow();
    expect(button('Use your own key')?.getAttribute('href')).toBe(
      '/dashboard/settings/ai-providers',
    );
  });

  it('says when the read failed', async () => {
    read.getGetMore.mockResolvedValue({ ok: false, failure: 'failed' });
    await openWindow();
    expect(text()).toContain("Couldn't read your plan and packs.");
  });

  it('is not there with Chat off, nor self-hosted', async () => {
    chat.on = false;
    await render(<Opener />);
    expect(container.textContent).toBe('none');
    chat.on = true;
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await render(<Opener />);
    expect(container.textContent).toBe('none');
  });
});

describe('Get more AI credits in the meter and the banner', () => {
  const getMore = (props: Partial<Parameters<typeof AiUsageGetMore>[0]> = {}) =>
    render(<AiUsageGetMore plan="growth" chatMetered primary {...props} />);

  it('opens the window, for every member, and no own key on Growth', async () => {
    await getMore();
    expect(button('Use your own key')).toBeUndefined();
    await click(button('Get more AI credits'));
    expect(dialog()).not.toBeNull();
    act(() => root.unmount());
    role.canAdmin = false;
    root = createRoot(container);
    await getMore();
    expect(button('Get more AI credits')).toBeDefined();
  });

  it('keeps starting the plan in the trial, and the old links with Chat off', async () => {
    await getMore({ trial: true });
    // The trial's own way to more: Start my plan now (the trial can't buy packs).
    expect(button('Start my plan now')).toBeDefined();
    expect(button('Get more AI credits')).toBeUndefined();
    act(() => root.unmount());
    chat.on = false;
    root = createRoot(container);
    await getMore({ chatMetered: false });
    expect(button('Get more AI usage')).toBeDefined();
    expect(button('Use your own key')).toBeDefined();
  });

  it('offers the own key on Enterprise', async () => {
    await getMore({ plan: 'enterprise' });
    expect(button('Use your own key')).toBeDefined();
  });
});
