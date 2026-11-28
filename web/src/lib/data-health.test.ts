import { describe, expect, it } from 'vitest';
import { dataHealthArgs, parseDataHealth, receivedPercent } from './data-health';

const NOW = new Date('2026-11-28T10:00:00Z');
const base = { datePreset: '7d' as const, dateFrom: '', dateTo: '', region: '', topic: '' };

describe('dataHealthArgs', () => {
  it('reads a whole-day preset as its UTC days, with no filters', () => {
    expect(dataHealthArgs(base, NOW)).toEqual({
      dayFrom: '2026-11-22',
      dayTo: '2026-11-28',
      region: undefined,
      topicId: undefined,
    });
  });

  it('reads 24h as the two UTC days it touches', () => {
    expect(dataHealthArgs({ ...base, datePreset: '24h' }, NOW)).toMatchObject({
      dayFrom: '2026-11-27',
      dayTo: '2026-11-28',
    });
  });

  it('leaves all time open, and passes a custom range, the region and the topic', () => {
    expect(dataHealthArgs({ ...base, datePreset: 'all' }, NOW)).toMatchObject({
      dayFrom: undefined,
      dayTo: undefined,
    });
    expect(
      dataHealthArgs(
        {
          datePreset: 'custom',
          dateFrom: '2026-11-01',
          dateTo: '2026-11-10',
          region: 'US',
          topic: '11111111-1111-4111-8111-111111111111',
        },
        NOW,
      ),
    ).toEqual({
      dayFrom: '2026-11-01',
      dayTo: '2026-11-10',
      region: 'US',
      topicId: '11111111-1111-4111-8111-111111111111',
    });
  });
});

describe('receivedPercent', () => {
  it('rounds to a whole percent', () => {
    expect(receivedPercent(98, 100)).toBe(98);
    expect(receivedPercent(2, 3)).toBe(67);
    expect(receivedPercent(10, 10)).toBe(100);
  });

  it('never shows 100% while answers are missing, nor 0% once one came in', () => {
    expect(receivedPercent(999, 1000)).toBe(99);
    expect(receivedPercent(1, 1000)).toBe(1);
    expect(receivedPercent(0, 1000)).toBe(0);
  });

  it('is null when nothing was expected, and capped at 100', () => {
    expect(receivedPercent(0, 0)).toBeNull();
    expect(receivedPercent(12, 10)).toBe(100);
  });
});

describe('parseDataHealth', () => {
  it('maps the rows, works out what is missing and sums the platforms', () => {
    const health = parseDataHealth([
      {
        platform: 'chatgpt-web',
        expected: '9',
        received: 8,
        last_answer_at: '2026-11-28T09:00:00Z',
      },
      { platform: 'google-aio', expected: 12, received: 3, last_answer_at: null },
    ]);
    expect(health.rows).toEqual([
      {
        platform: 'chatgpt-web',
        expected: 9,
        received: 8,
        missing: 1,
        percent: 89,
        lastAnswerAt: '2026-11-28T09:00:00Z',
      },
      {
        platform: 'google-aio',
        expected: 12,
        received: 3,
        missing: 9,
        percent: 25,
        lastAnswerAt: null,
      },
    ]);
    expect(health).toMatchObject({ expected: 21, received: 11, missing: 10, percent: 52 });
  });

  it('caps received at expected and drops platforms with nothing expected', () => {
    const health = parseDataHealth([
      { platform: 'chatgpt-web', expected: 5, received: 7, last_answer_at: null },
      { platform: 'gemini-web', expected: 0, received: 0, last_answer_at: null },
    ]);
    expect(health.rows).toHaveLength(1);
    expect(health.rows[0]).toMatchObject({ received: 5, missing: 0, percent: 100 });
  });

  it('is empty without rows', () => {
    expect(parseDataHealth(null)).toEqual({
      rows: [],
      expected: 0,
      received: 0,
      missing: 0,
      percent: null,
    });
  });
});
