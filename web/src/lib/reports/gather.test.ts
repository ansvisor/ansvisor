import { describe, expect, it, vi } from 'vitest';
import { gatherSection } from './gather';

describe('gatherSection', () => {
  it('returns the first read when it works, with nothing logged', async () => {
    const log = vi.fn();
    const onGap = vi.fn();
    const run = vi.fn().mockResolvedValue([1, 2]);
    await expect(gatherSection('trend', run, log, onGap)).resolves.toEqual([1, 2]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(onGap).not.toHaveBeenCalled();
  });

  it('tries once more after a failure and keeps the second read', async () => {
    const log = vi.fn();
    const onGap = vi.fn();
    const run = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue('ok');
    await expect(gatherSection('trend', run, log, onGap)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(onGap).not.toHaveBeenCalled();
  });

  it('records the gap and returns null when both reads fail', async () => {
    const log = vi.fn();
    const onGap = vi.fn();
    const run = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(gatherSection('citationEvidence', run, log, onGap)).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).toContain('citationEvidence');
    expect(onGap).toHaveBeenCalledTimes(1);
  });
});
