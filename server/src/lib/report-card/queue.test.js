import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { reportCardLimits } = await import('./config.js');
const {
  MAX_ATTEMPTS,
  RUN_DEADLINE_MS,
  STALE_MS,
  pruneReportCardRequests,
  runCard,
  startReportCardQueue,
  tickReportCards,
} = await import('./queue.js');
const { reportCardStore } = await import('./store.js');

const NOW = new Date('2026-11-03T10:00:00Z');

function store({ running = [], today = 0, spent = 0, queued = [] } = {}) {
  const due = [...queued];
  return {
    runningCards: vi.fn(async () => running),
    startedSince: vi.fn(async () => today),
    spendSince: vi.fn(async () => ({ spent, pending: 0 })),
    claimNext: vi.fn(async () => due.shift() ?? null),
    releaseCard: vi.fn(async () => {}),
    finishCard: vi.fn(async () => {}),
    cardInputs: vi.fn(async () => ({ industry: null, dealValue: null })),
    pruneRequests: vi.fn(async () => 4),
  };
}

const card = (id) => ({
  id,
  domain: 'acme.example',
  site: 'acme.example',
  company_name: 'Acme',
  country: 'US',
  language: 'en',
  attempts: 1,
});

describe('tickReportCards', () => {
  it('starts due cards up to the concurrency, and lets them run past the tick', async () => {
    const s = store({ queued: [card('a'), card('b'), card('c')] });
    const run = vi.fn(() => new Promise(() => {}));
    const started = await tickReportCards({
      store: s,
      limits: reportCardLimits({}),
      now: NOW,
      run,
    });
    expect(started).toEqual(['a', 'b']);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('counts the cards running toward the concurrency', async () => {
    const s = store({
      running: [{ id: 'r', started_at: '2026-11-03T09:50:00Z', attempts: 1 }],
      queued: [card('a'), card('b')],
    });
    const started = await tickReportCards({
      store: s,
      limits: reportCardLimits({}),
      now: NOW,
      run: vi.fn(async () => {}),
    });
    expect(started).toEqual(['a']);
  });

  it('starts none past the day’s cap or the month’s budget', async () => {
    const run = vi.fn();
    const capped = store({ today: 200, queued: [card('a')] });
    expect(
      await tickReportCards({ store: capped, limits: reportCardLimits({}), now: NOW, run }),
    ).toEqual([]);
    const spent = store({ spent: 199.9, queued: [card('a')] });
    expect(
      await tickReportCards({ store: spent, limits: reportCardLimits({}), now: NOW, run }),
    ).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(capped.claimNext).not.toHaveBeenCalled();
  });

  it('queues a lost run again once, then fails it', async () => {
    const s = store({
      running: [
        { id: 'once', started_at: '2026-11-03T08:00:00Z', attempts: 1 },
        { id: 'twice', started_at: '2026-11-03T08:00:00Z', attempts: MAX_ATTEMPTS },
      ],
    });
    await tickReportCards({ store: s, limits: reportCardLimits({}), now: NOW, run: vi.fn() });
    expect(s.releaseCard).toHaveBeenCalledWith('once', 1, { status: 'queued', started_at: null });
    expect(s.releaseCard).toHaveBeenCalledWith(
      'twice',
      MAX_ATTEMPTS,
      expect.objectContaining({ status: 'failed' }),
    );
  });
});

describe('runCard', () => {
  it('keeps the figures and the cost of a ready card', async () => {
    const s = store();
    s.cardInputs.mockResolvedValueOnce({
      industry: 'saas',
      dealValue: { amount: 9000, currency: 'EUR' },
    });
    const build = vi.fn(async (input, { meter }) => {
      meter.models += 0.01;
      meter.answers += 0.2;
      return { payload: { companyName: 'Acme' }, questions: [{ text: 'q' }] };
    });
    expect(await runCard(card('a'), { store: s, build, now: () => NOW })).toBe('ready');
    expect(build.mock.calls[0][0]).toMatchObject({
      industry: 'saas',
      dealValue: { amount: 9000, currency: 'EUR' },
    });
    expect(s.finishCard).toHaveBeenCalledWith('a', 1, {
      status: 'ready',
      payload: { companyName: 'Acme' },
      questions: [{ text: 'q' }],
      cost_usd: 0.21,
      finished_at: NOW.toISOString(),
      error: null,
    });
  });

  it('fails a card with why, and what it spent before', async () => {
    const s = store();
    const build = vi.fn(async (input, { meter }) => {
      meter.models += 0.01;
      throw new Error('No engine answered');
    });
    expect(await runCard(card('a'), { store: s, build, now: () => NOW })).toBe('failed');
    expect(s.finishCard).toHaveBeenCalledWith('a', 1, {
      status: 'failed',
      cost_usd: 0.01,
      finished_at: NOW.toISOString(),
      error: 'No engine answered',
    });
  });
});

describe('a slow run', () => {
  it('asks the engines until a deadline well below the time a run is taken as lost', async () => {
    expect(RUN_DEADLINE_MS).toBeLessThanOrEqual(STALE_MS - 15 * 60 * 1000);
    const build = vi.fn(async () => ({ payload: {}, questions: [] }));
    await runCard(card('a'), { store: store(), build, now: () => NOW });
    expect(build.mock.calls[0][1].deadline).toBe(NOW.getTime() + RUN_DEADLINE_MS);
  });

  it('writes only as the attempt it was started as', async () => {
    const s = store();
    const build = vi.fn(async () => ({ payload: {}, questions: [] }));
    await runCard({ ...card('a'), attempts: 2 }, { store: s, build, now: () => NOW });
    expect(s.finishCard.mock.calls[0][1]).toBe(2);
  });
});

describe('the store', () => {
  /** A query builder that records its filters. */
  const recorder = () => {
    const filters = [];
    const q = {
      from: () => q,
      update: () => q,
      eq: (col, val) => {
        filters.push([col, val]);
        return q;
      },
      then: (resolve) => resolve({ error: null }),
    };
    return { db: q, filters };
  };

  it('finishes and releases a card only while it is still that attempt’s run', async () => {
    for (const write of ['finishCard', 'releaseCard']) {
      const { db, filters } = recorder();
      await reportCardStore(db)[write]('a', 2, { status: 'failed' });
      expect(filters).toEqual([
        ['id', 'a'],
        ['status', 'running'],
        ['attempts', 2],
      ]);
    }
  });
});

describe('pruneReportCardRequests', () => {
  it('deletes the requests older than 12 months', async () => {
    const s = store();
    expect(await pruneReportCardRequests({ store: s, now: NOW })).toBe(4);
    expect(s.pruneRequests).toHaveBeenCalledWith(new Date('2025-11-03T10:00:00Z'));
  });
});

describe('startReportCardQueue', () => {
  it('ticks every minute and prunes daily', () => {
    const schedule = vi.fn(() => ({}));
    expect(startReportCardQueue(schedule)).toHaveLength(2);
    expect(schedule.mock.calls.map(([when]) => when)).toEqual(['* * * * *', '23 3 * * *']);
  });
});
