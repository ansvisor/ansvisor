import { createTranslator } from 'next-intl';
import type english from '../../../messages/en.json';
import { DEFAULT_LOCALE, isUiLocale, type UiLocale } from '@/i18n/locales';
import { loadMessages } from '@/i18n/messages';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * The interface language a person's approval cards are written in: their
 * profile's pick (profiles.ui_language, 00549), else English. A failed read
 * is English too, so a card is never held back. The id is the run's
 * signed-in person, never a model's input.
 */
export async function cardLocaleOf(userId: string): Promise<UiLocale> {
  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('ui_language')
      .eq('id', userId)
      .maybeSingle();
    return isUiLocale(data?.ui_language) ? data.ui_language : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

type CostKey = keyof (typeof english)['chatEngine']['costs'];
export type CostLine = (key: CostKey, values: Record<string, string | number>) => string;

const costLines = new Map<UiLocale, Promise<CostLine>>();

/** The cards' cost lines (chatEngine.costs) in a language, English where it has no text yet. */
export function costLinesFor(locale: UiLocale = DEFAULT_LOCALE): Promise<CostLine> {
  let lines = costLines.get(locale);
  if (!lines) {
    lines = loadMessages(locale).then((messages) => {
      const t = createTranslator({ locale, messages, namespace: 'chatEngine.costs' });
      return (key, values) => t(key as never, values as never);
    });
    costLines.set(locale, lines);
  }
  return lines;
}
