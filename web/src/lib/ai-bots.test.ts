import { describe, expect, it } from 'vitest';
import {
  botReportState,
  botsCardState,
  lastBotEvent,
  logsPausedUntil,
  rowsPausedUntil,
  sampleBotTypes,
} from './ai-bots';
import type { BotConnections, BotUsage } from '@/lib/actions/ai-bots';

/** The AI bots source card's state (AT-010). */

const usage = (over: Partial<BotUsage> = {}): BotUsage => ({
  month: '2026-10-01',
  stored: 0,
  counted: 0,
  cappedAt: null,
  cap: 2_000_000,
  raw: 0,
  rawCappedAt: null,
  rawCap: 20_000_000,
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

  it('pauses log files past the raw cap, only for a brand with a log sender', () => {
    const drain = { ...conn(null), kind: 'vercel_drain' as const };
    const capped = usage({ raw: 20_000_400, rawCappedAt: '2026-10-18T09:00:00Z' });
    expect(logsPausedUntil({ connections: [drain], usage: capped })).toBe('2026-11-01');
    // A Worker's batches don't count against it.
    expect(logsPausedUntil({ connections: [conn(null)], usage: capped })).toBeNull();
    expect(logsPausedUntil({ connections: [drain], usage: usage() })).toBeNull();
    expect(logsPausedUntil({ connections: [drain], usage: { ...capped, rawCap: -1 } })).toBeNull();
  });

  // gkhngyk on #1224: rawCappedAt is set once a month and never cleared.
  it("reads the pause against today's plan, not when the cap was first hit", () => {
    const drain = { ...conn(null), kind: 'vercel_drain' as const };
    // Growth hit 20M, then upgraded to Enterprise: its files are read again.
    const raised = usage({
      raw: 20_000_400,
      rawCappedAt: '2026-10-18T09:00:00Z',
      rawCap: 200_000_000,
    });
    expect(logsPausedUntil({ connections: [drain], usage: raised })).toBeNull();
    // Enterprise at 30M moved down to Growth: its files stop, with no rawCappedAt yet.
    const lowered = usage({ raw: 30_000_000, rawCappedAt: null, rawCap: 20_000_000 });
    expect(logsPausedUntil({ connections: [drain], usage: lowered })).toBe('2026-11-01');
  });
});

describe('botReportState and sampleBotTypes (AT-011)', () => {
  const report = (lastSeen: string | null) => ({
    firstDay: null,
    lastSeen,
    types: [],
    bots: [],
    pageCount: 0,
    pages: [],
    uncrawledCount: null,
    uncrawled: null,
    alertState: 'waiting' as const,
    alertFrom: null,
    since: null,
  });

  it("is locked without the report, off, waiting, or the brand's own data", () => {
    expect(
      botReportState({ connections: [], usage: usage({ cap: 0 }) }, report('2026-10-19T09:00:00Z')),
    ).toBe('locked');
    expect(botReportState({ connections: [], usage: usage() }, report(null))).toBe('off');
    expect(botReportState({ connections: [conn(null)], usage: usage() }, report(null))).toBe(
      'waiting',
    );
    expect(
      botReportState({ connections: [conn(null)], usage: usage() }, report('2026-10-19T09:00:00Z')),
    ).toBe('data');
    // Bots counted before the connection was revoked still show.
    expect(
      botReportState({ connections: [], usage: usage() }, report('2026-10-19T09:00:00Z')),
    ).toBe('data');
  });

  it("samples the mockup's numbers, last seen 2h, 40m and 5m ago", () => {
    const now = Date.parse('2026-10-19T12:00:00.000Z');
    expect(sampleBotTypes(now).map((t) => [t.type, t.hits, t.pages, t.lastSeen])).toEqual([
      ['training', 8420, 612, '2026-10-19T10:00:00.000Z'],
      ['search', 3115, 488, '2026-10-19T11:20:00.000Z'],
      ['user', 1302, 214, '2026-10-19T11:55:00.000Z'],
    ]);
  });
});
