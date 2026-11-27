import { describe, expect, it } from 'vitest';
import { PLANS } from './plans.js';
import { SLOT_PLATFORM_IDS, STANDARD_SLOT_PLATFORMS, slottedPlatforms } from './tracking-slots.js';

describe('slottedPlatforms', () => {
  it("covers Growth's five standard platforms, and no other until slots are bought", () => {
    const slotted = slottedPlatforms(PLANS.growth, {});
    expect([...slotted].sort()).toEqual([...STANDARD_SLOT_PLATFORMS].sort());
    expect(slotted.has('grok-web')).toBe(false);
    expect(slotted.has('perplexity-web')).toBe(false);
  });

  it('adds each platform the workspace bought slots for', () => {
    const slotted = slottedPlatforms(PLANS.growth, { 'claude-web': 100, 'meta-ai-web': 0 });
    expect(slotted.has('claude-web')).toBe(true);
    expect(slotted.has('meta-ai-web')).toBe(false);
  });

  it("covers Starter's own two platforms", () => {
    expect([...slottedPlatforms(PLANS.starter, null)].sort()).toEqual([
      'chatgpt-web',
      'gemini-web',
    ]);
  });

  it('limits nothing on self-hosted or with no plan', () => {
    expect(slottedPlatforms(PLANS.self_hosted, {})).toBeNull();
    expect(slottedPlatforms(null, {})).toBeNull();
  });

  it('ignores a malformed slots value', () => {
    expect(slottedPlatforms(PLANS.growth, ['claude-web']).has('claude-web')).toBe(false);
    expect(slottedPlatforms(PLANS.growth, { 'claude-web': 'x' }).has('claude-web')).toBe(false);
  });

  it('knows the 13 platforms slots are sold for', () => {
    expect(SLOT_PLATFORM_IDS).toHaveLength(13);
  });
});
