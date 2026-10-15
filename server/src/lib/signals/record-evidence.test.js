import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The recorder's lost-citation evidence step: what a lost citation is written
 * with, and what it keeps when a night's evidence read fails.
 */

vi.mock('../../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../pulse/metrics.js', () => ({
  computePulseMetrics: vi.fn(),
  LOST_CITATION_WINDOW_DAYS: 14,
}));

// A plain stub rather than a spy: a spy keeps its own handle on a rejected
// promise, which the runner then reports although the recorder handled it.
let read = { calls: [], result: new Map(), fail: false };
vi.mock('./lost-citation-evidence.js', () => ({
  lostCitationEvidence: async (...args) => {
    read.calls.push(args);
    if (read.fail) throw new Error('timeout');
    return read.result;
  },
}));

let competitorRead = { calls: [], result: new Map(), fail: false };
vi.mock('./competitor-evidence.js', () => ({
  competitorEvidence: async (...args) => {
    competitorRead.calls.push(args);
    if (competitorRead.fail) throw new Error('timeout');
    return competitorRead.result;
  },
}));

const { attachCompetitorEvidence, attachLostCitationEvidence, keepRecordedEvidence } =
  await import('./record.js');

const lost = (promptId) => ({
  kind: 'lost_citations',
  dedupKey: `lost_citations:${promptId}`,
  payload: { promptText: 'Best coffee subscription?', promptId },
});

const evidence = {
  platforms: ['chatgpt-web'],
  regions: ['US'],
  citedDays: 9,
  days: 11,
  quietDays: 3,
  lostUrls: [{ url: 'https://coffee.example/guide', position: 2 }],
  citedNow: [{ url: 'https://rival.example/best', answers: 2, answersRead: 3, position: 1 }],
};

beforeEach(() => {
  read = { calls: [], result: new Map(), fail: false };
  competitorRead = { calls: [], result: new Map(), fail: false };
});

describe('attachLostCitationEvidence', () => {
  it('writes each lost citation with its evidence, and leaves other kinds alone', async () => {
    read.result = new Map([['p1', evidence]]);
    const candidates = [
      lost('p1'),
      lost('p2'),
      { kind: 'prompt_gain', payload: { promptId: 'p1' } },
    ];
    await attachLostCitationEvidence('b1', candidates, new Date('2026-10-13T00:00:00Z'));

    expect(read.calls).toEqual([
      ['b1', ['p1', 'p2'], { now: new Date('2026-10-13T00:00:00Z'), windowDays: 14, quietDays: 3 }],
    ]);
    expect(candidates[0].payload).toEqual({
      promptText: 'Best coffee subscription?',
      promptId: 'p1',
      ...evidence,
    });
    expect(candidates[1].payload).toEqual({
      promptText: 'Best coffee subscription?',
      promptId: 'p2',
    });
    expect(candidates[2].payload).toEqual({ promptId: 'p1' });
  });

  it('records the signal without evidence when the read fails', async () => {
    read.fail = true;
    const candidates = [lost('p1')];
    await expect(attachLostCitationEvidence('b1', candidates, new Date())).resolves.toBeUndefined();
    expect(candidates[0].payload).toEqual({
      promptText: 'Best coffee subscription?',
      promptId: 'p1',
    });
  });
});

describe('keepRecordedEvidence', () => {
  it("keeps an earlier night's evidence when tonight's read had none", () => {
    const candidates = [lost('p1'), lost('p2')];
    const existing = new Map([
      ['lost_citations:p1', { payload: { promptText: 'old text', promptId: 'p1', ...evidence } }],
      ['lost_citations:p2', { payload: { promptText: 'x', promptId: 'p2' } }],
    ]);
    keepRecordedEvidence(candidates, existing);
    // Tonight's prompt text wins; the evidence is carried over.
    expect(candidates[0].payload).toEqual({
      promptText: 'Best coffee subscription?',
      promptId: 'p1',
      ...evidence,
    });
    expect(candidates[1].payload).toEqual({
      promptText: 'Best coffee subscription?',
      promptId: 'p2',
    });
  });

  it("never overwrites tonight's own evidence", () => {
    const fresh = { ...lost('p1'), payload: { ...lost('p1').payload, ...evidence, citedDays: 10 } };
    keepRecordedEvidence(
      [fresh],
      new Map([['lost_citations:p1', { payload: { ...evidence, citedDays: 4 } }]]),
    );
    expect(fresh.payload.citedDays).toBe(10);
  });
});

describe('attachCompetitorEvidence', () => {
  const found = {
    positions: [
      { promptId: 'p1', platform: 'chatgpt-web', competitor: { now: 1 }, you: { now: 3 } },
    ],
    winningSources: [{ domain: 'g2.example', answers: 2, answersRead: 3 }],
  };

  it('finds the competitor in the payload or the key, and writes its evidence', async () => {
    competitorRead.result = new Map([
      ['c1', found],
      ['c2', found],
    ]);
    const candidates = [
      {
        kind: 'competitor_momentum',
        dedupKey: 'competitor_momentum:c1',
        payload: { competitorId: 'c1' },
      },
      {
        kind: 'competitor_surge',
        dedupKey: 'competitor_surge:c2',
        payload: { competitorName: 'Rival' },
      },
      { kind: 'topic_drop', dedupKey: 'topic_drop:t1', payload: {} },
    ];
    await attachCompetitorEvidence('b1', candidates, new Date('2026-10-15T00:00:00Z'));
    expect(competitorRead.calls).toEqual([
      ['b1', ['c1', 'c2'], { now: new Date('2026-10-15T00:00:00Z'), windowDays: 7 }],
    ]);
    expect(candidates[0].payload).toEqual({ competitorId: 'c1', ...found });
    expect(candidates[1].payload).toEqual({
      competitorName: 'Rival',
      competitorId: 'c2',
      ...found,
    });
    expect(candidates[2].payload).toEqual({});
  });

  it('records the signals without evidence when the read fails', async () => {
    competitorRead.fail = true;
    const candidates = [
      {
        kind: 'competitor_leads',
        dedupKey: 'competitor_leads:c1',
        payload: { competitorId: 'c1' },
      },
    ];
    await expect(attachCompetitorEvidence('b1', candidates, new Date())).resolves.toBeUndefined();
    expect(candidates[0].payload).toEqual({ competitorId: 'c1' });
  });

  it("keeps an earlier night's competitor evidence", () => {
    const candidates = [
      {
        kind: 'competitor_leads',
        dedupKey: 'competitor_leads:c1',
        payload: { competitorId: 'c1' },
      },
    ];
    keepRecordedEvidence(
      candidates,
      new Map([['competitor_leads:c1', { payload: { competitorId: 'c1', ...found } }]]),
    );
    expect(candidates[0].payload).toEqual({ competitorId: 'c1', ...found });
  });
});
