import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { BusinessHubEntry } from '@/lib/business-hub/numbers';

/**
 * Import CSV in the Enter numbers dialog: Ansvisor's own template, and a
 * preview of every row (new, replacing an entry, or refused and why) before
 * the rows that can be read are saved together.
 */

const actions = vi.hoisted(() => ({ importBusinessHubSnapshots: vi.fn() }));
vi.mock('@/lib/actions/business-hub', () => actions);
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => download);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { BusinessHubImport } = await import('./_business-hub-import');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '33333333-3333-3333-3333-333333333333';
const HEADER =
  'period_end,period_days,mentions,website_clicks,profile_views,topic_1,topic_2,topic_3,topic_4,topic_5';
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const existing: BusinessHubEntry = {
  id: 'e1',
  periodDays: 7,
  periodEnd: daysAgo(8),
  mentions: 44,
  websiteClicks: null,
  profileViews: null,
  topics: [],
  source: 'manual',
  updatedAt: null,
};

let container: HTMLDivElement;
let root: Root;
const onImported = vi.fn();
const onBack = vi.fn();

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <BusinessHubImport
          brandId={BRAND}
          entries={[existing]}
          onImported={onImported}
          onBack={onBack}
        />
      </NextIntlClientProvider>,
    );
  });
}

async function choose(text: string) {
  const input = container.querySelector<HTMLInputElement>('#bh-csv-file')!;
  const file = new File([text], 'numbers.csv', { type: 'text/csv' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The file is read after the change.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.trim().startsWith(name),
  )!;

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

describe('BusinessHubImport', () => {
  it('says the template is Ansvisor’s own, and builds it in the browser', async () => {
    await render();
    expect(container.textContent).toContain(
      "Business Hub has no export yet. This is Ansvisor's own template: copy the numbers from Business Hub into it.",
    );
    await act(async () => button('Download template').click());
    const [blob, name] = download.saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('business-hub-numbers.csv');
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(text).toContain(HEADER);
    expect(button('Import').disabled).toBe(true);
  });

  it('previews each row, new, replacing an entry or refused, and imports the ones it can read', async () => {
    actions.importBusinessHubSnapshots.mockResolvedValue({ saved: 2, replaced: 1 });
    await render();
    await choose(
      [
        HEADER,
        `${daysAgo(1)},7,53,19,,Coffee subscriptions,,,,`,
        `${daysAgo(8)},7,"1,240",,,,,,,`,
        `${daysAgo(15)},7,1.5,,,,,,,`,
      ].join('\n'),
    );
    const summary = container.querySelector('[data-testid="bh-import-summary"]');
    expect(summary?.textContent).toBe("1 new · 1 replace an entry · 1 can't be read");
    const shown = container.textContent ?? '';
    expect(shown).toContain('New');
    expect(shown).toContain('Replaces an entry');
    expect(shown).toContain("mentions isn't a whole number.");
    expect(shown).toContain('1,240');

    await act(async () => button('Import 2 entries').click());
    expect(actions.importBusinessHubSnapshots).toHaveBeenCalledWith(BRAND, [
      expect.objectContaining({
        periodEnd: daysAgo(1),
        mentions: 53,
        topics: ['Coffee subscriptions'],
      }),
      expect.objectContaining({ periodEnd: daysAgo(8), mentions: 1240 }),
    ]);
    expect(toast.success).toHaveBeenCalledWith('2 entries imported');
    expect(onImported).toHaveBeenCalled();
  });

  it('says a file without the template’s columns can’t be read, and imports nothing', async () => {
    await render();
    await choose('Date,Mentions\n2026-11-10,5\n');
    expect(container.textContent).toContain('This file has no period_end column.');
    expect(button('Import').disabled).toBe(true);
  });

  it('saves nothing, and says so, when the import is refused', async () => {
    actions.importBusinessHubSnapshots.mockResolvedValue({ error: 'failed' });
    await render();
    await choose(`${HEADER}\n${daysAgo(1)},7,53,,,,,,,\n`);
    await act(async () => button('Import 1 entry').click());
    expect(toast.error).toHaveBeenCalledWith("Couldn't import the file. Nothing was saved.");
    expect(onImported).not.toHaveBeenCalled();
  });
});
