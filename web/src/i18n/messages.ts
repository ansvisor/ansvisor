import { pseudoLocalize } from './pseudo';
import { PSEUDO_LOCALE, type AnyUiLocale } from './locales';

export type Messages = { [key: string]: Messages | string };

const isTree = (value: unknown): value is Messages =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `base` with everything `over` has on top: a key `over` lacks, or has empty
 * or of another kind, keeps the base's text, so a half-translated language
 * shows English where it has no text yet and never a raw key. Keys only
 * `over` has (one since removed from English) are dropped.
 */
export function mergeMessages(base: Messages, over: unknown): Messages {
  if (!isTree(over)) return base;
  const out: Messages = {};
  for (const [key, value] of Object.entries(base)) {
    const next = over[key];
    if (isTree(value)) out[key] = mergeMessages(value, next);
    else out[key] = typeof next === 'string' && next !== '' ? next : value;
  }
  return out;
}

async function readFile(locale: string): Promise<unknown> {
  try {
    return (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // No file for the language (yet): English shows.
    return null;
  }
}

/**
 * The messages for a language: English, with the language's own file on top
 * of it where it has one, and for the staff test language en-XA, English made
 * longer at runtime (never a file).
 */
export async function loadMessages(locale: AnyUiLocale): Promise<Messages> {
  const english = (await readFile('en')) as Messages;
  if (locale === 'en') return english;
  if (locale === PSEUDO_LOCALE) return pseudoLocalize(english);
  return mergeMessages(english, await readFile(locale));
}
