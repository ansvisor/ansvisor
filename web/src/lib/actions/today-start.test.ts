// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Today's first reads in one call: each part starts at once, none waiting for another. */

const reads = vi.hoisted(() => ({
  getTodayOverview: vi.fn(),
  getTodayStanding: vi.fn(),
  getTodayChanges: vi.fn(),
  getTodayFocus: vi.fn(),
  getTodayWaiting: vi.fn(),
  getGettingStarted: vi.fn(),
  readUserBrandState: vi.fn(),
}));
vi.mock('@/lib/actions/today', () => reads);
vi.mock('@/lib/actions/today-changes', () => reads);
vi.mock('@/lib/actions/today-focus', () => reads);
vi.mock('@/lib/actions/today-waiting', () => reads);
vi.mock('@/lib/actions/getting-started', () => reads);
vi.mock('@/lib/actions/user-brand-state', () => reads);

const { getTodayStart } = await import('./today-start');

const SEEN = '2026-11-13T08:00:00.000Z';
const PARTS = [
  reads.getTodayStanding,
  reads.getTodayChanges,
  reads.getTodayFocus,
  reads.getTodayWaiting,
  reads.getGettingStarted,
];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  reads.readUserBrandState.mockResolvedValue({ navSeen: { today: SEEN }, focus: [], hidden: {} });
  // No part ever answers: each must start without waiting for another.
  for (const read of PARTS) read.mockReturnValue(new Promise(() => {}));
});

describe('getTodayStart', () => {
  it('starts every part of the normal day together once the overview is in', async () => {
    reads.getTodayOverview.mockResolvedValue({ zone: 'UTC', lastRunAt: '2026-11-14T05:00:00Z' });
    await getTodayStart('b1', 'Europe/Istanbul', ['ads'], false);
    await flush();
    expect(reads.getTodayOverview).toHaveBeenCalledWith('b1', 'Europe/Istanbul');
    expect(reads.getTodayStanding).toHaveBeenCalledWith('b1');
    expect(reads.getTodayChanges).toHaveBeenCalledWith('b1', SEEN, ['ads']);
    expect(reads.getTodayFocus).toHaveBeenCalledWith('b1', SEEN);
    expect(reads.getTodayWaiting).toHaveBeenCalledWith('b1', 'Europe/Istanbul');
    expect(reads.getGettingStarted).toHaveBeenCalledWith('b1');
  });

  it("reads none of the normal day's parts on a brand's first day", async () => {
    reads.getTodayOverview.mockResolvedValue({ zone: 'UTC', lastRunAt: null });
    const start = await getTodayStart('b1', null, [], false);
    await expect(start.focus).resolves.toBeNull();
    await expect(start.waiting).resolves.toBeNull();
    for (const read of PARTS) expect(read).not.toHaveBeenCalled();
  });

  it('reads only the focus after the plan ended, without waiting for the overview', async () => {
    reads.getTodayOverview.mockReturnValue(new Promise(() => {}));
    const start = await getTodayStart('b1', null, [], true);
    await expect(start.standing).resolves.toBeNull();
    expect(reads.getTodayFocus).toHaveBeenCalledWith('b1', SEEN);
    expect(reads.getTodayWaiting).not.toHaveBeenCalled();
  });

  it('reads the normal day when the overview failed, as the page then shows it', async () => {
    reads.getTodayOverview.mockRejectedValue(new Error('down'));
    const start = await getTodayStart('b1', null, [], false);
    await expect(start.overview).rejects.toThrow('down');
    await flush();
    for (const read of PARTS) expect(read).toHaveBeenCalledTimes(1);
  });
});
