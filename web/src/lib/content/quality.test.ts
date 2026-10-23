import { afterEach, describe, expect, it } from 'vitest';
import { qualityAverage, qualityBand, qualityPhase } from './quality';

/** The Quality scores' bands, the header chip's average, and the phase flag (Quality spec §2). */
describe('quality', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
  });

  it('bands a score: 80+ Strong, 60–79 Can improve, under 60 Needs work', () => {
    expect(qualityBand(80)).toBe('strong');
    expect(qualityBand(79)).toBe('improve');
    expect(qualityBand(60)).toBe('improve');
    expect(qualityBand(59)).toBe('needsWork');
  });

  it('averages only the scores that could be read', () => {
    expect(qualityAverage([78, null, 60])).toBe(69);
    expect(qualityAverage([null])).toBeNull();
  });

  it('reads the live phase from the flag, none when unset or odd', () => {
    expect(qualityPhase()).toBe(0);
    process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
    expect(qualityPhase()).toBe(1);
    process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '7';
    expect(qualityPhase()).toBe(3);
    process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = 'yes';
    expect(qualityPhase()).toBe(0);
  });
});
