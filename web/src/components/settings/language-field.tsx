'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SuggestTranslationLink } from '@/components/settings/suggest-translation';
import { useUiLanguage } from '@/hooks/use-ui-language';
import { LOCALE_NAMES, type AnyUiLocale } from '@/i18n/locales';
import { cn } from '@/lib/utils';

/**
 * The name a language is listed with: its own (Türkçe, Deutsch), with no
 * mark for those still being translated.
 */
export function useLanguageLabel() {
  return (locale: AnyUiLocale) => LOCALE_NAMES[locale];
}

/**
 * Settings › Account › Language (LOC-005): the language of the person's own
 * screens, never the workspace's and never a brand's content language. Each
 * language is in its own name. Saved as it is picked.
 */
export function LanguageField() {
  const t = useTranslations('settings.language');
  const label = useLanguageLabel();
  const { state, saving, pick } = useUiLanguage();

  async function choose(locale: AnyUiLocale | null) {
    if (locale === state?.selected) return;
    const saved = await pick(locale);
    if (saved) toast.success(t('saved'));
    else toast.error(t('saveFailed'));
  }

  const row = (locale: AnyUiLocale | null, text: string) => {
    const on = (state?.selected ?? null) === locale;
    return (
      <button
        key={locale ?? 'automatic'}
        type="button"
        role="radio"
        aria-checked={on}
        disabled={saving}
        data-locale={locale ?? 'automatic'}
        onClick={() => void choose(locale)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-start text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60',
          on && 'border-primary bg-accent',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {on && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
      </button>
    );
  };

  return (
    <div className="space-y-2" data-slot="account-language">
      <Label id="ui-language-label">{t('label')}</Label>
      {state ? (
        <div role="radiogroup" aria-labelledby="ui-language-label" className="space-y-1.5">
          {row(null, t('automatic', { language: LOCALE_NAMES[state.automatic] }))}
          {state.options.map((locale) => row(locale, label(locale)))}
        </div>
      ) : (
        <Skeleton className="h-8 w-full" />
      )}
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      {state && !state.preview && state.options.length === 1 && (
        <p className="text-xs text-muted-foreground">{t('moreSoon')}</p>
      )}
      {state?.preview && <p className="text-xs text-muted-foreground">{t('preview')}</p>}
      {/* Only in a language but English (LOC-009). */}
      <SuggestTranslationLink />
    </div>
  );
}
