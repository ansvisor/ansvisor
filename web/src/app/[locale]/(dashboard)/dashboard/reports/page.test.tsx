import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import { ChatAgenticProvider } from '@/components/providers/chat-agentic-provider';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';

/**
 * Reports on a read-only workspace (plan not active): the reports list and
 * open; Generate Report and Delete (before its confirm) open the upgrade
 * dialog instead.
 */

const reports = vi.hoisted(() => ({
  getReports: vi.fn(),
  getReport: vi.fn(),
  createReport: vi.fn(),
  renameReport: vi.fn(),
  deleteReport: vi.fn(),
}));
vi.mock('@/lib/actions/reports', () => reports);
const getReportBranding = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/white-label', () => ({ getReportBranding }));
const brandHasShipped = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/impact-report', () => ({ brandHasShipped }));
const saveReportPdf = vi.hoisted(() => vi.fn());
vi.mock('./_save-pdf', () => ({ saveReportPdf }));
const brand = { id: 'b1', name: 'Acme', shoppingModeEnabled: false };
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (state: unknown) => unknown) =>
    select({ activeBrandId: 'b1', brands: [brand] }),
}));
const push = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
// HubSpot's pipeline section comes with the plan's crm_integrations (#2140).
const plan = vi.hoisted(() => ({ crm: true }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({
    canUse: (feature: string) => feature !== 'crm_integrations' || plan.crm,
    requiredPlanFor: () => 'Growth',
  }),
}));

const { chatPage } = vi.hoisted(() => ({ chatPage: vi.fn() }));
vi.mock('@/components/chat/panel/chat-panel-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatPageContext: chatPage,
}));
const { default: ReportsPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  brandHasShipped.mockResolvedValue(false);
  plan.crm = true;
  reports.getReports.mockResolvedValue([
    {
      id: 'r1',
      brandId: 'b1',
      title: 'October review',
      template: 'executive_summary',
      dateFrom: '2026-10-01T00:00:00Z',
      dateTo: '2026-10-27T00:00:00Z',
      createdAt: '2026-10-27T00:00:00Z',
    },
  ]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(isLocked: boolean, chatAgentic = false, role: TeamRole = 'manager') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <ChatAgenticProvider enabled={chatAgentic}>
            <UpgradeDialogContext.Provider
              value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
            >
              <ReportsPage />
            </UpgradeDialogContext.Provider>
          </ChatAgenticProvider>
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const generate = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Generate Report')!;
// The row's "…" menu, then one of its items.
const menuItem = async (label: string) => {
  const trigger = container.querySelector<HTMLElement>(
    'tbody [aria-label="More actions for October review"]',
  )!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === label,
  )!;
};
// The row's "…" menu, then its Delete report (UX audit RP-10).
const remove = async () => {
  const trigger = container.querySelector<HTMLElement>(
    'tbody [aria-label="More actions for October review"]',
  )!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === 'Delete report',
  )!;
};
const dialog = () => document.querySelector('[role="dialog"]');

describe('Reports', () => {
  it('generates and deletes nothing on a read-only workspace: the upgrade dialog instead', async () => {
    await render(true);
    expect(container.textContent).toContain('October review');
    await act(async () => generate().click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Generating reports needs a plan');
    {
      const item = await remove();
      await act(async () => item.click());
    }
    expect(openUpgrade).toHaveBeenLastCalledWith('Deleting reports needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(reports.createReport).not.toHaveBeenCalled();
    expect(reports.deleteReport).not.toHaveBeenCalled();
  });

  it('asks before a second report of the same template and days: Open it, or Generate anyway (UX audit RP-11)', async () => {
    // The dialog opens on the Executive summary over 30 days: a saved one covers them.
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const [dateFrom, dateTo] = [from.toISOString(), to.toISOString()];
    reports.getReports.mockResolvedValue([
      {
        id: 'r9',
        brandId: 'b1',
        title: 'Monthly summary',
        template: 'executive_summary',
        dateFrom,
        dateTo,
        createdAt: '2026-11-19T00:00:00Z',
      },
    ]);
    reports.createReport.mockResolvedValue({ id: 'r10' });
    await render(false);
    await act(async () => generate().click());
    const submit = () =>
      [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Generate Report')!;
    await act(async () => submit().click());
    expect(reports.createReport).not.toHaveBeenCalled();
    const notice = document.querySelector('[data-slot="report-duplicate"]')!;
    expect(notice.textContent).toContain('Same period as an existing report, “Monthly summary”.');
    await act(async () =>
      document.querySelector<HTMLElement>('[data-action="reports.generateAnyway"]')!.click(),
    );
    expect(reports.createReport).toHaveBeenCalledTimes(1);
  });

  it('renames a report from its row menu: the name only (UX audit RP-11)', async () => {
    reports.renameReport.mockResolvedValue(true);
    await render(false);
    const trigger = container.querySelector<HTMLElement>(
      'tbody [aria-label="More actions for October review"]',
    )!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === 'Rename',
    )!;
    await act(async () => item.click());
    const field = document.querySelector<HTMLInputElement>('[data-action="reports.renameTitle"]')!;
    expect(field.value).toBe('October review');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        field,
        '  Board  review ',
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      document.querySelector<HTMLElement>('[data-action="reports.saveTitle"]')!.click(),
    );
    expect(reports.renameReport).toHaveBeenCalledWith('r1', 'Board review');
    expect(container.textContent).toContain('Board review');
    expect(dialog()).toBeNull();
  });

  it('offers Rename to Admins and Managers only, as the server allows', async () => {
    await render(false, false, 'analyst');
    const trigger = container.querySelector<HTMLElement>(
      'tbody [aria-label="More actions for October review"]',
    )!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
      (el) => el.textContent,
    );
    expect(items).not.toContain('Rename');
    expect(items).toContain('Delete report');
  });

  it('opens Generate Report on an active plan', async () => {
    await render(false);
    await act(async () => generate().click());
    expect(dialog()).not.toBeNull();
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('links What Ansvisor did for you only with the new Chat on (CHAT-22 §2 item 5)', async () => {
    brandHasShipped.mockResolvedValue(true);
    await render(false);
    expect(container.querySelector('[data-action="reports.openImpact"]')).toBeNull();
    expect(brandHasShipped).not.toHaveBeenCalled();
    await render(false, true);
    expect(brandHasShipped).toHaveBeenCalledWith('b1');
    const link = container.querySelector('[data-action="reports.openImpact"]')!;
    expect(link.textContent).toBe('What Ansvisor did for you');
    expect(link.getAttribute('href')).toBe('/dashboard/reports/impact');
  });

  it('hides What Ansvisor did for you until the brand has shipped something', async () => {
    brandHasShipped.mockResolvedValue(false);
    await render(false, true);
    expect(brandHasShipped).toHaveBeenCalledWith('b1');
    expect(container.querySelector('[data-action="reports.openImpact"]')).toBeNull();
    expect(generate()).toBeDefined();
  });

  it('offers the AI-sourced pipeline section on Growth, and shows it off with Growth below', async () => {
    const section = () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) =>
        b.textContent?.startsWith('AI-sourced pipeline'),
      )!;
    await render(false);
    await act(async () => generate().click());
    expect(section().disabled).toBe(false);
    expect(section().textContent).toBe('AI-sourced pipeline');

    await act(async () => root.unmount());
    root = createRoot(container);
    document.body.replaceChildren(container);
    plan.crm = false;
    await render(false);
    await act(async () => generate().click());
    expect(section().disabled).toBe(true);
    expect(section().textContent).toBe('AI-sourced pipelineGrowth');
  });
});

