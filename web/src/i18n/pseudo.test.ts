// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';
import {
  PSEUDO_CLOSE,
  PSEUDO_EXPANSION,
  PSEUDO_OPEN,
  pseudoLocalize,
  pseudoLocalizeMessage,
} from './pseudo';

/** The arguments, tags and plural branches a message has, in order, with the words left out. */
function skeleton(elements: MessageFormatElement[]): unknown[] {
  return elements.flatMap((el): unknown[] => {
    switch (el.type) {
      case TYPE.literal:
        return [];
      case TYPE.argument:
        return [['arg', el.value]];
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        return [[el.type, el.value, typeof el.style === 'string' ? el.style : null]];
      case TYPE.pound:
        return [['#']];
      case TYPE.tag:
        return [['tag', el.value, skeleton(el.children)]];
      case TYPE.plural:
      case TYPE.select:
        return [
          [
            el.type,
            el.value,
            Object.keys(el.options).map((key) => [key, skeleton(el.options[key].value)]),
          ],
        ];
    }
  });
}

const parsed = (message: string) => skeleton(parse(message));
const letters = (text: string) => text.replace(/[^\p{L}]/gu, '').length;

describe('pseudo-locale', () => {
  it('wraps a message, accents its words and makes it longer', () => {
    const out = pseudoLocalizeMessage('Account Center');
    expect(out.startsWith(PSEUDO_OPEN)).toBe(true);
    expect(out.endsWith(PSEUDO_CLOSE)).toBe(true);
    const body = out.slice(PSEUDO_OPEN.length, -PSEUDO_CLOSE.length);
    expect(body).not.toMatch(/[A-Za-z]/);
    expect(body).toContain('Ç');
    expect(letters(body)).toBeGreaterThanOrEqual(Math.round(letters('Account Center') * 1.3));
  });

  it('adds about a third to longer text', () => {
    const text = 'Your prompts are tracked in ChatGPT, Gemini and Perplexity every day';
    const out = pseudoLocalizeMessage(text);
    const ratio = letters(out.slice(PSEUDO_OPEN.length, -PSEUDO_CLOSE.length)) / letters(text);
    expect(ratio).toBeGreaterThan(1 + PSEUDO_EXPANSION - 0.03);
    expect(ratio).toBeLessThan(1 + PSEUDO_EXPANSION + 0.03);
  });

  it('keeps {placeholders}, numbers and dates untouched', () => {
    const out = pseudoLocalizeMessage(
      'Hello {name}, you have {count, number} items on {day, date, short}',
    );
    expect(out).toContain('{name}');
    expect(out).toContain('{count, number}');
    expect(out).toContain('{day, date, short}');
    expect(out).not.toContain('Hello');
  });

  it('keeps plural and select syntax and accents only their branches', () => {
    const message =
      '{count, plural, =0 {No prompts} one {# prompt} other {# prompts}} for {kind, select, a {apples} other {others}}';
    const out = pseudoLocalizeMessage(message);
    expect(out).toContain('{count, plural, =0 {');
    expect(out).toContain('one {# ');
    expect(out).toContain('other {# ');
    expect(out).toContain('{kind, select, a {');
    expect(out).not.toMatch(/prompt|apples|others/);
    expect(parsed(out.slice(PSEUDO_OPEN.length, -PSEUDO_CLOSE.length))).toEqual(parsed(message));
  });

  it('keeps tags and quoted text', () => {
    const message = "Read <b>the guide</b> or <link>open it</link>. It''s '{literal}' here <br/>";
    const out = pseudoLocalizeMessage(message);
    expect(out).toContain('<b>');
    expect(out).toContain('</b>');
    expect(out).toContain('<link>');
    expect(out).toContain('<br/>');
    expect(out).toContain("''");
    expect(out).toContain("'{literal}'");
    expect(parsed(out.slice(PSEUDO_OPEN.length, -PSEUDO_CLOSE.length))).toEqual(parsed(message));
  });

  it('keeps the shape of a messages tree and leaves non-text alone', () => {
    expect(pseudoLocalize({ a: { b: 'Save' }, list: ['One', 'Two'], n: 3, no: null })).toEqual({
      a: { b: pseudoLocalizeMessage('Save') },
      list: [pseudoLocalizeMessage('One'), pseudoLocalizeMessage('Two')],
      n: 3,
      no: null,
    });
  });

  it('leaves every message of en.json with the same arguments, tags and branches', () => {
    const english = JSON.parse(readFileSync(join(__dirname, '../../messages/en.json'), 'utf8'));
    const bad: string[] = [];
    let checked = 0;
    const walk = (value: unknown, path: string) => {
      if (typeof value === 'string') {
        checked += 1;
        let before: unknown[];
        try {
          before = parsed(value);
        } catch {
          return; // not an ICU message in the first place
        }
        const out = pseudoLocalizeMessage(value);
        let after: unknown[] | null = null;
        try {
          after = parsed(out);
        } catch {
          after = null;
        }
        if (JSON.stringify(after) !== JSON.stringify(before)) bad.push(path);
      } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      }
    };
    walk(english, '');
    expect(checked).toBeGreaterThan(1000);
    expect(bad).toEqual([]);
  });
});
