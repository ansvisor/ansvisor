import { AsyncLocalStorage } from 'node:async_hooks';
import { createTranslator } from 'next-intl';
import { DEFAULT_LOCALE, type UiLocale } from '@/i18n/locales';
import { loadMessages, type Messages } from '@/i18n/messages';

/**
 * The language Chat writes in for the person whose work it does (their
 * profile's pick, card-locale.ts cardLocaleOf): their run's steps, cards,
 * notices and refusals. What a model reads, or other code compares, stays
 * English (inEnglish). Server only.
 */

/** A translator over a namespace of the messages: a key and its values, its text. */
export type ChatWords = (key: string, values?: Record<string, string | number | Date>) => string;

const translators = new Map<string, Promise<ChatWords>>();

/**
 * A namespace's texts in a language, English where it has no text yet;
 * made once a language and namespace.
 */
export function chatTranslator(
  locale: UiLocale = DEFAULT_LOCALE,
  namespace: string,
): Promise<ChatWords> {
  const at = `${locale}:${namespace}`;
  let words = translators.get(at);
  if (!words) {
    words = loadMessages(locale).then((messages) => {
      const t = createTranslator({ locale, messages, namespace } as never) as unknown as ChatWords;
      return (key, values) => t(key, values);
    });
    translators.set(at, words);
  }
  return words;
}

const runScope = new AsyncLocalStorage<{ locale: UiLocale; messages: Messages | null }>();

/** The language the work being done is written in for its person: English outside a run. */
export function runLocale(): UiLocale {
  return runScope.getStore()?.locale ?? DEFAULT_LOCALE;
}

/**
 * Runs `fn` with every inRunLocale translator inside it writing in `locale`:
 * a Chat run, or a request, for its person. Its messages are read first,
 * once, so the translators stay synchronous; a failed read is English.
 */
export async function withRunLocale<T>(locale: UiLocale, fn: () => Promise<T>): Promise<T> {
  const messages = locale === DEFAULT_LOCALE ? null : await loadMessages(locale).catch(() => null);
  return runScope.run({ locale: messages ? locale : DEFAULT_LOCALE, messages }, fn);
}

/**
 * Runs `fn` in English, inside a run too: what a model reads, or a value
 * other code compares, is never translated.
 */
export function inEnglish<T>(fn: () => T): T {
  return runScope.run({ locale: DEFAULT_LOCALE, messages: null }, fn);
}

const METHODS = ['rich', 'markup', 'raw', 'has'] as const;

type Loose = ((...args: unknown[]) => unknown) & Record<string, (...args: unknown[]) => unknown>;

/**
 * `english` (createTranslator over en.json's `namespace`), writing in the
 * run's language instead inside withRunLocale: only for words the person
 * reads, never a model. Its keys and values stay typed as English's.
 */
export function inRunLocale<T extends (...args: never[]) => unknown>(
  english: T,
  namespace: string,
): T {
  const made = new Map<UiLocale, Loose>();
  const current = (): Loose => {
    const store = runScope.getStore();
    if (!store?.messages || store.locale === DEFAULT_LOCALE) return english as unknown as Loose;
    let t = made.get(store.locale);
    if (!t) {
      t = createTranslator({
        locale: store.locale,
        messages: store.messages,
        namespace,
      } as never) as unknown as Loose;
      made.set(store.locale, t);
    }
    return t;
  };
  const wrapped = ((...args: unknown[]) => current()(...args)) as Loose;
  for (const method of METHODS) {
    wrapped[method] = (...args: unknown[]) => current()[method](...args);
  }
  return wrapped as unknown as T;
}
