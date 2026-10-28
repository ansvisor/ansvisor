import { describe, expect, it } from 'vitest';
import {
  BRAND_SETUP_LIMITS,
  boundedBrandSetup,
  brandSetupSchema,
  promptsFromTopicsSchema,
} from './brand-setup-input.js';

/** What setup's suggestion routes take into a model's prompt (#1611 follow-up). */

const brand = { brandName: 'Acme Coffee', description: 'Specialty coffee', website: 'acme.com' };

describe('brandSetupSchema', () => {
  it('takes what the onboarding form sends, empty industry and missing fields too', () => {
    expect(brandSetupSchema.safeParse({ ...brand, industry: '', language: 'en' }).success).toBe(
      true,
    );
    expect(brandSetupSchema.safeParse({ brandName: 'Acme', region: 'US-CA' }).success).toBe(true);
  });

  it('refuses a missing name, and any field past its length', () => {
    expect(brandSetupSchema.safeParse({}).success).toBe(false);
    expect(brandSetupSchema.safeParse({ brandName: '   ' }).success).toBe(false);
    const over = (field, max) =>
      brandSetupSchema.safeParse({ ...brand, [field]: 'x'.repeat(max + 1) }).success;
    expect(over('brandName', BRAND_SETUP_LIMITS.name)).toBe(false);
    expect(over('website', BRAND_SETUP_LIMITS.website)).toBe(false);
    expect(over('industry', BRAND_SETUP_LIMITS.industry)).toBe(false);
    expect(over('description', BRAND_SETUP_LIMITS.description)).toBe(false);
    expect(brandSetupSchema.safeParse({ ...brand, description: 'x'.repeat(2000) }).success).toBe(
      true,
    );
  });
});

describe('promptsFromTopicsSchema', () => {
  it('takes up to 20 topics of up to 100 characters', () => {
    const topics = Array.from({ length: 20 }, (_, i) => `${'t'.repeat(97)}${i}`.slice(0, 100));
    expect(promptsFromTopicsSchema.safeParse({ ...brand, topics }).success).toBe(true);
  });

  it('refuses no topics, too many, or one too long', () => {
    expect(promptsFromTopicsSchema.safeParse({ ...brand, topics: [] }).success).toBe(false);
    expect(
      promptsFromTopicsSchema.safeParse({ ...brand, topics: Array(21).fill('coffee') }).success,
    ).toBe(false);
    expect(promptsFromTopicsSchema.safeParse({ ...brand, topics: ['x'.repeat(101)] }).success).toBe(
      false,
    );
  });
});

describe('boundedBrandSetup', () => {
  it('cuts a stored brand to the same lengths, never half an emoji', () => {
    const bounded = boundedBrandSetup({
      brandName: 'Acme',
      industry: null,
      description: `${'x'.repeat(1999)}☕️more`,
      website: undefined,
    });
    expect(bounded).toEqual({
      brandName: 'Acme',
      industry: null,
      description: `${'x'.repeat(1999)}☕`,
      website: undefined,
    });
    // Two units past the limit's last: left out whole, so zod's count holds.
    const emoji = boundedBrandSetup({ brandName: `${'n'.repeat(199)}😀` });
    expect(emoji.brandName).toBe('n'.repeat(199));
    expect(brandSetupSchema.safeParse(emoji).success).toBe(true);
  });
});
