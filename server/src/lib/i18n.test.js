import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * E-mail words in each person's language (LOC-008): English is the master
 * file; another language's file overlays it, and any key it lacks (or any
 * language with no file) reads English, never a raw key.
 */

const db = vi.hoisted(() => ({ rows: [], error: null, emails: {} }));
vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => ({
      select: () => ({
        in: async (_col, ids) =>
          db.error
            ? { data: null, error: db.error }
            : { data: db.rows.filter((row) => ids.includes(row.id)), error: null },
        // A workspace's members with a language set (uiLanguagesOfAddresses).
        eq: (_col, orgId) => ({
          not: async () =>
            db.error
              ? { data: null, error: db.error }
              : {
                  data: db.rows.filter((row) => row.org === orgId && row.ui_language != null),
                  error: null,
                },
        }),
      }),
    }),
    auth: {
      admin: {
        getUserById: async (id) => ({
          data: { user: db.emails[id] ? { email: db.emails[id] } : null },
        }),
      },
    },
  },
}));
vi.mock('./logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const {
  DEFAULT_LOCALE,
  addressesByLanguage,
  forgetMessages,
  formatNumberIn,
  formatPercentIn,
  formatLocale,
  formatMessage,
  mergeMessages,
  resolveLocale,
  translate,
  uiLanguageOf,
  uiLanguagesOf,
} = await import('./i18n.js');

const messagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../messages');
const written = [];
/** A throwaway language file next to English, removed after each test. */
function addLanguage(code, tree) {
  const file = path.join(messagesDir, `${code}.json`);
  fs.writeFileSync(file, JSON.stringify(tree));
  written.push(file);
  forgetMessages();
}

beforeEach(() => {
  db.rows = [];
  db.error = null;
  db.emails = {};
  forgetMessages();
});
afterEach(() => {
  for (const file of written.splice(0)) fs.rmSync(file, { force: true });
  forgetMessages();
});

describe('formatMessage', () => {
  it('fills placeholders and leaves unknown ones as written', () => {
    expect(formatMessage('Hi {name}, {other}', { name: 'Ana' })).toBe('Hi Ana, {other}');
  });

  it('chooses a plural branch by the count, with # as the number', () => {
    const text = '{n, plural, one {# page} other {# pages}} audited';
    expect(formatMessage(text, { n: 1 })).toBe('1 page audited');
    expect(formatMessage(text, { n: 25 })).toBe('25 pages audited');
    expect(formatMessage('{n, plural, =0 {none} other {# left}}', { n: 0 })).toBe('none');
  });

  it('keeps an apostrophe inside a branch and fills a placeholder in it', () => {
    expect(
      formatMessage("{n, plural, one {# page couldn't} other {# pages couldn't}} for {who}", {
        n: 2,
        who: 'Acme',
      }),
    ).toBe("2 pages couldn't for Acme");
  });
});