describe("what Chat's side panel sees (the owner's plan, step 9)", () => {
  it('sends the saved reports by id, each with the days it covers', async () => {
    await render(false);
    expect(chatPage.mock.lastCall![0]).toEqual({
      pageName: 'Reports',
      view: {
        rows: [{ ref: 'r1', label: 'October review (2026-10-01 – 2026-10-27)' }],
        total: 1,
      },
    });
  });

  it('sends no rows while it reads', async () => {
    reports.getReports.mockReturnValue(new Promise(() => {}));
    await render(false);
    expect(chatPage.mock.lastCall![0].view).toEqual({});
  });

  it('names a report by its title, and its template under a title of the person’s own (UX audit RP-12)', async () => {
    reports.getReports.mockResolvedValue([
      {
        id: 'r1',
        brandId: 'b1',
        title: 'October review',
        template: 'executive_summary',
        dateFrom: '2026-10-01T00:00:00Z',
        dateTo: '2026-10-27T00:00:00Z',
        createdAt: '2026-10-27T00:00:00Z',
      },
      {
        id: 'r2',
        brandId: 'b1',
        title: 'Monthly Executive Report',
        template: 'executive_summary',
        dateFrom: '2026-11-01T00:00:00Z',
        dateTo: '2026-11-18T00:00:00Z',
        createdAt: '2026-11-18T00:00:00Z',
      },
    ]);
    await render(false);
    const titles = [...container.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('td')?.textContent,
    );
    expect(titles).toEqual(['October reviewMonthly Executive Report', 'Monthly Executive Report']);
  });
});

describe('Share and Download in the row menu (UX audit RP-09)', () => {
  it('copies the report’s link, on a read-only workspace too', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await render(true);
    const item = await menuItem('Copy link');
    await act(async () => item.click());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/dashboard/reports/r1`);
    expect(toast.success).toHaveBeenCalledWith(
      'Link copied. It opens the report for people in your workspace.',
    );
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('downloads the saved report as a PDF with the white label kit', async () => {
    const full = { id: 'r1', brandId: 'b1', payload: { brandName: 'Acme' } };
    const kit = { companyName: 'Acme Agency' };
    reports.getReport.mockResolvedValue(full);
    getReportBranding.mockResolvedValue({ ok: true, branding: kit });
    await render(false);
    const item = await menuItem('Download PDF');
    await act(async () => item.click());
    expect(reports.getReport).toHaveBeenCalledWith('r1');
    expect(getReportBranding).toHaveBeenCalledWith('b1');
    expect(saveReportPdf).toHaveBeenCalledWith(full, kit);
  });

  it('makes no PDF while the kit can’t be read, and says so', async () => {
    reports.getReport.mockResolvedValue({ id: 'r1', brandId: 'b1', payload: {} });
    getReportBranding.mockResolvedValue({ ok: false, failure: 'failed' });
    await render(false);
    const item = await menuItem('Download PDF');
    await act(async () => item.click());
    expect(saveReportPdf).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't load your white label kit, so the PDF wasn't made. Try again.",
    );
  });
});
