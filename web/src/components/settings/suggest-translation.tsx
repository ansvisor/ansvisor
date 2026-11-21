'use client';

import { useEffect, useState } from 'react';
import { Languages, MousePointerClick } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePathname } from '@/i18n/navigation';
import { LOCALE_NAMES, isAnyUiLocale } from '@/i18n/locales';
import { submitTranslationSuggestion } from '@/lib/actions/translation-suggestions';
import { SUGGESTION_NOTE_MAX, SUGGESTION_TEXT_MAX } from '@/lib/i18n/translation-suggestions';

/**
 * Whether "Suggest a better translation" is offered: in any language but
 * English (the staff test language en-XA is English too).
 */
export function useCanSuggestTranslation(): boolean {
  return !useLocale().startsWith('en');
}

/**
 * The form (LOC-009). It already knows the screen (the address the person is
 * on) and the language, so they only give the text as it reads now (typed, or
 * picked by clicking it on the screen), their better version and, if they
 * like, a note. Suggestions go to the team's review queue.
 *
 * `open` is held by whoever shows it: the account menu's item closes with the
 * menu, so the form stays outside it. While the person picks text on the
 * screen the form hides and keeps what was typed.
 */
export function SuggestTranslationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('settings.language.suggest');
  const locale = useLocale();
  const pathname = usePathname();
  const [currentText, setCurrentText] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);

  // Picking: the next click anywhere on the page is the text, not an action.
  useEffect(() => {
    if (!picking) return;
    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target as HTMLElement | null;
      const text = (target?.innerText || target?.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) setCurrentText(text.slice(0, SUGGESTION_TEXT_MAX));
      setPicking(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicking(false);
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.body.style.cursor = 'crosshair';
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
    };
  }, [picking]);

  const language = isAnyUiLocale(locale) ? LOCALE_NAMES[locale] : locale;
  const ready = currentText.trim() !== '' && suggestion.trim() !== '';

  async function send() {
    if (!ready || sending) return;
    setSending(true);
    try {
      const result = await submitTranslationSuggestion({
        locale,
        path: pathname,
        currentText,
        suggestion,
        note,
      });
      if (result.ok) {
        toast.success(t('sent'));
        setCurrentText('');
        setSuggestion('');
        setNote('');
        onOpenChange(false);
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    } catch {
      toast.error(t('errors.server'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Dialog open={open && !picking} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg" data-slot="suggest-translation">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('language')}</dt>
            <dd>{language}</dd>
            <dt className="text-muted-foreground">{t('screen')}</dt>
            <dd className="min-w-0 break-all font-mono text-xs">{pathname}</dd>
          </dl>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="suggest-current">{t('current')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPicking(true)}
                data-action="pick-text"
              >
                <MousePointerClick aria-hidden />
                {t('pick')}
              </Button>
            </div>
            <Textarea
              id="suggest-current"
              value={currentText}
              onChange={(event) => setCurrentText(event.target.value)}
              maxLength={SUGGESTION_TEXT_MAX}
              rows={2}
              placeholder={t('currentPlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="suggest-better">{t('better')}</Label>
            <Textarea
              id="suggest-better"
              value={suggestion}
              onChange={(event) => setSuggestion(event.target.value)}
              maxLength={SUGGESTION_TEXT_MAX}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="suggest-note">{t('note')}</Label>
            <Textarea
              id="suggest-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={SUGGESTION_NOTE_MAX}
              rows={2}
              placeholder={t('notePlaceholder')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" disabled={!ready || sending} onClick={() => void send()}>
              {t('send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {picking && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-4 z-[100] mx-auto w-fit rounded-md border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg"
        >
          {t('picking')}
        </div>
      )}
    </>
  );
}

/**
 * The link in Settings › Account › Language, with its own form. Nothing in
 * English.
 */
export function SuggestTranslationLink() {
  const t = useTranslations('settings.language.suggest');
  const can = useCanSuggestTranslation();
  const [open, setOpen] = useState(false);
  if (!can) return null;
  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto justify-start p-0 text-xs"
        data-action="suggest-translation"
        onClick={() => setOpen(true)}
      >
        <Languages aria-hidden />
        {t('link')}
      </Button>
      <SuggestTranslationDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
