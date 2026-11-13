import { beforeEach, describe, expect, it, vi } from 'vitest';

let stored: unknown;
let denied: boolean;
let written: unknown;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      let updating = false;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        update: (patch: { content_rules: unknown }) => {
          updating = true;
          written = patch.content_rules;
          return chain;
        },
        maybeSingle: async () => ({ data: { content_rules: stored }, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: denied ? [] : updating ? [{ id: 'b' }] : null, error: null }),
      };
      return chain;
    },
  })),
}));

const { getContentRules, updateContentRules } = await import('./brand-content-rules');
const BRAND = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const input = {
  bannedPhrases: ['  cheapest ', 'Cheapest', 'best   price'],
  blockedDomains: ['https://www.Rival.example/blog'],
  allowedDomains: ['gov.example'],
  onlyAllowedDomains: true,
};

beforeEach(() => {
  stored = null;
  denied = false;
  written = undefined;
});

describe('updateContentRules', () => {
  it('cleans and saves the rules', async () => {
    const res = await updateContentRules(BRAND, input);
    expect(res).toEqual({
      rules: {
        bannedPhrases: ['cheapest', 'best price'],
        blockedDomains: ['rival.example'],
        allowedDomains: ['gov.example'],
        onlyAllowedDomains: true,
      },
    });
    expect(written).toEqual('rules' in res ? res.rules : null);
  });

  it('refuses what is not a domain, and lists over the cap, saving nothing', async () => {
    expect(await updateContentRules(BRAND, { ...input, blockedDomains: ['not a domain'] })).toEqual(
      {
        error: 'invalid',
      },
    );
    const many = Array.from({ length: 201 }, (_, i) => `phrase ${i}`);
    expect(await updateContentRules(BRAND, { ...input, bannedPhrases: many })).toEqual({
      error: 'too_many',
    });
    expect(written).toBeUndefined();
  });

  it('says forbidden when the row policy changes no row', async () => {
    denied = true;
    expect(await updateContentRules(BRAND, input)).toEqual({ error: 'forbidden' });
  });
});

describe('getContentRules', () => {
  it('reads a brand with no rules as none, and a stored value as rules', async () => {
    expect(await getContentRules(BRAND)).toMatchObject({
      bannedPhrases: [],
      onlyAllowedDomains: false,
    });
    stored = { bannedPhrases: ['guaranteed'], onlyAllowedDomains: true };
    expect(await getContentRules(BRAND)).toMatchObject({
      bannedPhrases: ['guaranteed'],
      onlyAllowedDomains: true,
    });
    expect(await getContentRules('nope')).toBeNull();
  });
});
