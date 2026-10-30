'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { ChatMode } from '@/lib/chat/precedence';
import { cn } from '@/lib/utils';

/** The run modes, as the composer lists them (CHAT-02 v2, CHAT-20 §5). */
export const COMPOSER_MODES: readonly ChatMode[] = ['ask_first', 'auto', 'full_auto'];

/**
 * The run mode in the composer (mockup modeInner): Ask me first · Auto, ask
 * before changes · Full auto. Full auto needs Growth and a paid plan
 * (`fullAutoOpen`, plan facts §7): locked, it says so and can't be picked.
 * Each pick says in a toast what the mode does.
 */
export function ModeSwitch({
  mode,
  onChange,
  fullAutoOpen,
}: {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  fullAutoOpen: boolean;
}) {
  const t = useTranslations('chatComposer.mode');
  return (
    <span
      role="radiogroup"
      aria-label={t('label')}
      className="inline-flex rounded-[9px] border bg-muted/60 p-0.5"
    >
      {COMPOSER_MODES.map((m) => {
        const locked = m === 'full_auto' && !fullAutoOpen;
        const on = m === mode;
        return (
          <button
            key={m}
            type="button"
            data-action="composer.setMode"
            role="radio"
            aria-checked={on}
            aria-disabled={locked || undefined}
            title={locked ? t('fullAutoLocked') : undefined}
            onClick={() => {
              if (locked || on) return;
              onChange(m);
              toast(t(`toast.${m}`));
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded-[7px] px-[9px] py-[3px] text-xs whitespace-nowrap text-muted-foreground',
              on && 'bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]',
              locked && 'cursor-not-allowed text-muted-foreground/60',
            )}
          >
            {t(m)}
            {locked && (
              <i className="rounded-[5px] border px-1 text-[10px] text-muted-foreground not-italic">
                {t('needsGrowth')}
              </i>
            )}
          </button>
        );
      })}
    </span>
  );
}
