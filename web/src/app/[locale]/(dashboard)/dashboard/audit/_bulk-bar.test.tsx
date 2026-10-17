import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditQuota } from '@/lib/actions/audits';
import { AuditBulkBar } from './_bulk-bar';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onReaudit = vi.fn();
const onExport = vi.fn();
const onClear = vi.fn();

function render(count: number, quota: AuditQuota | null, starting = false) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditBulkBar
          count={count}
          quota={quota}
          starting={starting}
          onAudit={onReaudit}
          onExport={onExport}
          onClear={onClear}
        />
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const usage = () =>
  container.querySelectorAll('[role=toolbar] > span')[1] as HTMLElement | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AuditBulkBar', () => {
  it("says how many of the month's audits a re-audit uses, and starts it", () => {
    render(3, { used: 270, limit: 500, remaining: 225, running: 5 });

    expect(container.textContent).toContain('3 selected');
    expect(usage()?.textContent).toBe('Uses 3 of your 225 audits');
    expect(usage()?.className).not.toContain('text-destructive');
    act(() => button('Re-audit').click());
    expect(onReaudit).toHaveBeenCalledOnce();

    act(() => (container.querySelector('[aria-label="Clear selection"]') as HTMLElement).click());
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('keeps Re-audit off when the selection is over what is left', () => {
    render(12, { used: 92, limit: 100, remaining: 8 });
    expect(usage()?.textContent).toBe('Uses 12 of your 8 audits · select up to 8');
    expect(usage()?.className).toContain('text-destructive');
    expect(button('Re-audit').disabled).toBe(true);

    render(1, { used: 100, limit: 100, remaining: 0 });
    expect(usage()?.textContent).toBe('No audits left this month');
    expect(button('Re-audit').disabled).toBe(true);
  });

  it('counts nothing against an unlimited plan', () => {
    render(40, { used: 0, limit: -1, remaining: -1 });
    expect(usage()).toBeUndefined();
    expect(button('Re-audit').disabled).toBe(false);
  });

  it("takes the table's own audit label and actions, and leaves Export out without one", () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <AuditBulkBar
            count={2}
            quota={{ used: 0, limit: 500, remaining: 500 }}
            starting={false}
            auditLabel="Audit selected"
            onAudit={onReaudit}
            onClear={onClear}
          >
            <button type="button">Pin</button>
          </AuditBulkBar>
        </NextIntlClientProvider>,
      );
    });
    expect(button('Audit selected')).toBeDefined();
    expect(button('Pin')).toBeDefined();
    expect(button('Export')).toBeUndefined();
  });

  it('waits while a bulk start is on its way', () => {
    render(3, { used: 0, limit: 500, remaining: 500 }, true);
    expect(button('Re-audit').disabled).toBe(true);
  });
});
