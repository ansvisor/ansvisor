/**
 * The interface languages (LOC phases B and C). A plain module: the proxy,
 * server actions, server components and the browser all read it.
 *
 * The interface language is the person's own (profiles.ui_language, 00549),
 * apart from a brand's content language. It is not part of the address:
 * URLs stay as they are (/dashboard/..., and /en/... still works).
 */

/** Every interface language the app is built for, English first. */
export const LOCALES = [
  'en',
  'tr',
  'de',
  'fr',
  'es',
  'it',
  'pt-BR',
  'nl',
  'ja',
  'pl',
  'zh-CN',
  'ko',
  'ar',
] as const;

export type UiLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: UiLocale = 'en';

/**
 * Languages the app knows but offers no one, not even staff. Empty since
 * 2026-11-21: Arabic is listed like the others now that the layout follows
 * the reading direction (RTL work, #2553–#2558, #2638).
 */
export const HIDDEN_LOCALES: readonly UiLocale[] = [];

/** The languages a person can pick (the list in the switcher, before the translation check). */
export const SELECTABLE_LOCALES: readonly UiLocale[] = LOCALES.filter(
  (code) => !HIDDEN_LOCALES.includes(code),
);

/** Languages written right to left. */
const RTL_LOCALES: readonly string[] = ['ar'];

/** The text direction for <html dir>: Arabic reads right to left, and the layout follows it. */
export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return RTL_LOCALES.includes(locale.split('-')[0]) ? 'rtl' : 'ltr';
}

/**
 * Staff's test language (LOC phase C): English made ~35% longer with accents,
 * made at runtime from en.json. Never a person's pick, never stored in a file.
 */
export const PSEUDO_LOCALE = 'en-XA';

/** Anything a person's language can be set to. */
export type AnyUiLocale = UiLocale | typeof PSEUDO_LOCALE;

/**
 * The languages that have a messages file (web/messages/<code>.json), so the
 * ones a customer is offered. Add a code here when its file lands;
 * messages.test.ts checks this list against the folder.
 */
// Every language opened to customers on 2026-11-21 (owner's decision), once
// the 12 translations were in; a missing key still shows English.
export const TRANSLATED_LOCALES: readonly UiLocale[] = SELECTABLE_LOCALES;

/** Each language in its own name, so a person who can't read the current one finds theirs. */
export const LOCALE_NAMES: Record<AnyUiLocale, string> = {
  en: 'English',
  tr: 'Türkçe',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  'pt-BR': 'Português',
  nl: 'Nederlands',
  ja: '日本語',
  pl: 'Polski',
  'zh-CN': '简体中文',
  ko: '한국어',
  ar: 'العربية',
  'en-XA': 'Pseudo-English',
};

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function isAnyUiLocale(value: unknown): value is AnyUiLocale {
  return value === PSEUDO_LOCALE || isUiLocale(value);
}

/** The code with its usual casing ("pt-br" → "pt-BR"), or null when it is none of ours. */
export function normalizeLocale(value: string | null | undefined): AnyUiLocale | null {
  const wanted = value?.trim().toLowerCase();
  if (!wanted) return null;
  const found = ([...LOCALES, PSEUDO_LOCALE] as AnyUiLocale[]).find(
    (code) => code.toLowerCase() === wanted,
  );
  return found ?? null;
}

/**
 * The language an Accept-Language header asks for among `allowed`: the first
 * one, by the header's own order of preference, that we have: an exact code
 * (pt-BR), else its language (pt-PT → pt-BR, de-AT → de). Null when none.
 */
export function matchBrowserLocale(
  header: string | null | undefined,
  allowed: readonly UiLocale[],
): UiLocale | null {
  if (!header) return null;
  const asked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag && entry.tag !== '*' && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  for (const { tag } of asked) {
    const exact = allowed.find((code) => code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const language = tag.split('-')[0].toLowerCase();
    const sameLanguage = allowed.find((code) => code.split('-')[0].toLowerCase() === language);
    if (sameLanguage) return sameLanguage;
  }
  return null;
}
