import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import { readSheetStatus, writeGoogleSheet } from '@/lib/integrations-client';
import { GoogleSheetsExport } from './google-sheets-export';

vi.mock('@/lib/integrations-client', () => ({
  readSheetStatus: vi.fn(),
  writeGoogleSheet: vi.fn(),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const rows = [
  { title: '=1', count: 2 },
  { title: 'ACME, Inc.', count: -3 },
];
const table = () => ({ rows, headers: ['count', 'title'] });
const url = 'https://docs.google.com/spreadsheets/d/fixture/edit#gid=7';
const view = 'Content Opportunities';
async function render(disabled = false) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <GoogleSheetsExport brandId="brand-A" view={view} table={table} disabled={disabled} />
      </NextIntlClientProvider>,
    ),
  );
}
function button(label: string) {
  const result = [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!result) throw new Error(label);
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(readSheetStatus).mockResolvedValue({
    ok: true,
    value: { configured: true, accountId: 'account-A' },
  });
  vi.mocked(writeGoogleSheet).mockResolvedValue({ ok: true, value: url });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('hides export when this installation has no Sheets config', async () => {
  vi.mocked(readSheetStatus).mockResolvedValue({
    ok: true,
    value: { configured: false, accountId: null },
  });
  await render();
  expect(container.textContent).toBe('');
});
it('routes a disconnected brand to its own settings', async () => {
  vi.mocked(readSheetStatus).mockResolvedValue({
    ok: true,
    value: { configured: true, accountId: null },
  });
  await render();
  await act(async () => button(messages.sheets.export).click());
  expect(document.querySelector('[role="dialog"] a')?.getAttribute('href')).toBe(
    '/dashboard/brands/brand-A/settings?tab=integrations',
  );
  expect(writeGoogleSheet).not.toHaveBeenCalled();
});
it.each([false, true])(
  'sends the same ordered and protected snapshot (reuse=%s)',
  async (reuse) => {
    const key = ['ansvisor-sheets', 'brand-A', view, 'account-A'].join(':');
    if (reuse) localStorage.setItem(key, url);
    await render();
    await act(async () => button(messages.sheets.export).click());
    await act(async () => button(messages.sheets.send).click());
    expect(writeGoogleSheet).toHaveBeenCalledWith('brand-A', {
      accountId: 'account-A',
      view,
      spreadsheetId: reuse ? 'fixture' : undefined,
      values: [
        ['count', 'title'],
        [2, "'=1"],
        [-3, 'ACME, Inc.'],
      ],
    });
    expect(document.querySelector('[role="dialog"] a')?.getAttribute('href')).toBe(url);
    expect(localStorage.getItem(key)).toBe(url);
  },
);
it('disables submission when the view changes to a failed or pending read', async () => {
  await render();
  await act(async () => button(messages.sheets.export).click());
  await render(true);
  expect(button(messages.sheets.send).disabled).toBe(true);
});
