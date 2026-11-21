// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cleanSuggestion, findMessageKey } from './translation-suggestions';

const base = {
  locale: 'de',
  path: '/dashboard/prompts?tab=x#top',
  currentText: '  Neue   Eingabe ',
  suggestion: 'Neuer Prompt',
  note: ' klingt besser ',
};

describe('cleanSuggestion', () => {
  it('keeps the texts squashed, the note trimmed and the screen without query or hash', () => {
    expect(cleanSuggestion(base)).toEqual({
      ok: true,
      value: {
        locale: 'de',
        path: '/dashboard/prompts',
        currentText: 'Neue Eingabe',
        suggestion: 'Neuer Prompt',
        note: 'klingt besser',
      },
    });
  });

  it('takes a language with a region, and no note', () => {
    const result = cleanSuggestion({ ...base, locale: 'pt-BR', note: undefined });
    expect(result.ok && result.value.note).toBe('');
  });

  it('refuses English, the test language and junk as the language', () => {
    for (const locale of ['en', 'en-XA', '', 'x', 'de/../']) {
      expect(cleanSuggestion({ ...base, locale })).toEqual({ ok: false, problem: 'locale' });
    }
  });

  it('refuses empty, unchanged and too long texts', () => {
    expect(cleanSuggestion({ ...base, currentText: '   ' })).toEqual({
      ok: false,
      problem: 'currentText',
    });
    expect(cleanSuggestion({ ...base, suggestion: '' })).toEqual({
      ok: false,
      problem: 'suggestion',
    });
    expect(cleanSuggestion({ ...base, suggestion: 'Neue Eingabe' })).toEqual({
      ok: false,
      problem: 'same',
    });
    expect(cleanSuggestion({ ...base, suggestion: 'x'.repeat(1001) })).toEqual({
      ok: false,
      problem: 'tooLong',
    });
    expect(cleanSuggestion({ ...base, note: 'x'.repeat(1001) })).toEqual({
      ok: false,
      problem: 'tooLong',
    });
  });
});

describe('findMessageKey', () => {
  const messages = {
    a: { title: 'Sprache', hint: 'Bildschirm' },
    b: { title: 'Sprache' },
    c: 'Ein',
  };

  it('finds the key of a text only one message has', () => {
    expect(findMessageKey(messages, ' Bildschirm ')).toBe('a.hint');
    expect(findMessageKey(messages, 'Ein')).toBe('c');
  });

  it('gives null for a text two messages share or none has', () => {
    expect(findMessageKey(messages, 'Sprache')).toBeNull();
    expect(findMessageKey(messages, 'Nirgends')).toBeNull();
    expect(findMessageKey(messages, '')).toBeNull();
  });
});
