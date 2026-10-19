import { describe, expect, it } from 'vitest';
import { botsCardState, lastBotEvent, rowsPausedUntil } from './ai-bots';
import type { BotConnections, BotUsage } from '@/lib/actions/ai-bots';

/** The AI bots source card's state (AT-010). */

const usage = (over: Partial<BotUsage> = {}): BotUsage => ({
  month: '2026-10-01',
  stored: 0,
  counted: 0,
  cappedAt: null,
  cap: 2_000_000,
  ...over,
});
const conn = (lastEventAt: string | null, id = 'c1') => ({
  id,
  kind: 'cloudflare_worker' as const,
  createdAt: '2026-10-18T09:00:00Z',
  lastEventAt,
});

describe('botsCardState', () => {
  it('is locked without the report, off with nothing connected, waiting, then on', () => {
    const state = (info: BotConnections) => botsCardState(info);
    expect(state({ connections: [conn('2026-10-19T09:00:00Z')], usage: usage({ cap: 0 }) })).toBe(
      'locked',
    );
    expect(state({ connections: [], usage: usage() })).toBe('off');
    expect(state({ connections: [conn(null)], usage: usage() })).toBe('waiting');
    expect(
      state({ connections: [conn(null), conn('2026-10-19T09:00:00Z', 'c2')], usage: usage() }),
    ).toBe('on');
  });
});

describe('lastBotEvent and rowsPausedUntil', () => {
  it('reads the newest request and the day detailed rows start again', () => {
    expect(
      lastBotEvent([
        conn('2026-10-18T09:00:00Z'),
        conn('2026-10-19T08:00:00Z', 'c2'),
        conn(null, 'c3'),
      ]),
    ).toBe('2026-10-19T08:00:00Z');
    expect(lastBotEvent([])).toBeNull();
    expect(rowsPausedUntil(usage({ cappedAt: '2026-10-20T00:00:00Z' }))).toBe('2026-11-01');
    expect(rowsPausedUntil(usage({ month: '2026-12-01', cappedAt: '2026-12-20T00:00:00Z' }))).toBe(
      '2027-01-01',
    );
    expect(rowsPausedUntil(usage())).toBeNull();
    expect(rowsPausedUntil(usage({ cap: -1, cappedAt: '2026-10-20T00:00:00Z' }))).toBeNull();
  });
});
