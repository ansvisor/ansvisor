import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { DataHealth } from '@/lib/data-health';
import { DataHealthCard } from './_data-health';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/visibility-reads', () => ({ getDataHealth: vi.fn() }));

const BRAND = '11111111-1111-4111-8111-111111111111';
const filters = { datePreset: '7d' as const, dateFrom: '', dateTo: '', region: '', topic: '' };

const health: DataHealth = {
  rows: [
    {
      platform: 'chatgpt-web',
      expected: 70,
      received: 70,
      missing: 0,
      percent: 100,
      lastAnswerAt: '2026-11-28T09:00:00Z',
    },
    {
      platform: 'google-aio',
      expected: 30,
      received: 28,
      missing: 2,
      percent: 93,
      lastAnswerAt: null,
    },
  ],
  expected: 100,
  received: 98,
  missing: 2,
  percent: 98,
};

let container: HTMLDivElement;
let root: Root;

async function render(read: () => Promise<DataHealth>) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DataHealthCard brandId={BRAND} filters={filters} read={read} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('DataHealthCard', () => {
  it('shows each platform with expected, received, missing and the summary', async () => {
    const read = vi.fn(async () => health);
    await render(read);
    expect(read).toHaveBeenCalledWith(BRAND, expect.objectContaining({ region: undefined }));
    const text = container.textContent ?? '';
    expect(text).toContain('Data health');
    expect(text).toContain('Last 7 days · 98% of expected answers received');
    expect(text).toContain('ChatGPT');
    expect(text).toContain('Google AI Overviews');
    const rows = [...container.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(rows[1].slice(1, 4)).toEqual(['30', '28(93%)', '2']);
    expect(rows[1][4]).toBe('None yet');
    expect(text).toContain('never as not mentioned');
    expect(text).toContain('paused for a while');
  });

  it('says so when no prompt is tracked in the window', async () => {
    await render(async () => ({ rows: [], expected: 0, received: 0, missing: 0, percent: null }));
    expect(container.textContent).toContain('No tracked Prompts on any AI platform');
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).not.toContain('of expected answers received');
  });

  it('shows Retry when the read fails, and reads again', async () => {
    const read = vi.fn<() => Promise<DataHealth>>(async () => {
      throw new Error('down');
    });
    await render(read);
    expect(container.textContent).toContain("Couldn't load data health");
    read.mockResolvedValue(health);
    const retry = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Retry'),
    );
    await act(async () => retry?.click());
    expect(read).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('98% of expected answers received');
  });
});
