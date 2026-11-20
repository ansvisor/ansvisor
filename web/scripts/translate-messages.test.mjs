import { describe, expect, it } from 'vitest';
import {
  cachedTranslation,
  emptyCache,
  flatten,
  hashText,
  icuSignature,
  makeBatches,
  parseJsonReply,
  pendingEntries,
  pruneCache,
  sampleEntries,
  storeTranslation,
  unflatten,
  validateTranslation,
} from './translate-messages-lib.mjs';

describe('validateTranslation', () => {
  it('accepts plain text and simple placeholders', () => {
    expect(validateTranslation('Save changes', 'Değişiklikleri kaydet')).toEqual([]);
    expect(validateTranslation('Hello {name}', '{name}, merhaba')).toEqual([]);
  });

  it('flags a missing, renamed or extra placeholder', () => {
    expect(validateTranslation('Hello {name}', 'Merhaba')).toEqual([
      expect.stringContaining('missing placeholders'),
    ]);
    expect(validateTranslation('Hello {name}', 'Merhaba {isim}').join()).toMatch(
      /missing.*unexpected/,
    );
  });

  it('allows other plural categories but needs other and the same argument', () => {
    const en = '{count, plural, one {# prompt} other {# prompts}}';
    expect(
      validateTranslation(
        en,
        '{count, plural, few {# prompty} many {# promptów} other {# promptu}}',
      ),
    ).toEqual([]);
    expect(validateTranslation(en, '{count, plural, one {# prompt}}')).toEqual(
      expect.arrayContaining([expect.stringContaining('other')]),
    );
    expect(validateTranslation(en, '{n, plural, other {# prompt}}').length).toBeGreaterThan(0);
  });

  it('checks select options and nested plurals', () => {
    const en =
      '{d, select, once {first month} repeating {first {m, plural, one {month} other {# months}}} other {every month}}';
    expect(
      validateTranslation(
        en,
        '{d, select, once {ilk ay} repeating {ilk {m, plural, one {ay} other {# ay}}} other {her ay}}',
      ),
    ).toEqual([]);
    expect(
      validateTranslation(en, '{d, select, once {ilk ay} other {her ay}}').length,
    ).toBeGreaterThan(0);
  });

  it('keeps rich-text tags', () => {
    const en = 'Read the <link>guide</link> or <b>skip</b>';
    expect(validateTranslation(en, 'Rehbere <link>göz atın</link> veya <b>atlayın</b>')).toEqual(
      [],
    );
    expect(validateTranslation(en, 'Rehbere <a>göz atın</a> veya <b>atlayın</b>').join()).toMatch(
      /tags differ/,
    );
    expect(validateTranslation(en, 'Rehbere <link>göz atın veya atlayın').length).toBeGreaterThan(
      0,
    );
  });

  it('catches broken ICU syntax', () => {
    expect(validateTranslation('Hi {name}', 'Merhaba {name').length).toBeGreaterThan(0);
    expect(validateTranslation('Hi {name}', 'Merhaba {name}}').join()).toMatch(/syntax/);
  });

  it('treats an apostrophe inside text as literal but quoting as quoting', () => {
    expect(validateTranslation('Your Prompts', "Prompt'larınız")).toEqual([]);
    expect(validateTranslation('Use {x}', "Kullan '{x}'").length).toBeGreaterThan(0);
  });

  it('rejects empty output, runaway length and a dropped enforced term', () => {
    expect(validateTranslation('Save', '  ')).toEqual(['empty translation']);
    expect(validateTranslation('Save', 'x'.repeat(200)).join()).toMatch(/longer/);
    expect(
      validateTranslation('Welcome to Ansvisor', 'Hoş geldiniz', {
        enforceKeep: ['Ansvisor'],
      }).join(),
    ).toMatch(/Ansvisor/);
  });

  it('parses a signature', () => {
    const sig = icuSignature('{n, number} <b>x</b> {a}');
    expect([...sig.args].sort()).toEqual(['a:', 'n:number']);
    expect([...sig.tags].sort()).toEqual(['/b', 'b']);
  });
});

describe('cache', () => {
  const entries = [
    ['a.one', 'One'],
    ['a.two', 'Two'],
    ['b.0', 'Zero'],
  ];

  it('only asks for new or changed keys', () => {
    const cache = emptyCache();
    expect(pendingEntries(entries, cache)).toHaveLength(3);
    storeTranslation(cache, 'a.one', 'One', 'Bir');
    storeTranslation(cache, 'a.two', 'Two', 'İki');
    expect(pendingEntries(entries, cache).map((e) => e[0])).toEqual(['b.0']);
    // the English text changed: the cached entry no longer counts
    const changed = [['a.one', 'One!'], ...entries.slice(1)];
    expect(pendingEntries(changed, cache).map((e) => e[0])).toEqual(['a.one', 'b.0']);
    expect(cachedTranslation(cache, 'a.two', 'Two')).toBe('İki');
    expect(cache.entries['a.one'].h).toBe(hashText('One'));
  });

  it('prunes keys that left the source', () => {
    const cache = emptyCache();
    storeTranslation(cache, 'gone', 'x', 'y');
    storeTranslation(cache, 'a.one', 'One', 'Bir');
    pruneCache(cache, entries);
    expect(Object.keys(cache.entries)).toEqual(['a.one']);
  });
});

describe('structure helpers', () => {
  const tree = { a: { one: 'One', list: ['x', 'y'] }, b: 'B' };

  it('flattens and rebuilds with the same shape, falling back to English', () => {
    const flat = flatten(tree);
    expect(flat).toEqual([
      ['a.one', 'One'],
      ['a.list.0', 'x'],
      ['a.list.1', 'y'],
      ['b', 'B'],
    ]);
    expect(unflatten(tree, { 'a.one': 'Bir', 'a.list.1': 'Y!' })).toEqual({
      a: { one: 'Bir', list: ['x', 'Y!'] },
      b: 'B',
    });
  });

  it('batches by key count and size, and samples evenly', () => {
    const many = Array.from({ length: 10 }, (_, i) => [`k${i}`, 'x'.repeat(10)]);
    expect(makeBatches(many, { maxKeys: 4 }).map((b) => b.length)).toEqual([4, 4, 2]);
    expect(makeBatches(many, { maxKeys: 100, maxChars: 35 }).map((b) => b.length)).toEqual([
      3, 3, 3, 1,
    ]);
    expect(sampleEntries(many, 5).map((e) => e[0])).toEqual(['k0', 'k2', 'k4', 'k6', 'k8']);
  });

  it('reads JSON out of a fenced or chatty reply', () => {
    expect(parseJsonReply('```json\n{"k1":"a"}\n```')).toEqual({ k1: 'a' });
    expect(parseJsonReply('Here you go: {"k1":"a"} done')).toEqual({ k1: 'a' });
    expect(() => parseJsonReply('nope')).toThrow();
  });
});
