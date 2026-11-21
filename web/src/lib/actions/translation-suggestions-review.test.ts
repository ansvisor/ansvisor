// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Staff's accept and reject (LOC-009): staff only, a new row only, nothing applied to the messages. */

let email: string | null = 'staff@ansvisor.com';
let confirmed: string | null = '2026-11-01T00:00:00Z';
let updated: Record<string, unknown>[] = [];
let filters: [string, unknown][] = [];
let found = [{ id: 's1' }];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: email ? { id: 'u1', email, email_confirmed_at: confirmed } : null },
      }),
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      expect(table).toBe('translation_suggestions');
      const chain = {
        update: (row: Record<string, unknown>) => {
          updated.push(row);
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        select: async () => ({ data: found, error: null }),
      };
      return chain;
    },
  },
}));

const { reviewTranslationSuggestion } = await import('./translation-suggestions-review');

beforeEach(() => {
  vi.stubEnv('STAFF_EMAILS', 'Staff@Ansvisor.com');
  email = 'staff@ansvisor.com';
  confirmed = '2026-11-01T00:00:00Z';
  updated = [];
  filters = [];
  found = [{ id: 's1' }];
});

describe('reviewTranslationSuggestion', () => {
  it('marks a new row accepted or rejected', async () => {
    expect(await reviewTranslationSuggestion('s1', 'accepted')).toEqual({ ok: true });
    expect(updated[0]).toMatchObject({ status: 'accepted' });
    expect(updated[0].reviewed_at).toBeTruthy();
    expect(filters).toEqual([
      ['id', 's1'],
      ['status', 'new'],
    ]);
    await reviewTranslationSuggestion('s1', 'rejected');
    expect(updated[1]).toMatchObject({ status: 'rejected' });
  });

  it('says not ok for a row already reviewed', async () => {
    found = [];
    expect(await reviewTranslationSuggestion('s1', 'accepted')).toEqual({ ok: false });
  });

  it('is not there for anyone but staff', async () => {
    email = 'customer@example.com';
    await expect(reviewTranslationSuggestion('s1', 'accepted')).rejects.toThrow('Not found');
    email = null;
    await expect(reviewTranslationSuggestion('s1', 'accepted')).rejects.toThrow('Not found');
    email = 'staff@ansvisor.com';
    confirmed = null;
    await expect(reviewTranslationSuggestion('s1', 'accepted')).rejects.toThrow('Not found');
    expect(updated).toEqual([]);
  });

  it('refuses a decision that is neither', async () => {
    await expect(reviewTranslationSuggestion('s1', 'deleted' as never)).rejects.toThrow();
  });
});
