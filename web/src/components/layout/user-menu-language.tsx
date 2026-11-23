'use client';

import { Check, Languages, MessageSquareQuote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguageLabel } from '@/components/settings/language-field';
import { useCanSuggestTranslation } from '@/components/settings/suggest-translation';
import { useUiLanguage } from '@/hooks/use-ui-language';
import { LOCALE_NAMES, type AnyUiLocale } from '@/i18n/locales';

/**
 * The account menu's Language item (LOC-005): the person's own languages, each
 * in its own name, one click from any screen. `open` is whether the menu is
 * open: the list is read when it first opens. In a language but English,
 * "Suggest a better translation" (LOC-009) closes the menu and calls
 * `onSuggest`, which opens the form outside it.
 */
export function UserMenuLanguage({ open, onSuggest }: { open: boolean; onSuggest?: () => void }) {
  const t = useTranslations('accountMenu');
  const tLanguage = useTranslations('settings.language');
  const label = useLanguageLabel();
  const canSuggest = useCanSuggestTranslation();
  const { state, saving, pick } = useUiLanguage(open);

  async function choose(locale: AnyUiLocale | null) {
    if (locale === state?.selected) return;
    if (!(await pick(locale))) toast.error(tLanguage('saveFailed'));
  }

  const row = (locale: AnyUiLocale | null, text: string) => (
    <DropdownMenuItem
      key={locale ?? 'automatic'}
      data-locale={locale ?? 'automatic'}
      disabled={saving}
      onClick={() => void choose(locale)}
    >
      <span className="flex-1">{text}</span>
      {(state?.selected ?? null) === locale && <Check className="text-primary" aria-hidden />}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-account-item="language">
        <Languages className="text-muted-foreground" />
        <span className="flex-1">{t('language')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {state ? (
          <>
            {row(null, tLanguage('automatic', { language: LOCALE_NAMES[state.automatic] }))}
            {state.options.map((locale) => row(locale, label(locale)))}
          </>
        ) : (
          <DropdownMenuItem disabled>{tLanguage('loading')}</DropdownMenuItem>
        )}
        {canSuggest && onSuggest && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-account-item="suggest-translation" onClick={onSuggest}>
              <MessageSquareQuote className="text-muted-foreground" />
              <span className="flex-1">{tLanguage('suggest.link')}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
