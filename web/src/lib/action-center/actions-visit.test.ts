import { afterEach, describe, expect, it } from 'vitest';
import {
  CLOSED_WEEK_DAYS,
  closedSince,
  isClosedThisWeek,
  isNewSinceVisit,
  readActionsVisit,
  writeActionsVisit,
} from './actions-visit';

/** The Actions list's summary: New since the last visit, and closed this week. */

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};
Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage });

afterEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage });
  localStorage.clear();
});

describe('the last visit', () => {
  it('is kept per person and brand', () => {
    expect(readActionsVisit('u1', 'b1')).toBeNull();
    writeActionsVisit('u1', 'b1', new Date('2026-11-20T10:00:00Z'));
    writeActionsVisit('u2', 'b1', new Date('2026-11-21T10:00:00Z'));
    expect(readActionsVisit('u1', 'b1')).toBe('2026-11-20T10:00:00.000Z');
    expect(readActionsVisit('u2', 'b1')).toBe('2026-11-21T10:00:00.000Z');
    expect(readActionsVisit('u1', 'b2')).toBeNull();
  });

  it('reads as none when what is kept is not a time', () => {
    localStorage.setItem('aeo:actions-visit:u1:b1', 'yesterday-ish');
    expect(readActionsVisit('u1', 'b1')).toBeNull();
  });

  it('reads as none and keeps nothing when storage throws (private mode)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: throwing });
    expect(() => writeActionsVisit('u1', 'b1', new Date())).not.toThrow();
    expect(readActionsVisit('u1', 'b1')).toBeNull();
  });
});

describe('isNewSinceVisit', () => {
  const visit = '2026-11-20T10:00:00.000Z';

  it('is an action created after the visit', () => {
    expect(isNewSinceVisit({ createdAt: '2026-11-20T10:00:01.000Z' }, visit)).toBe(true);
  });

  it('is not one created before it, even if updated since: that keeps its dot', () => {
    expect(isNewSinceVisit({ createdAt: '2026-11-19T00:00:00.000Z' }, visit)).toBe(false);
    expect(isNewSinceVisit({ createdAt: visit }, visit)).toBe(false);
  });

  it('marks nothing without a visit, rather than everything', () => {
    expect(isNewSinceVisit({ createdAt: '2026-11-21T00:00:00.000Z' }, null)).toBe(false);
  });
});

describe('closed this week', () => {
  const now = new Date('2026-11-21T12:00:00.000Z');

  it('starts 7 days before now', () => {
    expect(CLOSED_WEEK_DAYS).toBe(7);
    expect(closedSince(now)).toBe('2026-11-14T12:00:00.000Z');
  });

  it('is a completed or dismissed action changed in the last 7 days', () => {
    const at = '2026-11-14T12:00:00.000Z';
    expect(isClosedThisWeek({ status: 'completed', updatedAt: at }, now)).toBe(true);
    expect(isClosedThisWeek({ status: 'dismissed', updatedAt: '2026-11-20T00:00:00Z' }, now)).toBe(
      true,
    );
  });

  it('is not an older one, nor an open one', () => {
    expect(isClosedThisWeek({ status: 'completed', updatedAt: '2026-11-14T11:59:59Z' }, now)).toBe(
      false,
    );
    expect(isClosedThisWeek({ status: 'new', updatedAt: '2026-11-21T00:00:00Z' }, now)).toBe(false);
    expect(isClosedThisWeek({ status: 'on_hold', updatedAt: '2026-11-21T00:00:00Z' }, now)).toBe(
      false,
    );
  });
});
