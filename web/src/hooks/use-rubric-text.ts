'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Site Audit's rubric copy in the reader's language (LOC): each category's
 * and signal's words, as `auditRubric` in the messages holds them (a copy of
 * the server's rubric.json, kept equal by a test). A category or signal the
 * messages don't have yet, such as one the server added in a newer release,
 * shows the English the server sent. Read raw: the copy names HTML tags
 * ("<ul>", "<table>") that a formatted message would read as markup.
 */

/** A signal's words, as rubric.json names them. */
export type RubricSignalField = 'label' | 'what' | 'why' | 'howToFix' | 'evidenceNote';

export function useRubricText() {
  const t = useTranslations('auditRubric');
  return useMemo(() => {
    const read = (path: string, english: string) => (t.has(path) ? String(t.raw(path)) : english);
    return {
      /** A category's name ("Structure"). */
      category: (key: string, english: string) => read(`categories.${key}.label`, english),
      /** One of a signal's words. */
      signal: (key: string, field: RubricSignalField, english: string) =>
        read(`signals.${key}.${field}`, english),
    };
  }, [t]);
}