describe('languages', () => {
  it('resolves a stored code to a file, else its language, else English', () => {
    addLanguage('pt-BR', {});
    addLanguage('de', {});
    expect(resolveLocale('pt-br')).toBe('pt-BR');
    expect(resolveLocale('de-AT')).toBe('de');
    expect(resolveLocale('xx')).toBe(DEFAULT_LOCALE);
    // The staff test language and nothing set are English.
    expect(resolveLocale('en-XA')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
  });

  it('uses the language file where it has the text, and English where it has none', () => {
    addLanguage('de', { firstResults: { title: 'Ihre ersten Ergebnisse sind da' } });
    expect(translate('de', 'firstResults.title')).toBe('Ihre ersten Ergebnisse sind da');
    expect(translate('de', 'firstResults.button')).toBe('See your results');
    // A language with no file at all reads English too.
    expect(translate('ko', 'firstResults.button')).toBe('See your results');
  });

  it('gives the key itself for a key that does not exist', () => {
    expect(translate('en', 'nope.missing')).toBe('nope.missing');
  });

  it('merges only strings: an empty translation keeps English', () => {
    expect(mergeMessages({ a: 'x', b: { c: 'y' } }, { a: '', b: { c: 'z' }, gone: 'q' })).toEqual({
      a: 'x',
      b: { c: 'z' },
    });
  });

  it('formats numbers and dates by language, English staying en-US', () => {
    addLanguage('de', {});
    expect(formatLocale('en')).toBe('en-US');
    expect(formatLocale('de')).toBe('de');
  });

  it('formats a plural in the language of the file (Intl plural rules)', () => {
    addLanguage('pl', {
      autoAudit: { summary: '{pages, plural, one {# strona} few {# strony} other {# stron}}' },
    });
    expect(translate('pl', 'autoAudit.summary', { pages: 1, issues: 0 })).toBe('1 strona');
    expect(translate('pl', 'autoAudit.summary', { pages: 3, issues: 0 })).toBe('3 strony');
    expect(translate('pl', 'autoAudit.summary', { pages: 5, issues: 0 })).toBe('5 stron');
  });
});

describe('uiLanguagesOf', () => {
  it("reads each person's own language, English when none is set", async () => {
    addLanguage('de', {});
    db.rows = [
      { id: 'u1', ui_language: 'de' },
      { id: 'u2', ui_language: null },
    ];
    const map = await uiLanguagesOf(['u1', 'u2', 'u3']);
    expect([...map]).toEqual([
      ['u1', 'de'],
      ['u2', 'en'],
      ['u3', 'en'],
    ]);
    expect(await uiLanguageOf('u1')).toBe('de');
  });

  it('never holds an e-mail back: a failed read is English', async () => {
    db.error = { message: 'down' };
    expect([...(await uiLanguagesOf(['u1']))]).toEqual([['u1', 'en']]);
  });
});

describe('addressesByLanguage', () => {
  it('groups a list of addresses by the language of the member each one is', async () => {
    addLanguage('de', {});
    db.rows = [
      { id: 'u1', org: 'org-1', ui_language: 'de' },
      { id: 'u2', org: 'org-1', ui_language: 'en' },
      { id: 'u9', org: 'org-2', ui_language: 'de' },
    ];
    db.emails = { u1: 'Ana@Acme.test', u2: 'bo@acme.test', u9: 'cy@other.test' };
    expect(
      await addressesByLanguage('org-1', [
        'ana@acme.test',
        'bo@acme.test',
        'client@else.test',
        'cy@other.test',
      ]),
    ).toEqual([
      ['de', ['ana@acme.test']],
      ['en', ['bo@acme.test', 'client@else.test', 'cy@other.test']],
    ]);
  });

  it('sends everything in English when the languages cannot be read', async () => {
    db.error = { message: 'down' };
    expect(await addressesByLanguage('org-1', ['a@acme.test', 'b@acme.test'])).toEqual([
      ['en', ['a@acme.test', 'b@acme.test']],
    ]);
  });
});

describe('number formats', () => {
  it('writes numbers and percentages as the language does, English as before', () => {
    addLanguage('de', {});
    expect(formatNumberIn('en', 1234.5)).toBe('1,234.5');
    expect(formatNumberIn('de', 1234.5)).toBe('1.234,5');
    expect(formatPercentIn('en', 12.5)).toBe('12.5%');
    expect(formatPercentIn('de', 12.5)).toBe('12,5 %');
  });
});

describe('the files', () => {
  it('every language file has only keys that English has, and the same placeholders', () => {
    const english = JSON.parse(fs.readFileSync(path.join(messagesDir, 'en.json'), 'utf8'));
    const flat = (tree, prefix = '') =>
      Object.entries(tree).flatMap(([key, value]) =>
        typeof value === 'string' ? [[`${prefix}${key}`, value]] : flat(value, `${prefix}${key}.`),
      );
    const names = (text) => [...text.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    const master = new Map(flat(english));
    for (const name of fs.readdirSync(messagesDir).filter((n) => n.endsWith('.json'))) {
      if (name === 'en.json') continue;
      const tree = JSON.parse(fs.readFileSync(path.join(messagesDir, name), 'utf8'));
      for (const [key, text] of flat(tree)) {
        expect(master.has(key), `${name}: ${key}`).toBe(true);
        expect(names(text), `${name}: ${key}`).toEqual(names(master.get(key)));
      }
    }
  });
});
