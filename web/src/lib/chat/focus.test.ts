import { describe, expect, it } from 'vitest';
import { FOCUS_AREAS, focusOf, focusPicks, homeViewOf } from './focus';

/**
 * What Chat focuses on (CHAT-24 §2–3): the eight areas, a saved focus read
 * back, and Home's view (00485).
 */

describe('homeViewOf', () => {
  it('reads only focus as the focus view: anything else is the Default view', () => {
    expect(homeViewOf('focus')).toBe('focus');
    expect(homeViewOf('default')).toBe('default');
    expect(homeViewOf(null)).toBe('default');
    expect(homeViewOf(undefined)).toBe('default');
    expect(homeViewOf('board')).toBe('default');
  });
});

describe('focusOf', () => {
  it('reads null as never asked and a list as the picks, each known area once', () => {
    expect(focusOf(null)).toBeNull();
    expect(focusOf(undefined)).toBeNull();
    expect(focusOf([])).toEqual([]);
    expect(focusOf(['brand', 'devtools', 'comp', 'brand'])).toEqual(['brand', 'comp']);
  });
});

describe('focusPicks', () => {
  it('takes the known areas once each, all eight at most', () => {
    expect(focusPicks.safeParse([...FOCUS_AREAS]).success).toBe(true);
    expect(focusPicks.safeParse([]).success).toBe(true);
    expect(focusPicks.safeParse(['lead', 'lead']).success).toBe(false);
    expect(focusPicks.safeParse(['agency']).success).toBe(false);
  });
});
