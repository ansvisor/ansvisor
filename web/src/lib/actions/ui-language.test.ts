// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
// These tests cover a customer meeting a language that isn't offered yet, so the
// customer list is pinned to English here (in the app every language is offered).
vi.mock('@/i18n/locales', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/locales')>()),
  TRANSLATED_LOCALES: ['en'],
}));

/**
 * The person's interface language (00549): their own profile row and the
 * cookie the server reads first. Languages with no messages file, and en-XA,
 * are staff's and live in the cookie only.
 */

const ME = 'user-1';
let signedIn = true;
let preview = false;
let stored: string | null = null;
let cookieJar: Record<string, string> = {};
let acceptLanguage: string | null = null;
let updates: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: ME } : null } }) },
    from: (table: string) => {
      expect(table).toBe('profiles');
      const chain = {
        select: () => chain,
        update: (row: Record<string, unknown>) => {
          updates.push(row);
          return chain;
        },
        eq: () => chain,
        maybeSingle: async () => ({ data: { ui_language: stored }, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/i18n/preview', () => ({ canPreviewLocales: async () => preview }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in cookieJar ? { value: cookieJar[name] } : undefined),
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  }),
  headers: async () => ({ get: () => acceptLanguage }),
}));

const { getUiLanguageState, setUiLanguage, setSignUpUiLanguage } = await import('./ui-language');

beforeEach(() => {
  signedIn = true;
  preview = false;
  stored = null;
  cookieJar = {};
  acceptLanguage = null;
  updates = [];
});

describe('getUiLanguageState', () => {
  it('offers a customer only the languages with a translation, Automatic on no pick', async () => {
    acceptLanguage = 'de,en;q=0.5';
    expect(await getUiLanguageState()).toEqual({
      selected: null,
      automatic: 'en',
      options: ['en'],
      preview: false,
    });
  });

  it('offers staff every language, Arabic too, and no test language', async () => {
    preview = true;
    const state = await getUiLanguageState();
    expect(state.options).toEqual([
      'en',
      'tr',
      'de',
      'fr',
      'es',
      'it',
      'pt-BR',
      'nl',
      'ja',
      'pl',
      'zh-CN',
      'ko',
      'ar',
    ]);
    expect(state.preview).toBe(true);
  });

  it('reads the pick from the cookie, or from the profile when the cookie is another person’s', async () => {
    cookieJar.ansvisor_ui_locale = 'en:user-1';
    expect((await getUiLanguageState()).selected).toBe('en');
    cookieJar.ansvisor_ui_locale = 'en:someone-else';
    stored = null;
    expect((await getUiLanguageState()).selected).toBeNull();
  });

  it('shows a pick the person may no longer have as Automatic', async () => {
    cookieJar.ansvisor_ui_locale = 'de:user-1';
    expect((await getUiLanguageState()).selected).toBeNull();
    preview = true;
    expect((await getUiLanguageState()).selected).toBe('de');
  });
});

describe('setUiLanguage', () => {
  it('saves a language on their own row and in the cookie', async () => {
    await setUiLanguage('en');
    expect(updates).toEqual([{ ui_language: 'en' }]);
    expect(cookieJar.ansvisor_ui_locale).toBe('en:user-1');
  });

  it('saves Automatic as no pick', async () => {
    await setUiLanguage(null);
    expect(updates).toEqual([{ ui_language: null }]);
    expect(cookieJar.ansvisor_ui_locale).toBe('auto:user-1');
  });

  it('refuses a language with no translation for a customer, and writes nothing', async () => {
    await expect(setUiLanguage('de')).rejects.toThrow('Unknown language');
    await expect(setUiLanguage('en-XA')).rejects.toThrow('Unknown language');
    await expect(setUiLanguage('ar')).rejects.toThrow('Unknown language');
    await expect(setUiLanguage('klingon' as never)).rejects.toThrow('Unknown language');
    expect(updates).toEqual([]);
    expect(cookieJar).toEqual({});
  });

  it('lets staff preview a language or en-XA in the cookie only, not on the profile', async () => {
    preview = true;
    await setUiLanguage('de');
    await setUiLanguage('en-XA');
    expect(updates).toEqual([]);
    expect(cookieJar.ansvisor_ui_locale).toBe('en-XA:user-1');
  });

  it('takes Arabic from staff, as any other language', async () => {
    preview = true;
    await expect(setUiLanguage('ar')).resolves.toBeUndefined();
  });

  it('refuses anyone signed out', async () => {
    signedIn = false;
    await expect(setUiLanguage('en')).rejects.toThrow('Unauthorized');
    await expect(getUiLanguageState()).rejects.toThrow('Unauthorized');
  });
});

describe('setSignUpUiLanguage', () => {
  it("keeps an offered language in the visitor's cookie, with no person's id, and writes nothing else", async () => {
    signedIn = false;
    await setSignUpUiLanguage('en');
    expect(cookieJar.ansvisor_ui_locale).toBe('en');
    expect(updates).toEqual([]);
  });

  it('refuses a language the page does not offer, or one that is none of ours', async () => {
    signedIn = false;
    await expect(setSignUpUiLanguage('de')).rejects.toThrow('Unknown language');
    await expect(setSignUpUiLanguage('en-XA')).rejects.toThrow('Unknown language');
    await expect(setSignUpUiLanguage('xx' as never)).rejects.toThrow('Unknown language');
    await expect(setSignUpUiLanguage({ toString: () => 'en' } as never)).rejects.toThrow(
      'Unknown language',
    );
    expect(cookieJar).toEqual({});
  });

  it('takes any selectable language where previews are on, Arabic too, never the test language', async () => {
    preview = true;
    await setSignUpUiLanguage('de');
    expect(cookieJar.ansvisor_ui_locale).toBe('de');
    await setSignUpUiLanguage('ar');
    expect(cookieJar.ansvisor_ui_locale).toBe('ar');
    await expect(setSignUpUiLanguage('en-XA')).rejects.toThrow('Unknown language');
  });
});
