// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Suggest a better translation" (LOC-009), the sending side: checked, kept
 * as the person on their own organization, one plan check first.
 */

const ME = 'user-1';
let signedIn = true;
let org: string | null = 'org-1';
let sentToday = 0;
let insertError: { message: string } | null = null;
let inserted: Record<string, unknown>[] = [];
const order: string[] = [];

vi.mock('@/lib/subscription-guard', () => ({
  assertWritable: async () => {
    order.push('assertWritable');
  },
}));
vi.mock('@/i18n/messages', () => ({
  loadMessages: async () => ({ settings: { language: { label: 'Sprache' } } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: ME } : null } }) },
    from: (table: string) => {
      expect(table === 'profiles' || table === 'translation_suggestions').toBe(true);
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: async () => ({ count: sentToday }),
        maybeSingle: async () => ({
          data: org ? { organization_id: org } : null,
          error: null,
        }),
        insert: async () => {
          throw new Error('the signed-in client has no insert: the service role adds it');
        },
      };
      return chain;
    },
  }),
}));
// The row is added with the service role, only after the checks (00555 has no insert policy).
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      expect(table).toBe('translation_suggestions');
      return {
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: insertError };
        },
      };
    },
  },
}));

const { submitTranslationSuggestion } = await import('./translation-suggestions');

const input = {
  locale: 'de',
  path: '/dashboard/settings/account',
  currentText: 'Sprache',
  suggestion: 'Anzeigesprache',
};

beforeEach(() => {
  signedIn = true;
  org = 'org-1';
  sentToday = 0;
  insertError = null;
  inserted = [];
  order.length = 0;
});

describe('submitTranslationSuggestion', () => {
  it('checks the plan first, then keeps the suggestion as the person with the key it found', async () => {
    expect(await submitTranslationSuggestion(input)).toEqual({ ok: true });
    expect(order).toEqual(['assertWritable']);
    expect(inserted).toEqual([
      {
        organization_id: 'org-1',
        user_id: ME,
        locale: 'de',
        path: '/dashboard/settings/account',
        message_key: 'settings.language.label',
        current_text: 'Sprache',
        suggestion: 'Anzeigesprache',
        note: '',
      },
    ]);
  });

  it('keeps a text it finds no key for, with no key', async () => {
    await submitTranslationSuggestion({ ...input, currentText: 'Etwas anderes' });
    expect(inserted[0].message_key).toBeNull();
  });

  it('refuses what the check refuses, and writes nothing', async () => {
    expect(await submitTranslationSuggestion({ ...input, locale: 'en' })).toEqual({
      ok: false,
      error: 'locale',
    });
    expect(await submitTranslationSuggestion({ ...input, suggestion: 'Sprache' })).toEqual({
      ok: false,
      error: 'same',
    });
    expect(inserted).toEqual([]);
  });

  it('stops after the daily limit', async () => {
    sentToday = 20;
    expect(await submitTranslationSuggestion(input)).toEqual({ ok: false, error: 'tooMany' });
    expect(inserted).toEqual([]);
  });

  it('says server when the organization or the write fails, and refuses no one signed in', async () => {
    org = null;
    expect(await submitTranslationSuggestion(input)).toEqual({ ok: false, error: 'server' });
    org = 'org-1';
    insertError = { message: 'boom' };
    expect(await submitTranslationSuggestion(input)).toEqual({ ok: false, error: 'server' });
    signedIn = false;
    await expect(submitTranslationSuggestion(input)).rejects.toThrow('Unauthorized');
  });
});
