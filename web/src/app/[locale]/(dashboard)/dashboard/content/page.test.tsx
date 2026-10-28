import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { ContentOpportunity } from '@/types';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

/**
 * Content Opportunities on a read-only workspace (plan not active): New, the
 * bulk bar, the rows' menu and the workflow settings open the upgrade dialog
 * instead, named; on an active plan they run.
 */

const content = vi.hoisted(() => ({
  generateOpportunitiesOnDemand: vi.fn(),
  getGenerationJobStatus: vi.fn(),
  getContentUsage: vi.fn(),
  getOpportunities: vi.fn(),
  getOpportunityPrompts: vi.fn(),
  getOpportunityTopics: vi.fn(),
  updateOpportunityStatus: vi.fn(),
  sendToWebhook: vi.fn(),
  bulkSendToWebhook: vi.fn(),
  bulkUpdateStatus: vi.fn(),
  bulkDeleteOpportunities: vi.fn(),
  getWebhookConfig: vi.fn(),
  saveWebhookConfig: vi.fn(),
  testWebhook: vi.fn(),
}));
vi.mock('@/lib/actions/content', () => content);
vi.mock('@/lib/actions/content-drafts', () => ({
  getOpportunityDrafts: vi.fn(async () => ({})),
}));
const plan = vi.hoisted(() => ({
  getPlanPriorities: vi.fn(async () => []),
  setPlanRowPriority: vi.fn(async () => undefined),
}));
vi.mock('@/lib/actions/content-plan', () => plan);
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => ({ canManage: true }) }));
const brandState = vi.hoisted(() => ({
  activeBrandId: 'b1',
  brands: [{ id: 'b1', name: 'Acme', slug: 'acme', siteType: 'b2b' }],
  getActiveBrand: () => ({ id: 'b1', slug: 'acme' }),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (state: typeof brandState) => unknown) => select(brandState),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// The dialogs are their own tests'; here, whether the page opens them.
const opened = vi.hoisted(() => ({ newOpportunities: false, newContent: false }));
vi.mock('@/components/content/new-opportunities-dialog', () => ({
  NewOpportunitiesDialog: ({ open }: { open: boolean }) => {
    opened.newOpportunities = open;
    return null;
  },
}));
vi.mock('@/components/content/new-content-dialog', () => ({
  NewContentDialog: ({ open }: { open: boolean }) => {
    opened.newContent = open;
    return null;
  },
}));
vi.mock('@/components/content/opportunity-detail', () => ({ OpportunityDetail: () => null }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

const { default: ContentPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const OPPORTUNITY: ContentOpportunity = {
  id: 'o1',
  brandId: 'b1',
  title: 'Office coffee subscriptions',
  description: 'A page AI answers lack.',
  type: 'owned',
  impact: 'high',
  opportunityScore: 74,
  status: 'new',
  source: 'system',
  sourceData: {},
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
} as ContentOpportunity;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ContentPage />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const buttonNamed = (name: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
const pickRow = async () => {
  const box = container.querySelector<HTMLElement>('tbody [role="checkbox"]')!;
  await act(async () => box.click());
};
const rowItem = async (item: string) => {
  const trigger = container.querySelector<HTMLElement>(
    '[aria-label="Actions for Office coffee subscriptions"]',
  )!;
  await act(async () => trigger.click());
  const found = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent === item,
  )!;
  await act(async () => found.click());
};

beforeEach(() => {
  vi.clearAllMocks();
  opened.newOpportunities = false;
  opened.newContent = false;
  window.history.replaceState(null, '', '/dashboard/content');
  content.getOpportunities.mockResolvedValue({
    opportunities: [OPPORTUNITY],
    total: 1,
    aggregates: { avgScore: 74, highImpactCount: 1, sentCount: 0, signalCount: 0 },
  });
  content.getOpportunityPrompts.mockResolvedValue([]);
  content.getOpportunityTopics.mockResolvedValue([]);
  content.getContentUsage.mockResolvedValue(null);
  content.bulkUpdateStatus.mockResolvedValue({ updated: 1 });
  content.getWebhookConfig.mockResolvedValue({
    webhookUrl: 'https://hooks.example/acme',
    webhookSecret: '',
    isActive: true,
    events: ['opportunity.sent'],
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Content Opportunities on a read-only workspace', () => {
  it('asks the AI for nothing: New opens the upgrade dialog, not its own', async () => {
    await render(true);
    await act(async () => buttonNamed('New').click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Generating opportunities needs a plan');
    expect(opened.newOpportunities).toBe(false);
  });

  it('opens the upgrade dialog from the bulk bar, without asking first', async () => {
    await render(true);
    await pickRow();
    await act(async () => buttonNamed('Send All').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Sending to your workflow needs a plan');
    await act(async () => buttonNamed('Done').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Marking opportunities done needs a plan');
    await act(async () => buttonNamed('Dismiss All').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Dismissing opportunities needs a plan');
    await act(async () => buttonNamed('Delete').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Deleting opportunities needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(4);
    // No confirmation opened, and nothing sent or changed.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(content.bulkSendToWebhook).not.toHaveBeenCalled();
    expect(content.bulkUpdateStatus).not.toHaveBeenCalled();
    expect(content.bulkDeleteOpportunities).not.toHaveBeenCalled();
  });

  it('opens the upgrade dialog from the row’s menu', async () => {
    await render(true);
    await rowItem('Send to Editor');
    expect(openUpgrade).toHaveBeenLastCalledWith('Creating content needs a plan');
    await rowItem('Send to Plan');
    expect(openUpgrade).toHaveBeenLastCalledWith('Marking priorities needs a plan');
    await rowItem('Send to Workflow');
    expect(openUpgrade).toHaveBeenLastCalledWith('Sending to your workflow needs a plan');
    await rowItem('Dismiss');
    expect(openUpgrade).toHaveBeenLastCalledWith('Dismissing opportunities needs a plan');
    expect(opened.newContent).toBe(false);
    expect(plan.setPlanRowPriority).not.toHaveBeenCalled();
    expect(content.sendToWebhook).not.toHaveBeenCalled();
    expect(content.updateOpportunityStatus).not.toHaveBeenCalled();
  });

  it('shows the workflow settings, and saves or tests nothing', async () => {
    await render(true);
    await act(async () => buttonNamed('Webhook Settings').click());
    await act(async () => {});
    expect(content.getWebhookConfig).toHaveBeenCalledWith('b1');
    await act(async () => buttonNamed('Save Webhook').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Saving the workflow settings needs a plan');
    await act(async () => buttonNamed('Test Webhook').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Testing the workflow needs a plan');
    expect(content.saveWebhookConfig).not.toHaveBeenCalled();
    expect(content.testWebhook).not.toHaveBeenCalled();
  });
});

describe('the usage card and New without an active plan', () => {
  // The server reads limits of 0 and `noPlan` once the plan has ended.
  const usage = (over: Record<string, unknown> = {}) => ({
    plan: 'growth',
    planName: 'Growth',
    periodStart: '2026-10-01T00:00:00.000Z',
    periodEnd: '2026-11-01T00:00:00.000Z',
    opportunities: { used: 2, limit: 0, remaining: 0, perRequest: 0, noPlan: true },
    briefs: { used: 4, limit: 0, remaining: 0, noPlan: true },
    noPlan: true,
    ...over,
  });

  it('says "No active plan", not "Limit reached" or the old plan, and New opens the plan dialog', async () => {
    content.getContentUsage.mockResolvedValue(usage());
    await render(true);
    expect(container.textContent).toContain('No active plan');
    expect(container.textContent).not.toContain('Limit reached');
    expect(container.textContent).not.toContain('Growth plan');
    // The usage card: the counts used, no red bar or line.
    const card = [...container.querySelectorAll('[data-slot="card"]')].find((el) =>
      el.textContent?.includes('This billing period'),
    )!;
    expect(card.textContent).toContain('New opportunities2');
    expect(card.querySelector('.text-red-600, .bg-red-500')).toBeNull();
    // Nothing renews without a plan: the hint says what counts, not when it resets.
    const hint = card.querySelector('[title]')!.getAttribute('title');
    expect(hint).toContain('Every new opportunity counts once');
    expect(hint).not.toContain('when your subscription renews');
    expect(buttonNamed('New').disabled).toBe(false);
    await act(async () => buttonNamed('New').click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Generating opportunities needs a plan');
  });

  it('still says "Limit reached" with the plan, and keeps New off, once an active plan is used up', async () => {
    content.getContentUsage.mockResolvedValue({
      ...usage(),
      noPlan: undefined,
      opportunities: { used: 50, limit: 50, remaining: 0, perRequest: 5 },
      briefs: { used: 4, limit: 50, remaining: 46 },
    });
    await render(false);
    expect(container.textContent).toContain('Limit reached');
    expect(container.textContent).toContain('Growth plan');
    expect(container.textContent).not.toContain('No active plan');
    const card = [...container.querySelectorAll('[data-slot="card"]')].find((el) =>
      el.textContent?.includes('This billing period'),
    )!;
    expect(card.querySelector('[title]')!.getAttribute('title')).toContain(
      "Unused allowance doesn't carry over. Both reset on Nov 1, when your subscription renews.",
    );
    expect(buttonNamed('New').disabled).toBe(true);
  });
});

describe('Content Opportunities on an active plan', () => {
  it('runs the actions', async () => {
    await render(false);
    await act(async () => buttonNamed('New').click());
    expect(opened.newOpportunities).toBe(true);
    await pickRow();
    await act(async () => buttonNamed('Done').click());
    expect(content.bulkUpdateStatus).toHaveBeenCalledWith(['o1'], 'done');
    await pickRow();
    await act(async () => buttonNamed('Dismiss All').click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Dismiss opportunities?',
    );
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
