'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PROMPT_TEXT_MAX, cleanPromptText } from '@/lib/prompt-text';
import { cn } from '@/lib/utils';

/**
 * A suggested prompt's text, editable before it is added: the pencil opens
 * an input, Enter or the tick keeps the change, Esc or the cross drops it.
 * The pencil stays in view (no hover to find it on a phone). Nothing is
 * saved here: the caller adds the prompt with the text it is given.
 */
export function SuggestionText({
  text,
  edited = false,
  onChange,
  className,
}: {
  text: string;
  /** The text differs from what was suggested: a quiet "Edited" says so. */
  edited?: boolean;
  /** Keeps the edited text; undefined for those who can't add prompts (no pencil). */
  onChange?: (text: string) => void;
  className?: string;
}) {
  const t = useTranslations('prompts.suggestions.edit');
  const [draft, setDraft] = useState<string | null>(null);
  const inputId = useId();

  if (draft !== null && onChange) {
    const clean = cleanPromptText(draft);
    const save = () => {
      if (clean === null) return;
      onChange(clean);
      setDraft(null);
    };
    return (
      <form
        className={cn('flex items-center gap-1', className)}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          {t('label')}
        </label>
        <Input
          id={inputId}
          value={draft}
          maxLength={PROMPT_TEXT_MAX}
          autoFocus
          className="h-8 min-w-0 flex-1 text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            // Esc drops the change, and only that: a dialog around it stays open.
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }}
        />
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          disabled={clean === null}
          aria-label={t('save')}
          title={t('save')}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={() => setDraft(null)}
          aria-label={t('cancel')}
          title={t('cancel')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </form>
    );
  }

  return (
    <div className={cn('flex items-start gap-1', className)}>
      <p className="min-w-0 flex-1 text-sm font-medium leading-snug break-words">
        {text}
        {edited && (
          <span className="ms-1.5 align-middle text-[11px] font-normal text-muted-foreground">
            {t('edited')}
          </span>
        )}
      </p>
      {onChange && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="-my-1 h-7 w-7 shrink-0 text-muted-foreground"
          onClick={() => setDraft(text)}
          aria-label={t('open', { text })}
          title={t('openTitle')}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
