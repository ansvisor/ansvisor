import type english from '../../../messages/en.json';
import { DEFAULT_LOCALE, isUiLocale, type UiLocale } from '@/i18n/locales';
import { chatTranslator } from './run-locale';

/**
 * The interface language a person's Chat texts are written in: their
 * profile's pick (profiles.ui_language, 00549), else English. A failed read
 * is English too, so a card is never held back. The id is the run's
 * signed-in person, never a model's input.
 */
export async function cardLocaleOf(userId: string): Promise<UiLocale> {
  try {
    // Loaded here, not at module load: views and actions that import this file
    // (and their tests) shouldn't need the admin client's server settings.
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
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

/** The cards' cost lines (chatEngine.costs) in a language, English where it has no text yet. */
export function costLinesFor(locale: UiLocale = DEFAULT_LOCALE): Promise<CostLine> {
  return chatTranslator(locale, 'chatEngine.costs');
}
