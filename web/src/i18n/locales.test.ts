// @vitest-environment node
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCALES,
  LOCALE_NAMES,
  PSEUDO_LOCALE,
  TRANSLATED_LOCALES,
  matchBrowserLocale,
  normalizeLocale,
} from './locales';
import { loadMessages, mergeMessages } from './messages';
import { pseudoLocalize } from './pseudo';
import english from '../../messages/en.json';

describe('the interface languages', () => {
  it('are English plus the nine of waves 1 and 2, each with its own name', () => {
    expect([...LOCALES]).toEqual(['en', 'tr', 'de', 'fr', 'es', 'it', 'pt-BR', 'nl', 'ja', 'pl']);
    expect(LOCALE_NAMES.tr).toBe('Türkçe');
    expect(LOCALE_NAMES.de).toBe('Deutsch');
    expect(Object.keys(LOCALE_NAMES).sort()).toEqual([...LOCALES, PSEUDO_LOCALE].sort());
  });

  it('offer exactly the languages that have a messages file', () => {
    const files = readdirSync(join(__dirname, '../../messages'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''))
      .sort();
    expect([...TRANSLATED_LOCALES].sort()).toEqual(files);
    // The test language is never a file.
    expect(files).not.toContain(PSEUDO_LOCALE);
  });

  it('read a code however it is cased', () => {
    expect(normalizeLocale('pt-br')).toBe('pt-BR');
    expect(normalizeLocale('EN-xa')).toBe('en-XA');
    expect(normalizeLocale('xx')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
  });
});

describe('matching the browser’s language', () => {
  const offered = ['en', 'de', 'pt-BR', 'tr'] as const;
  it('takes the first language in the header’s own order that we have', () => {
    expect(matchBrowserLocale('fr-FR,de;q=0.8,en;q=0.5', offered)).toBe('de');
    expect(matchBrowserLocale('en;q=0.4, tr;q=0.9', offered)).toBe('tr');
  });
  it('matches a region to its language, and an exact region first', () => {
    expect(matchBrowserLocale('de-AT', offered)).toBe('de');
    expect(matchBrowserLocale('pt-PT', offered)).toBe('pt-BR');
    expect(matchBrowserLocale('pt-BR', offered)).toBe('pt-BR');
  });
  it('gives null for a language we lack, a refused one or no header', () => {
    expect(matchBrowserLocale('fr,ja', offered)).toBeNull();
    expect(matchBrowserLocale('de;q=0', offered)).toBeNull();
    expect(matchBrowserLocale('*', offered)).toBeNull();
    expect(matchBrowserLocale(null, offered)).toBeNull();
  });
});

describe('messages, with English as the fallback', () => {
  it('shows English for a language that has no messages file, never a raw key', async () => {
    expect(await loadMessages('de')).toEqual(english);
    expect(await loadMessages('ja')).toEqual(english);
  });

  it('keeps English where a language lacks a key, or has it empty', () => {
    const base = { a: { x: 'One', y: 'Two' }, b: 'Three', c: { z: 'Four' } };
    const over = { a: { x: 'Eins' }, b: '', extra: 'gone', c: 'not a tree' };
    expect(mergeMessages(base, over)).toEqual({
      a: { x: 'Eins', y: 'Two' },
      b: 'Three',
      c: { z: 'Four' },
    });
    expect(mergeMessages(base, null)).toEqual(base);
  });

  it('makes the test language from English at runtime', async () => {
    const pseudo = (await loadMessages(PSEUDO_LOCALE)) as typeof english;
    expect(pseudo).toEqual(pseudoLocalize(english));
    expect(pseudo.accountMenu.signOut).toMatch(/^\[!! .* !!\]$/);
    expect(pseudo.accountMenu.signOut).not.toBe(english.accountMenu.signOut);
  });
});
