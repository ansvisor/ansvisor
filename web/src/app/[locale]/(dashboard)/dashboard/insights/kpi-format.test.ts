import { describe, expect, it } from 'vitest';
import {
  arrowChange,
  formatWindowBound,
  lowerIsGood,
  signedChange,
  signedValue,
  upIsGood,
} from './kpi-format';

describe('KPI card formatting', () => {
  it('writes changes with a sign, and no change as ±0', () => {
    expect(signedChange(1.5)).toBe('+1.5');
    expect(signedChange(-3.2)).toBe('−3.2');
    expect(signedChange(0)).toBe('±0');
  });

  it('writes a zero value as 0, not as a change', () => {
    expect(signedValue(34)).toBe('+34');
    expect(signedValue(-6)).toBe('−6');
    expect(signedValue(0)).toBe('0');
  });

  it('colours a rise good and a fall bad on most cards', () => {
    expect(upIsGood(18, '%')).toEqual({ text: '+18%', tone: 'good' });
    expect(upIsGood(-4)).toEqual({ text: '−4', tone: 'bad' });
    expect(upIsGood(0, '%')).toEqual({ text: '±0', tone: 'neutral' });
    expect(upIsGood(null)).toBeNull();
  });

  it('reads a lower Avg. position as an improvement', () => {
    expect(lowerIsGood(-0.3)).toEqual({ text: '↑0.3', tone: 'good' });
    expect(lowerIsGood(0.5)).toEqual({ text: '↓0.5', tone: 'bad' });
    expect(lowerIsGood(0)).toEqual({ text: '±0', tone: 'neutral' });
  });

  it('writes a leaderboard change with an arrow', () => {
    expect(arrowChange(4.1)).toEqual({ text: '↑ 4.1', tone: 'good' });
    expect(arrowChange(-1.06)).toEqual({ text: '↓ 1.1', tone: 'bad' });
    expect(arrowChange(0)).toEqual({ text: '±0', tone: 'neutral' });
    expect(arrowChange(null)).toBeNull();
  });

  it('labels whole-day windows by their UTC days', () => {
    // A day-only bound is the UTC day itself, whatever the viewer's zone.
    expect(formatWindowBound('2026-08-16')).toBe('Aug 16, 2026');
  });
});
