import { beforeEach, describe, expect, it, vi } from 'vitest';
import english from '../../../messages/en.json';

/**
 * Approval cards' cost lines in the person's language: their profile's pick,
 * English for no pick, an unknown one or a failed read, and English for a
 * line the language has no text for yet.
 */

const profile = vi.hoisted(() => ({
  row: null as { ui_language: unknown } | null,
  fail: false,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (profile.fail) throw new Error('down');
            return { data: profile.row, error: null };
          },
        }),
      }),
    }),
  },
}));

vi.mock('@/i18n/messages', () => ({
  loadMessages: async (locale: string) =>
    locale === 'de'
      ? {
          ...english,
          chatEngine: {
            ...english.chatEngine,
            costs: {
              ...english.chatEngine.costs,
              siteAudit:
                '{count, plural, one {Nutzt # Audit} other {Nutzt # Audits}} von {left} übrigen in diesem Monat',
            },
          },
        }
      : english,
}));

const { cardLocaleOf, costLinesFor } = await import('./card-locale');

describe('cardLocaleOf', () => {
  beforeEach(() => {
    profile.row = null;
    profile.fail = false;
  });

  it("reads the person's interface language", async () => {
    profile.row = { ui_language: 'de' };
    expect(await cardLocaleOf('user-1')).toBe('de');
  });

  it('is English with no pick, an unknown pick or a failed read', async () => {
    expect(await cardLocaleOf('user-1')).toBe('en');
    profile.row = { ui_language: 'xx' };
    expect(await cardLocaleOf('user-1')).toBe('en');
    profile.fail = true;
    expect(await cardLocaleOf('user-1')).toBe('en');
  });
});

describe('costLinesFor', () => {
  it('writes the line in the language', async () => {
    const line = await costLinesFor('de');
    expect(line('siteAudit', { count: 2, left: 8 })).toBe(
      'Nutzt 2 Audits von 8 übrigen in diesem Monat',
    );
  });

  it('falls back to English where the language has no text', async () => {
    const line = await costLinesFor('de');
    expect(line('siteAuditUnknown', { count: 1 })).toBe("Uses 1 of this month's audits");
  });

  it('is English by default', async () => {
    const line = await costLinesFor();
    expect(line('siteAudit', { count: 1, left: 4 })).toBe('Uses 1 audit of 4 left this month');
  });
});
