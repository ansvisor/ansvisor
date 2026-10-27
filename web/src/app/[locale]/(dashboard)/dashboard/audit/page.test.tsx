import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

/**
 * Site Audit on a read-only workspace (plan not active): Run audit, by its
 * button or Enter in the address, opens the upgrade dialog instead of
 * starting an audit. On an active plan it starts one and opens it.
 */

const audits = vi.hoisted(() => ({
  runAudit: vi.fn(),
  runAuditsBulk: vi.fn(),
  getAuditPages: vi.fn(),
  getAuditHub: vi.fn(),
  getAuditHubExtras: vi.fn(),
  setOpportunityPrefs: vi.fn(),
  getAuditSettings: vi.fn(),
  getAuditTemplates: vi.fn(),
  saveAuditSettings: vi.fn(),
  deleteAudit: vi.fn(),
}));
vi.mock('@/lib/actions/audits', () => audits);
const brandState = vi.hoisted(() => ({
  activeBrandId: 'b1',
  brands: [{ id: 'b1', name: 'Acme', domains: [{ domain: 'acme.com', isPrimary: true }] }],
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: Object.assign((select: (state: unknown) => unknown) => select(brandState), {
    getState: () => brandState,
  }),
}));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => ({ canManage: true }) }));
const push = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// The page's cards and lists have tests of their own; here they stay out of the way.
vi.mock('./_site-trust-card', () => ({ SiteTrustCard: () => null }));
vi.mock('./_charts', () => ({ ScoreTrendChart: () => null }));
vi.mock('./_pages-table', () => ({ AuditPagesTable: () => null }));
vi.mock('./_bulk-bar', () => ({ AuditBulkBar: () => null, ExportMenu: () => null }));
vi.mock('./_overview-cards', () => ({ AuditOverviewCards: () => null }));
vi.mock('./_opportunities-table', () => ({
  OpportunitiesTable: () => null,
  opportunityAuditUrls: () => [],
}));
vi.mock('./_settings-dialog', () => ({ AuditSettingsDialog: () => null }));
vi.mock('./_auto-run-notice', () => ({ AutoRunNotice: () => null }));
vi.mock('./_summary-strip', () => ({ AuditSummaryStrip: () => null }));
vi.mock('./_quota-meter', () => ({ EmptyPoolMessage: () => null }));
vi.mock('./_use-pages-export', () => ({
  usePagesExport: () => ({ exporting: false, exportAll: vi.fn(), exportPages: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: SiteAuditPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  audits.getAuditHub.mockResolvedValue({
    pages: { pages: [], total: 0, primaryHost: 'acme.com' },
    quota: { used: 0, limit: 10, remaining: 10 },
    trend: null,
    overview: null,
  });
  audits.getAuditHubExtras.mockResolvedValue({
    opportunities: { opportunities: [], excluded: [] },
    latestRun: null,
  });
  audits.runAudit.mockResolvedValue({ id: 'a1' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <SiteAuditPage />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const runButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Run Audit')!;
const pressEnter = () =>
  act(async () => {
    container
      .querySelector('input[aria-label="Website URL"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });

describe('SiteAuditPage Run audit', () => {
  it('starts no audit on a read-only workspace: the button and Enter open the upgrade dialog', async () => {
    await render(true);
    await act(async () => runButton().click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Running an audit needs a plan');
    await pressEnter();
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(openUpgrade).toHaveBeenLastCalledWith('Running an audit needs a plan');
    expect(audits.runAudit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  // The server reads 0 of 0 without an active plan (noPlan): not "used up".
  it('keeps Run Audit clickable without an active plan, with no red 0/0: it opens the upgrade dialog', async () => {
    audits.getAuditHub.mockResolvedValue({
      pages: { pages: [], total: 0, primaryHost: 'acme.com' },
      quota: { used: 12, limit: 0, remaining: 0, noPlan: true },
      trend: null,
      overview: null,
    });
    await render(true);
    expect(runButton().disabled).toBe(false);
    expect(container.textContent).not.toContain('0/0');
    expect(container.querySelector('.text-destructive')).toBeNull();
    await act(async () => runButton().click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Running an audit needs a plan');
    expect(audits.runAudit).not.toHaveBeenCalled();
  });

  it('still keeps Run Audit off with the red count once an active plan is used up', async () => {
    audits.getAuditHub.mockResolvedValue({
      pages: { pages: [], total: 0, primaryHost: 'acme.com' },
      quota: { used: 10, limit: 10, remaining: 0 },
      trend: null,
      overview: null,
    });
    await render(false);
    expect(runButton().disabled).toBe(true);
    expect(container.querySelector('.text-destructive')?.textContent).toContain('0/10');
  });

  it('starts an audit on the button on an active plan, and opens it', async () => {
    await render(false);
    await act(async () => runButton().click());
    expect(audits.runAudit).toHaveBeenCalledExactlyOnceWith('b1', 'https://acme.com');
    expect(push).toHaveBeenCalledWith('/dashboard/audit/a1');
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('starts an audit on Enter on an active plan', async () => {
    await render(false);
    await pressEnter();
    expect(audits.runAudit).toHaveBeenCalledExactlyOnceWith('b1', 'https://acme.com');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
