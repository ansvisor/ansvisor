import { describe, expect, it } from 'vitest';

import { compareNullsLast } from './prompt-sort';

describe('compareNullsLast', () => {
  it('sorts non-null values ascending', () => {
    expect([5, 1, 3].sort((a, b) => compareNullsLast(a, b, 'asc'))).toEqual([1, 3, 5]);
  });

  it('sorts non-null values descending', () => {
    expect([5, 1, 3].sort((a, b) => compareNullsLast(a, b, 'desc'))).toEqual([5, 3, 1]);
  });

  it('keeps nulls last in ascending order', () => {
    const sorted = [3, null, 1, null, 2].sort((a, b) => compareNullsLast(a, b, 'asc'));
    expect(sorted).toEqual([1, 2, 3, null, null]);
  });

  it('keeps nulls last in descending order too', () => {
    const sorted = [3, null, 1, null, 2].sort((a, b) => compareNullsLast(a, b, 'desc'));
    expect(sorted).toEqual([3, 2, 1, null, null]);
  });

  it('treats equal values and two nulls as ties', () => {
    expect(compareNullsLast(4, 4, 'asc')).toBe(0);
    expect(compareNullsLast(null, null, 'desc')).toBe(0);
  });
});
