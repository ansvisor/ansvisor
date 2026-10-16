import { describe, expect, it } from 'vitest';
import { opportunityLevel } from './prompt-volume-opportunity';

describe('opportunityLevel', () => {
  it('leaves a prompt under 500 AI searches a month off the list', () => {
    expect(opportunityLevel(0)).toBeNull();
    expect(opportunityLevel(499)).toBeNull();
  });

  it('calls 500 to 999 Medium and 1,000 or more High', () => {
    expect(opportunityLevel(500)).toBe('medium');
    expect(opportunityLevel(999)).toBe('medium');
    expect(opportunityLevel(1000)).toBe('high');
    expect(opportunityLevel(1215)).toBe('high');
  });
});
