'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChatMode } from '@/lib/chat/precedence';

/** The run modes, as the composer lists them (CHAT-02 v2, CHAT-20 §5). */
export const COMPOSER_MODES: readonly ChatMode[] = ['ask_first', 'auto', 'full_auto'];

const isComposerMode = (value: unknown): value is ChatMode =>
  COMPOSER_MODES.includes(value as ChatMode);

/**
 * The run mode, under the composer's box (mockup modeInner; moved out of the
 * box's toolbar on 2026-11-06 so Send always fits): a button with the mode,
 * "Auto, ask before changes ▾", whose menu opens below it, or above when
 * there's no room below. Ask me first · Auto, ask before changes · Full auto,
 * the one on checked. Full auto needs Growth and a paid plan (`fullAutoOpen`,
 * plan facts §7), and for non-Admins the Admin's "Full auto for members"
 * switch (`offByAdmin`): locked, it says which and can't be picked. Each pick
 * says in a toast what the mode does.
 */
export function ModeMenu({
  mode,
  onChange,
  fullAutoOpen,
  offByAdmin = false,
}: {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  fullAutoOpen: boolean;
  /** Full auto is closed by the Admin's switch, not the plan. */
  offByAdmin?: boolean;
}) {
  const t = useTranslations('chatComposer.mode');
  const locked = (m: ChatMode) => m === 'full_auto' && !fullAutoOpen;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        data-action="composer.openMode"
        aria-label={t('current', { mode: t(mode) })}
        className="rounded-[7px] px-1.5 py-0.5 text-foreground hover:bg-muted data-popup-open:bg-muted"
      >
        {t(mode)} <span aria-hidden>▾</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(next: unknown) => {
              if (!isComposerMode(next) || next === mode || locked(next)) return;
              onChange(next);
              toast(t(`toast.${next}`));
            }}
          >
            {COMPOSER_MODES.map((m) => (
              <DropdownMenuRadioItem
                key={m}
                value={m}
                closeOnClick
                disabled={locked(m)}
                data-action="composer.setMode"
                title={
                  locked(m) ? t(offByAdmin ? 'fullAutoOffByAdmin' : 'fullAutoLocked') : undefined
                }
                // Locked, it still shows its reason on hover.
                className="data-disabled:pointer-events-auto data-disabled:cursor-not-allowed"
              >
                {t(m)}
                {locked(m) && (
                  <i className="rounded-[5px] border px-1 text-[10px] text-muted-foreground not-italic">
                    {t(offByAdmin ? 'offByAdmin' : 'needsGrowth')}
                  </i>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
