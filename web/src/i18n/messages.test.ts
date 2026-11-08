import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Keys an object in a JSON text names twice, as "path.key". JSON.parse
 * keeps the last one silently, so a repeated key in messages/en.json
 * hides whichever copy came first. The text must be valid JSON.
 */
function duplicateKeys(text: string): string[] {
  const found: string[] = [];
  let i = 0;
  const skipSpace = () => {
    while (/\s/.test(text[i] ?? '')) i += 1;
  };
  const readString = () => {
    const start = i;
    i += 1;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i += 1;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const readValue = (path: string): void => {
    skipSpace();
    const c = text[i];
    if (c === '{') {
      i += 1;
      const keys = new Set<string>();
      skipSpace();
      while (text[i] !== '}') {
        skipSpace();
        const key = readString();
        if (keys.has(key)) found.push(`${path}${key}`);
        keys.add(key);
        skipSpace();
        i += 1; // ':'
        readValue(`${path}${key}.`);
        skipSpace();
        if (text[i] === ',') i += 1;
        skipSpace();
      }
      i += 1;
    } else if (c === '[') {
      i += 1;
      skipSpace();
      while (text[i] !== ']') {
        readValue(path);
        skipSpace();
        if (text[i] === ',') i += 1;
        skipSpace();
      }
      i += 1;
    } else if (c === '"') {
      readString();
    } else {
      while (i < text.length && !/[,}\]\s]/.test(text[i])) i += 1;
    }
  };
  readValue('');
  return found;
}

describe('messages/en.json', () => {
  it('names no key twice in one object', () => {
    const text = readFileSync(join(__dirname, '../../messages/en.json'), 'utf8');
    expect(duplicateKeys(text)).toEqual([]);
  });

  it('finds a repeated key, and only within one object', () => {
    expect(
      duplicateKeys(
        '{"a": {"x": 1, "y": {"x": "\\"q\\""}, "x": [true, null]}, "b": [{"k": 1}, {"k": 2}]}',
      ),
    ).toEqual(['a.x']);
  });
});
