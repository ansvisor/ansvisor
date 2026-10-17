import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditSettings } from '@/lib/actions/audits';
import { AuditSettingsDialog, parsePatterns } from './_settings-dialog';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  getAuditSettings: vi.fn(),
  saveAuditSettings: vi.fn(),
  setOpportunityPrefs: vi.fn(),
}));
vi.mock('@/lib/actions/audits', () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const BRAND = '33333333-3333-3333-3333-333333333333';

const settings = (over: Partial<AuditSettings> = {}): AuditSettings => ({
  autoAudit: { enabled: true, setting: null, perRun: 5, limit: 100 },
  emailAfterRun: false,
  excludePatterns: ['/careers/*'],
  pinned: [{ key: 'acme.com/about', url: 'https://acme.com/about' }],
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onSaved = vi.fn();
const onOpenChange = vi.fn();

async function render(canManage = true) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditSettingsDialog
          brandId={BRAND}
          open
          onOpenChange={onOpenChange}
          canManage={canManage}
          onSaved={onSaved}
        />
      </NextIntlClientProvider>,
    );
  });
}

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement;
const button = (text: string) =>
  [...dialog().querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.getAuditSettings.mockResolvedValue(settings());
  actions.saveAuditSettings.mockImplementation(async () => settings());
  actions.setOpportunityPrefs.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('parsePatterns', () => {
  it('takes one pattern per line and drops blank ones', () => {
    expect(parsePatterns(' /careers/*\n\n/tag/* \n')).toEqual(['/careers/*', '/tag/*']);
  });
});

describe('AuditSettingsDialog', () => {
  it("shows the org's auto-audit share, the brand's patterns and its pinned pages", async () => {
    await render();
    expect(actions.getAuditSettings).toHaveBeenCalledWith(BRAND);
    const text = dialog().textContent;
    expect(text).toContain(
      '5 pages on days 1, 7, 14, 21 and 28 of your billing month: 25 of your 100 audits.',
    );
    expect(text).toContain('Applies to every brand in your organization.');
    expect(dialog().querySelector('textarea')!.value).toBe('/careers/*');
    expect(dialog().querySelector('li')!.textContent).toContain('/about');
    // Nothing changed yet.
    expect(button('Save').disabled).toBe(true);
  });

  it('saves only what changed, then reads the page again', async () => {
    await render();
    const [auto] = dialog().querySelectorAll('[role="checkbox"]');
    act(() => (auto as HTMLElement).click());
    expect(dialog().textContent).toContain('Off: all 100 audits a month are yours.');
    type(dialog().querySelector('textarea')!, '/careers/*\n/tag/*\n');

    await act(async () => button('Save').click());
    expect(actions.saveAuditSettings).toHaveBeenCalledWith(BRAND, {
      autoAudit: false,
      excludePatterns: ['/careers/*', '/tag/*'],
    });
    expect(toast.success).toHaveBeenCalledWith('Site Audit settings saved');
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the server's message when a pattern is refused", async () => {
    actions.saveAuditSettings.mockRejectedValue(
      new Error('"careers" isn\'t a page path. Start it with /, as in /legal/*.'),
    );
    await render();
    type(dialog().querySelector('textarea')!, 'careers');
    await act(async () => button('Save').click());
    expect(toast.error).toHaveBeenCalledWith(
      '"careers" isn\'t a page path. Start it with /, as in /legal/*.',
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("is read-only for members who can't manage it, who can still unpin", async () => {
    await render(false);
    expect(dialog().textContent).toContain('Only admins and managers can change these settings.');
    expect(dialog().querySelector('textarea')!.disabled).toBe(true);
    expect(button('Save').disabled).toBe(true);

    await act(async () => button('Unpin').click());
    expect(actions.setOpportunityPrefs).toHaveBeenCalledWith(
      BRAND,
      ['https://acme.com/about'],
      null,
    );
    expect(dialog().textContent).toContain('No pinned pages. Pin them from Opportunities.');
  });

  it('says what a plan without a monthly limit runs', async () => {
    actions.getAuditSettings.mockResolvedValue(
      settings({ autoAudit: { enabled: false, setting: null, perRun: 25, limit: -1 } }),
    );
    await render();
    expect(dialog().textContent).toContain('25 pages on days 1, 7, 14, 21 and 28 of the month.');
  });
});
