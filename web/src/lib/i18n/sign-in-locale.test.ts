import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { uiLocaleCookieOnSignIn } from './sign-in-locale';
// These tests cover a customer meeting a language that isn't offered yet, so the
// customer list is pinned to English here (in the app every language is offered).
vi.mock('@/i18n/locales', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/locales')>()),
  TRANSLATED_LOCALES: ['en'],
}));

/**
 * A person's first signed-in request (the proxy): a language picked while
 * signing up (a cookie with no person's id) goes on their own profile, only
 * while their profile has none; the cookie then carries their id.
 */

function profiles(uiLanguage: string | null) {
  const updates: { row: Record<string, unknown>; filters: string[] }[] = [];
  let reads = 0;
  const db = {
    from: (table: string) => {
      expect(table).toBe('profiles');
      const filters: string[] = [];
      const chain = {
        select: () => chain,
        update: (row: Record<string, unknown>) => {
          updates.push({ row, filters });
          return chain;
        },
        eq: (column: string, value: string) => {
          filters.push(`${column}=${value}`);
          return chain;
        },
        is: (column: string, value: null) => {
          filters.push(`${column} is ${value}`);
          return chain;
        },
        maybeSingle: async () => {
          reads += 1;
          return { data: { ui_language: uiLanguage }, error: null };
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return chain;
    },
  };
  return {
    db: db as unknown as SupabaseClient<Database>,
    updates,
    reads: () => reads,
  };
}

describe('uiLocaleCookieOnSignIn', () => {
  it('saves the sign-up pick on a profile that has none, then marks the cookie theirs', async () => {
    const p = profiles(null);
    expect(await uiLocaleCookieOnSignIn('en', 'user-1', p.db)).toBe('en:user-1');
    expect(p.updates).toEqual([
      { row: { ui_language: 'en' }, filters: ['id=user-1', 'ui_language is null'] },
    ]);
  });

  it("never overwrites the profile's own choice", async () => {
    const p = profiles('tr');
    expect(await uiLocaleCookieOnSignIn('en', 'user-1', p.db)).toBe('tr:user-1');
    expect(p.updates).toEqual([]);
  });

  it('keeps a language without a messages file in the cookie only', async () => {
    const p = profiles(null);
    expect(await uiLocaleCookieOnSignIn('de', 'user-1', p.db)).toBe('de:user-1');
    expect(p.updates).toEqual([]);
  });

  it("saves nothing from another person's cookie, or from none", async () => {
    const other = profiles(null);
    expect(await uiLocaleCookieOnSignIn('en:user-2', 'user-1', other.db)).toBe('auto:user-1');
    expect(other.updates).toEqual([]);
    const none = profiles(null);
    expect(await uiLocaleCookieOnSignIn(undefined, 'user-1', none.db)).toBe('auto:user-1');
    expect(none.updates).toEqual([]);
  });

  it('leaves a cookie that is already theirs alone, without reading', async () => {
    const p = profiles(null);
    expect(await uiLocaleCookieOnSignIn('en:user-1', 'user-1', p.db)).toBeNull();
    expect(p.reads()).toBe(0);
    expect(p.updates).toEqual([]);
  });
});
