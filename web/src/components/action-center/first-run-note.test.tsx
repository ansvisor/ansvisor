import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { TrackingJobStatus, TrackingWindow } from '@/lib/actions/tracking';

/**
 * The Action Center's "First analysis running" note (#1238's review): people
 * land on Actions while a new brand's first run goes on, and only Visibility
 * showed it.
 */

const { getTrackingWindow, getJobStatus, loadTrackingJob, store } = vi.hoisted(() => ({
  getTrackingWindow: vi.fn(),
  getJobStatus: vi.fn(),
  loadTrackingJob: vi.fn(),
  store: { brandId: 'b1' as string | null },
}));
vi.mock('@/lib/actions/tracking', () => ({ getTrackingWindow, getJobStatus }));
vi.mock('@/lib/tracking-job-store', () => ({ loadTrackingJob }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: { activeBrandId: string | null }) => unknown) =>
    selector({ activeBrandId: store.brandId }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { FirstRunNote } = await import('./first-run-note');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const win = (over: Partial<TrackingWindow> = {}): TrackingWindow => ({
  anchored: null,
  activeRun: null,
  lastRunAt: null,
  nextRunAt: null,
  ...over,
});
const job = (over: Partial<TrackingJobStatus> = {}): TrackingJobStatus => ({
  status: 'active',
  progress: null,
  result: null,
  failedReason: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <FirstRunNote />
      </NextIntlClientProvider>,
    );
  });
}
const text = () => container.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  getTrackingWindow.mockReset().mockResolvedValue(win());
  getJobStatus.mockReset().mockResolvedValue(job());
  loadTrackingJob.mockReset().mockReturnValue(null);
  store.brandId = 'b1';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('FirstRunNote', () => {
  it("says the first analysis is running from the ledger, whoever's browser started it", async () => {
    getTrackingWindow.mockResolvedValue(
      win({ activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'manual' } }),
    );
    await render();
    expect(text()).toContain('First analysis running');
    expect(text()).toContain('Actions, signals and KPIs fill in once it finishes');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard/insights');
    expect(getJobStatus).not.toHaveBeenCalled();
  });

  it("says it's queued before the worker starts it, from the job this browser saved", async () => {
    loadTrackingJob.mockReturnValue({ jobId: 'j1', brandId: 'b1', startedAt: 1 });
    getJobStatus.mockResolvedValue(job({ status: 'waiting' }));
    await render();
    expect(getJobStatus).toHaveBeenCalledWith('j1');
    expect(text()).toContain('First analysis queued');
    expect(text()).toContain('Yours starts the moment a slot opens');
  });

  it("shows the saved job's progress while it runs", async () => {
    getTrackingWindow.mockResolvedValue(
      win({ activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'manual' } }),
    );
    loadTrackingJob.mockReturnValue({ jobId: 'j1', brandId: 'b1', startedAt: 1 });
    getJobStatus.mockResolvedValue(job({ progress: { current: 12, total: 40 } }));
    await render();
    expect(text()).toContain('First analysis running12 of 40 answers');
  });

  it('shows nothing once the brand has a completed run, and stops reading', async () => {
    getTrackingWindow.mockResolvedValue(
      win({
        lastRunAt: '2026-10-19T09:00:00Z',
        activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'cron' },
      }),
    );
    await render();
    expect(text()).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(getTrackingWindow).toHaveBeenCalledTimes(1);
  });

  it("ignores another brand's saved job, and one that failed", async () => {
    loadTrackingJob.mockReturnValue({ jobId: 'j1', brandId: 'b2', startedAt: 1 });
    await render();
    expect(text()).toBe('');
    expect(getJobStatus).not.toHaveBeenCalled();

    loadTrackingJob.mockReturnValue({ jobId: 'j2', brandId: 'b1', startedAt: 1 });
    getJobStatus.mockResolvedValue(job({ status: 'failed', failedReason: 'boom' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getJobStatus).toHaveBeenCalledWith('j2');
    expect(text()).toBe('');
  });

  it('keeps the note through a failed read, and goes when the first run is done', async () => {
    getTrackingWindow.mockResolvedValueOnce(
      win({ activeRun: { startedAt: '2026-10-20T09:00:00Z', source: 'manual' } }),
    );
    await render();
    expect(text()).toContain('First analysis running');

    getTrackingWindow.mockRejectedValueOnce(new Error('timeout'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(text()).toContain('First analysis running');

    getTrackingWindow.mockResolvedValueOnce(win({ lastRunAt: '2026-10-20T09:40:00Z' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(text()).toBe('');
  });
});
