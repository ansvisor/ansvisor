import { describe, expect, it } from 'vitest';
import { growsPastLimit, headingLimit } from './suggestions';

/**
 * How long an agent's change may make a heading: an H1 up to 70 characters,
 * other headings up to 90, as 2026's SEO/AEO guides advise. Longer, it has
 * taken in an answer.
 */
describe('growsPastLimit', () => {
  it('holds an H1 to 70 characters and other headings to 90', () => {
    expect([1, 2, 3, 6].map(headingLimit)).toEqual([70, 90, 90, 90]);
    expect(growsPastLimit(1, 20, 70)).toBe(false);
    expect(growsPastLimit(1, 20, 71)).toBe(true);
    expect(growsPastLimit(2, 20, 90)).toBe(false);
    expect(growsPastLimit(2, 20, 91)).toBe(true);
  });

  it('lets a heading already over its limit be shortened, never grown', () => {
    expect(growsPastLimit(2, 120, 110)).toBe(false);
    expect(growsPastLimit(2, 120, 120)).toBe(false);
    expect(growsPastLimit(2, 120, 121)).toBe(true);
  });
});
