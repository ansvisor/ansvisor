import { describe, expect, it } from 'vitest';
import {
  changeOf,
  chatgptVisits,
  checkDraft,
  cleanTopics,
  draftOf,
  entryWindow,
  isTrackedTopic,
  previousOf,
  readCount,
  yesterday,
  type BusinessHubEntry,
  type EntryDraft,
} from './numbers';

const NOW = new Date('2026-11-11T10:00:00Z');

const entry = (over: Partial<BusinessHubEntry>): BusinessHubEntry => ({
  id: 'e',
  periodDays: 7,
  periodEnd: '2026-11-10',
  mentions: 53,
  websiteClicks: 19,
  profileViews: null,
  topics: [],
  source: 'manual',
  updatedAt: null,
  ...over,
});

describe('entryWindow', () => {
  it('covers the whole UTC days ending on the last day', () => {
    expect(entryWindow({ periodDays: 7, periodEnd: '2026-11-10' })).toEqual({
      from: '2026-11-04T00:00:00.000Z',
      to: '2026-11-10T23:59:59.999Z',
      firstDay: '2026-11-04',
    });
    expect(entryWindow({ periodDays: 28, periodEnd: '2026-03-01' }).firstDay).toBe('2026-02-02');
  });
});

describe('previousOf and changeOf', () => {
  it('finds the newest entry before of the same length', () => {
    const latest = entry({ id: 'a', periodEnd: '2026-11-10' });
    const entries = [
      latest,
      entry({ id: 'b', periodDays: 28, periodEnd: '2026-11-09' }),
      entry({ id: 'c', periodEnd: '2026-11-03' }),
      entry({ id: 'd', periodEnd: '2026-10-27' }),
    ];
    expect(previousOf(entries, latest)?.id).toBe('c');
    expect(previousOf([latest], latest)).toBeNull();
    expect(previousOf(entries, null)).toBeNull();
  });

  it('has no change when either number is missing', () => {
    expect(changeOf(53, 44)).toBe(9);
    expect(changeOf(40, 44)).toBe(-4);
    expect(changeOf(null, 44)).toBeNull();
    expect(changeOf(53, null)).toBeNull();
  });
});

describe('chatgptVisits', () => {
  it('counts ChatGPT’s hosts only', () => {
    expect(
      chatgptVisits([
        { platform: 'chatgpt.com', visits: 40 },
        { platform: 'chat.openai.com', visits: 2 },
        { platform: 'search.chatgpt.com', visits: 1 },
        { platform: 'perplexity.ai', visits: 30 },
        { platform: 'gemini.google.com', visits: 9 },
        { platform: 'unknown', visits: 5 },
      ]),
    ).toBe(43);
    expect(chatgptVisits([])).toBe(0);
  });
});

describe('readCount', () => {
  it('reads whole numbers, with thousands marked as Turkish and English Excel write them', () => {
    expect(readCount('')).toBeNull();
    expect(readCount('  ')).toBeNull();
    expect(readCount('0')).toBe(0);
    expect(readCount('1240')).toBe(1240);
    expect(readCount('1.240')).toBe(1240);
    expect(readCount('1,240')).toBe(1240);
    expect(readCount('1 240 000')).toBe(1240000);
  });

  it('refuses decimals, negatives, words and a number too big to keep', () => {
    for (const text of ['1.5', '-3', '12a', '1,24', '1.2345', '9999999999']) {
      expect(readCount(text), text).toBe('invalid');
    }
  });
});

describe('cleanTopics and isTrackedTopic', () => {
  it('keeps each topic once, trimmed', () => {
    expect(cleanTopics([' Coffee  gifts ', 'coffee gifts', '', 'İstanbul', 'istanbul'])).toEqual([
      'Coffee gifts',
      'İstanbul',
    ]);
  });

  it('matches a tracked topic whatever its case', () => {
    expect(isTrackedTopic('coffee SUBSCRIPTIONS', ['Coffee subscriptions'])).toBe(true);
    expect(isTrackedTopic('Decaf coffee', ['Coffee subscriptions'])).toBe(false);
  });
});

describe('checkDraft', () => {
  const draft = (over: Partial<EntryDraft> = {}): EntryDraft => ({
    ...draftOf(null, NOW),
    mentions: '53',
    ...over,
  });

  it('starts on 7 days ending yesterday, five empty topics', () => {
    expect(draftOf(null, NOW)).toEqual({
      periodDays: 7,
      periodEnd: '2026-11-10',
      mentions: '',
      websiteClicks: '',
      profileViews: '',
      topics: ['', '', '', '', ''],
    });
    expect(yesterday(NOW)).toBe('2026-11-10');
  });

  it('gives the entry to send, an empty number as not shown', () => {
    expect(
      checkDraft(draft({ topics: ['Coffee gifts', ' coffee gifts', '', '', ''] }), NOW),
    ).toEqual({
      ok: true,
      entry: {
        periodDays: 7,
        periodEnd: '2026-11-10',
        mentions: 53,
        websiteClicks: null,
        profileViews: null,
        topics: ['Coffee gifts'],
      },
    });
  });

  it('refuses an empty entry, a number that isn’t whole, and a last day out of range', () => {
    expect(checkDraft(draft({ mentions: '' }), NOW)).toEqual({
      ok: false,
      problems: { entry: 'empty' },
    });
    expect(checkDraft(draft({ websiteClicks: '2.5' }), NOW)).toEqual({
      ok: false,
      problems: { websiteClicks: 'invalid' },
    });
    expect(checkDraft(draft({ periodEnd: '2026-11-14' }), NOW)).toMatchObject({
      problems: { periodEnd: 'future' },
    });
    expect(checkDraft(draft({ periodEnd: '2024-01-01' }), NOW)).toMatchObject({
      problems: { periodEnd: 'too_old' },
    });
    expect(checkDraft(draft({ periodEnd: '' }), NOW)).toMatchObject({
      problems: { periodEnd: 'invalid' },
    });
    expect(checkDraft(draft({ topics: ['x'.repeat(121), '', '', '', ''] }), NOW)).toMatchObject({
      problems: { topics: 'too_long' },
    });
  });

  it('fills the draft from an entry to edit it', () => {
    expect(
      draftOf(entry({ periodDays: 28, mentions: 0, profileViews: 131, topics: ['A', 'B'] }), NOW),
    ).toEqual({
      periodDays: 28,
      periodEnd: '2026-11-10',
      mentions: '0',
      websiteClicks: '19',
      profileViews: '131',
      topics: ['A', 'B', '', '', ''],
    });
  });
});
