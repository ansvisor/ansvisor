import { describe, expect, it } from 'vitest';
import {
  SHOWN_DAYS,
  feedsState,
  localDay,
  parseSuggestionSummary,
  roleFeed,
  sentDay,
  shownSince,
  suggestionDot,
} from './daily-suggestions';

/**
 * Daily suggestions in the Inbox (CHAT-26 §2.2, §5, §6): the last 7 days
 * only, the row's dot, the person's feeds as one state, who gets them, and
 * the summary the nightly job keeps (W2-24's version 1).
 */

describe('shownSince', () => {
  it('shows the last 7 days only', () => {
    expect(SHOWN_DAYS).toBe(7);
    expect(shownSince(new Date('2026-10-29T09:00:00.000Z'))).toBe('2026-10-22T09:00:00.000Z');
  });
});

describe('roleFeed', () => {
  it('gives Admins and Managers suggestions by default, Agency partners once they open the Inbox, Analysts none', () => {
    expect(roleFeed('admin')).toBe('default_on');
    expect(roleFeed('manager')).toBe('default_on');
    expect(roleFeed('agency_partner')).toBe('opt_in');
    expect(roleFeed('analyst')).toBe('never');
    expect(roleFeed(null)).toBe('never');
  });
});

describe('feedsState', () => {
  it('is on while any brand is, else paused, else off, else none', () => {
    expect(feedsState(['paused', 'on'])).toBe('on');
    expect(feedsState(['off', 'paused'])).toBe('paused');
    expect(feedsState(['off'])).toBe('off');
    expect(feedsState([])).toBe('none');
  });
});

describe('suggestionDot', () => {
  const row = { seenAt: null, openedAt: null, startedAt: null };
  it('is new until seen, seen once seen or opened, started once started', () => {
    expect(suggestionDot(row)).toBe('new');
    expect(suggestionDot({ ...row, seenAt: '2026-10-29T08:00:00Z' })).toBe('seen');
    expect(suggestionDot({ ...row, openedAt: '2026-10-29T08:00:00Z' })).toBe('seen');
    expect(
      suggestionDot({
        seenAt: '2026-10-29T08:00:00Z',
        openedAt: '2026-10-29T08:01:00Z',
        startedAt: '2026-10-29T08:02:00Z',
      }),
    ).toBe('started');
  });
});

describe('parseSuggestionSummary', () => {
  it("reads the job's version-1 summary", () => {
    expect(
      parseSuggestionSummary({
        version: 1,
        action: {
          no: 2841,
          kind: 'improve_page_content',
          category: 'growth',
          impact: 'high',
          createdAt: '2026-10-23T08:00:00Z',
          payload: { targetEntity: 'pages', targetCount: 5 },
        },
        priority: { score: 81, level: 'high', reason: null },
        waitingDays: 6,
        ranking: { score: 87, waitPoints: 1, startNowPoints: 5, variety: false },
        startNow: { method: 'optimize', pages: 5, minutes: 20 },
        play: null,
      }),
    ).toEqual({
      actionNo: 2841,
      kind: 'improve_page_content',
      payload: { targetEntity: 'pages', targetCount: 5 },
      priorityLevel: 'high',
      startNow: { method: 'optimize', pages: 5, minutes: 20 },
    });
  });

  it('reads a missing or odd part as none, and a level from the score when it has none', () => {
    expect(parseSuggestionSummary(null)).toEqual({
      actionNo: null,
      kind: '',
      payload: {},
      priorityLevel: null,
      startNow: null,
    });
    expect(
      parseSuggestionSummary({
        action: { no: '12', kind: 'add_llms_txt', payload: [] },
        priority: { score: 60 },
        startNow: { method: 'publish', minutes: 4 },
      }),
    ).toEqual({
      actionNo: null,
      kind: 'add_llms_txt',
      payload: {},
      priorityLevel: 'medium',
      startNow: null,
    });
  });
});

describe('sentDay', () => {
  const now = new Date(2026, 9, 29, 9, 30);
  it("says the day it was sent, and whether it is today by the person's clock", () => {
    expect(localDay(now)).toBe('2026-10-29');
    expect(sentDay('2026-10-29', now)).toEqual({ date: 'Oct 29', today: true });
    expect(sentDay('2026-10-28', now)).toEqual({ date: 'Oct 28', today: false });
  });

  it('is never today before the clock is known', () => {
    expect(sentDay('2026-10-29', null)).toEqual({ date: 'Oct 29', today: false });
  });
});
