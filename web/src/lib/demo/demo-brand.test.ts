import { describe, expect, it } from 'vitest';
import { demoActionName, demoOffer } from './demo-brand';

describe('demoOffer', () => {
  it('starts a workspace that never subscribed with the free trial', () => {
    expect(demoOffer(false)).toBe('trial');
  });

  it('gives a workspace whose plan ended 50% off its first month', () => {
    expect(demoOffer(true)).toBe('first_month');
  });
});

describe('demoActionName', () => {
  it("keeps a read-only label's doing", () => {
    expect(demoActionName('Adding prompts needs a plan')).toBe('Adding prompts');
    expect(demoActionName('Running the Content Agent needs a plan.')).toBe(
      'Running the Content Agent',
    );
  });

  it('keeps a label written another way whole', () => {
    expect(demoActionName('Run all')).toBe('Run all');
  });
});
