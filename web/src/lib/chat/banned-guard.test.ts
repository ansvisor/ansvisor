import { beforeEach, describe, expect, it, vi } from 'vitest';

let rules: unknown;
let fail: boolean;
const tables: string[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      tables.push(table);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (fail) throw new Error('down');
          return {
            data:
              table === 'brands' ? { content_rules: rules } : { brands: { content_rules: rules } },
          };
        },
      };
      return chain;
    },
  },
}));

const { refuseBannedPhrases } = await import('./banned-guard');
const page = '<h1>Trip</h1><p>The CHEAPEST, guaranteed trip.</p>';

beforeEach(() => {
  rules = { bannedPhrases: ['cheapest', 'guaranteed', 'free gift'] };
  fail = false;
  tables.length = 0;
});

describe('refuseBannedPhrases', () => {
  it('refuses a draft with a banned phrase, naming the phrases found', async () => {
    const refused = await refuseBannedPhrases({ brandId: 'b' }, ['Trip', page]);
    expect(refused).toMatchObject({ ok: false, reason: 'invalid' });
    expect(refused?.message).toContain('"cheapest", "guaranteed"');
    expect(refused?.message).not.toContain('free gift');
  });

  it('finds the brand of a draft being changed', async () => {
    expect(await refuseBannedPhrases({ draftId: 'd' }, [undefined, page])).toMatchObject({
      ok: false,
    });
    expect(tables).toEqual(['content_drafts']);
  });

  it('lets a clean draft, a brand with no rules and a failed read through', async () => {
    expect(await refuseBannedPhrases({ brandId: 'b' }, ['Trip', '<p>A good trip.</p>'])).toBeNull();
    rules = null;
    expect(await refuseBannedPhrases({ brandId: 'b' }, [page])).toBeNull();
    rules = { bannedPhrases: ['cheapest'] };
    fail = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await refuseBannedPhrases({ brandId: 'b' }, [page])).toBeNull();
  });
});
