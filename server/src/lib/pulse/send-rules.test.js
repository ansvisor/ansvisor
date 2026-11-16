import { describe, expect, it } from 'vitest';

import { skipsAsNotNotable } from './send-rules.js';

const quiet = { highlights: [], warnings: [] };

describe('skipsAsNotNotable', () => {
  it('sends the first pulse even when nothing is notable', () => {
    expect(skipsAsNotNotable({ frequency: 'notable', isFirstPulse: true, metrics: quiet })).toBe(
      false,
    );
  });

  it('skips a later pulse with nothing notable', () => {
    expect(skipsAsNotNotable({ frequency: 'notable', isFirstPulse: false, metrics: quiet })).toBe(
      true,
    );
  });

  it('sends a later pulse with a highlight or a warning', () => {
    const highlight = { highlights: [{ type: 'new_engine' }], warnings: [] };
    const warning = { highlights: [], warnings: [{ type: 'sharp_drop' }] };
    expect(
      skipsAsNotNotable({ frequency: 'notable', isFirstPulse: false, metrics: highlight }),
    ).toBe(false);
    expect(skipsAsNotNotable({ frequency: 'notable', isFirstPulse: false, metrics: warning })).toBe(
      false,
    );
  });

  it('never skips the other frequencies', () => {
    for (const frequency of ['daily', 'weekly', 'off']) {
      expect(skipsAsNotNotable({ frequency, isFirstPulse: false, metrics: quiet })).toBe(false);
    }
  });
});
