import { describe, expect, it } from 'vitest';
import { pagesSince, parseSince, runningSummary } from './batch.js';

const page = (key, status, createdAt) => ({ key, runs: [{ status, createdAt }] });

describe('parseSince', () => {
  it('reads an ISO time, and nothing else', () => {
    expect(parseSince('2026-11-19T10:00:00Z')).toBe(Date.parse('2026-11-19T10:00:00Z'));
    expect(parseSince('soon')).toBeNull();
    expect(parseSince('')).toBeNull();
    expect(parseSince(undefined)).toBeNull();
    expect(parseSince(['2026-11-19'])).toBeNull();
  });
});

describe('pagesSince', () => {
  it('keeps the pages whose latest run started at or after the time', () => {
    const pages = [
      page('a', 'running', '2026-11-19T10:05:00Z'),
      page('b', 'completed', '2026-11-19T10:00:00Z'),
      page('c', 'completed', '2026-11-19T09:59:59Z'),
      { key: 'd', runs: [] },
    ];
    const since = Date.parse('2026-11-19T10:00:00Z');
    expect(pagesSince(pages, since).map((p) => p.key)).toEqual(['a', 'b']);
  });
});

describe('runningSummary', () => {
  it('counts the pages running and gives the oldest start', () => {
    const pages = [
      page('a', 'running', '2026-11-19T10:05:00Z'),
      page('b', 'running', '2026-11-19T10:00:00Z'),
      page('c', 'completed', '2026-11-19T09:00:00Z'),
    ];
    expect(runningSummary(pages)).toEqual({ count: 2, since: '2026-11-19T10:00:00.000Z' });
  });

  it('is zero with no time when nothing runs', () => {
    expect(runningSummary([page('c', 'completed', '2026-11-19T09:00:00Z')])).toEqual({
      count: 0,
      since: null,
    });
    expect(runningSummary([])).toEqual({ count: 0, since: null });
  });
});
