import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A 'use server' file may export async functions only. Anything else (a
 * constant, a plain function, an object) builds, but at run time the module
 * throws when it loads, and every Server Action bundled with it fails: a
 * constant exported from lib/actions/menu-state.ts broke every page's data
 * reads in production. Types and interfaces are fine: they are erased.
 */

const SRC = join(__dirname, '..');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const BAD_EXPORT = /^export\s+(?:const|let|var|class|enum|function\s|default\s+(?!async)|\{)/m;

describe("'use server' files", () => {
  it('export async functions only', () => {
    const offenders = filesUnder(SRC)
      .filter((path) => {
        const text = readFileSync(path, 'utf8');
        return /^\s*['"]use server['"]/.test(text) && BAD_EXPORT.test(text);
      })
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});
