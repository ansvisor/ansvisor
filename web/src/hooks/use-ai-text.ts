'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { useLocale } from 'next-intl';
import { DEFAULT_LOCALE, PSEUDO_LOCALE } from '@/i18n/locales';
import {
  AI_TEXT_MAX_ROWS,
  readAiTextTranslations,
  type AiTextKind,
} from '@/lib/i18n/ai-text-client';

/**
 * AI-written text in the reader's language (LOC-010), for the rows on
 * screen: `text(id, field, english)` is the row's field in the person's
 * interface language once the API has it, and the English until then, or
 * for good when it can't be translated. In English (or staff's
 * pseudo-locale) it asks for nothing. Each row is asked for once a page
 * load, the rows on screen together (AI_TEXT_MAX_ROWS a request): the API
 * keeps each translation, so the next viewer's request is a read.
 */

/** Each row's translated fields, by kind, language and id; null once asked with none. */
const translations = new Map<string, Record<string, string> | null>();
/** The rows being asked for now. */
const asking = new Set<string>();
/** The mounted hooks, told when translations land. */
const listeners = new Set<() => void>();

const keyOf = (kind: AiTextKind, locale: string, id: string) => `${kind}:${locale}:${id}`;

/** Forgets every translation read in this tab (tests). */
export function forgetAiTextTranslations() {
  translations.clear();
  asking.clear();
}

/** Whether AI-written text is translated in this interface language. */
export function translatesAiText(locale: string): boolean {
  return locale !== DEFAULT_LOCALE && locale !== PSEUDO_LOCALE;
}

export function useAiText(kind: AiTextKind, ids: readonly string[]) {
  const locale = useLocale();
  const active = translatesAiText(locale);
  const [revision, landed] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    listeners.add(landed);
    return () => {
      listeners.delete(landed);
    };
  }, []);

  const wanted = ids.join(',');
  useEffect(() => {
    if (!active || !wanted) return;
    const missing = [...new Set(wanted.split(','))].filter((id) => {
      const key = keyOf(kind, locale, id);
      return !translations.has(key) && !asking.has(key);
    });
    for (let at = 0; at < missing.length; at += AI_TEXT_MAX_ROWS) {
      const chunk = missing.slice(at, at + AI_TEXT_MAX_ROWS);
      for (const id of chunk) asking.add(keyOf(kind, locale, id));
      readAiTextTranslations(kind, chunk, locale)
        .then(
          (texts) => {
            for (const id of chunk) translations.set(keyOf(kind, locale, id), texts[id] ?? null);
          },
          (err) => {
            // Not translated this time: the English stays, and it isn't asked again this load.
            console.error('Failed to translate AI-written text:', err);
            for (const id of chunk) translations.set(keyOf(kind, locale, id), null);
          },
        )
        .finally(() => {
          for (const id of chunk) asking.delete(keyOf(kind, locale, id));
          for (const listener of listeners) listener();
        });
    }
  }, [active, kind, locale, wanted]);

  return useCallback(
    (id: string, field: string, english: string): string =>
      active ? (translations.get(keyOf(kind, locale, id))?.[field] ?? english) : english,
    // A new function once translations land, so what was worked out from it
    // (a memo, a list) is worked out again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision` is the point
    [active, kind, locale, revision],
  );
}
